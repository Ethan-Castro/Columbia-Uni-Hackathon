// Search and ranking shared by find_resources and make_plan.
//
//   const cat = await loadCatalog(req);
//   const near = resolveNear("Corona");
//   const ranked = rankPlaces(cat, "food", near, { language: "es", openNow: false });
//   ranked[0].place, ranked[0].programs, ranked[0].openNow ...
//
// Places have no needs column (CSV contract). A place serves a need when it
// offers a Program with that need (Link type "offers") or by its org_type
// (PLACE_ORG_NEEDS below). Also: the one-LLM-call helper with a timeout
// (llmJson) and the plain template summaries used when the LLM is slow/off.

import { getDb } from "./db.ts";
import type { Link, Need, Place, Program } from "./schema.ts";
import type { NearResult } from "./geo.ts";
import { distanceKm, nearRank, zipToNeighborhood } from "./geo.ts";
import { isOpenAt, isOpenLaterToday, parseHours, placeOpenEvenings, placeOpenWeekends } from "./hours.ts";
import type { Lang } from "./i18n.ts";
import { freeProvidersTitle, langOf, needLabel, t, trustLabel } from "./i18n.ts";
import { invokeLLM } from "./llm.ts";

// ---------- catalog ----------

export interface Catalog {
  places: Place[];
  programs: Program[];
  links: Link[];
  programById: Map<string, Program>;
  placeById: Map<string, Place>;
  /** place id -> programs it offers (Link type "offers"). */
  offers: Map<string, Program[]>;
}

/** Load Places, Programs and Links once per request (small tables). */
export async function loadCatalog(req: Request): Promise<Catalog> {
  const db = getDb(req);
  // Explicit limit: Base44's default page size is small.
  const [places, programs, links] = await Promise.all([
    db.Place.list("name", 5000),
    db.Program.list("name", 5000),
    db.Link.list("from_id", 5000),
  ]);
  const programById = new Map(programs.map((p) => [p.id, p]));
  const placeById = new Map(places.map((p) => [p.id, p]));
  const offers = new Map<string, Program[]>();
  for (const l of links) {
    if (l.type !== "offers") continue;
    const prog = programById.get(l.to_id);
    if (!prog || !placeById.has(l.from_id)) continue;
    const list = offers.get(l.from_id) ?? [];
    if (!list.includes(prog)) list.push(prog);
    offers.set(l.from_id, list);
  }
  return { places, programs, links, programById, placeById, offers };
}

/** org_type -> needs it serves by default (consulates count for ID only, not legal help). */
export const PLACE_ORG_NEEDS: Record<string, Need[]> = {
  doj_roster: ["legal"],
  doj_pro_bono: ["legal"],
  pantry: ["food"],
  consulate: ["id"],
  clinic: ["health"],
  benefits_office: ["benefits", "food", "health"],
  idnyc: ["id"],
  remittance: ["money"],
  check_casher: ["money"],
  school: ["school"],
  other: [],
};

export const DOJ_ORG_TYPES = ["doj_roster", "doj_pro_bono"];

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return v.split("|").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** All needs a place serves: org_type defaults plus offered programs' needs. */
export function placeNeeds(cat: Catalog, place: Place): Set<Need> {
  const out = new Set<Need>(PLACE_ORG_NEEDS[place.org_type] ?? []);
  for (const prog of cat.offers.get(place.id) ?? []) for (const n of asList(prog.needs)) out.add(n as Need);
  return out;
}

/** Programs a place offers for this need (all offered programs when need is omitted). */
export function offeredFor(cat: Catalog, placeId: string, need?: Need): Program[] {
  const all = cat.offers.get(placeId) ?? [];
  if (!need) return all;
  // Programs whose FIRST need is this one come first (CHP before WIC for health).
  return all.filter((p) => asList(p.needs).includes(need))
    .sort((a, b) => Number(asList(b.needs)[0] === need) - Number(asList(a.needs)[0] === need));
}

// ---------- status notes ----------

// Notes that say status does NOT matter. Anything else that mentions status or
// eligibility means "talk with a free legal provider before applying".
const STATUS_SAFE_RE = new RegExp(
  [
    "not asked", "not needed", "regardless", "does not matter", "doesn't matter", "not required",
    "do(es)? not ask", "don'?t ask", "doesn'?t ask", "never ask", "open to all", "any (immigration )?status",
    "no (se )?pregunta", "no preguntan", "no importa", "sin importar", "cualquier (estatus|situaci)",
    "abierto a tod", "referrals only",
  ].join("|"),
  "i",
);
const STATUS_WORDS_RE = /status|immigra|eligib|depend|estatus|situaci|migratori/i;

/** True when a program's status_note says eligibility may depend on status. */
export function isStatusDependent(prog: Pick<Program, "status_note">): boolean {
  const note = String(prog.status_note ?? "");
  if (!note.trim() || STATUS_SAFE_RE.test(note)) return false;
  return STATUS_WORDS_RE.test(note);
}

// ---------- ranking ----------

export interface RankOptions {
  /** Requested language, e.g. "es", "en", "es-MX", "quc". */
  language: string;
  /** Prefer places open right now, then evening/weekend hours. */
  openNow?: boolean;
  /**
   * Prefer places whose own org_type serves the need (a pantry over a clinic for food).
   * true: before location (make_plan: the best place of the right kind). "within_area":
   * after location, so among equally near places the pantry comes before the WIC clinic
   * (find_resources). false/omitted: ignore.
   */
  preferPrimary?: boolean | "within_area";
  now?: Date;
}

export interface Ranked {
  place: Place;
  /** Offered programs relevant to the need. */
  programs: Program[];
  near: 0 | 1 | 2 | 3;
  trustRank: number;
  openNow: boolean | null;
  openToday: boolean | null;
  openEvenings: boolean | null;
  openWeekends: boolean | null;
  speaksLanguage: boolean;
  distanceKm?: number;
}

/** official/verified 0, community 1, unverified 2, anything else 3. */
export function trustRank(trust: unknown): number {
  const order: Record<string, number> = { official: 0, verified: 0, community: 1, unverified: 2 };
  return order[String(trust)] ?? 3;
}

/** "es-MX" -> "es". */
export function baseLang(language: string): string {
  return (language || "es").split("-")[0].toLowerCase();
}

export function speaks(place: Place, language: string): boolean {
  const want = baseLang(language);
  return asList(place.languages).some((l) => l.toLowerCase().split("-")[0] === want);
}

const triRank = (v: boolean | null) => (v === true ? 0 : v === null ? 1 : 2);

/**
 * All places serving `need`, best first:
 *   1. trust (official/verified, community, unverified)
 *   2. legal: DOJ roster / pro bono providers first; id: IDNYC desks first
 *   3. (preferPrimary true) org_type serves the need itself
 *   4. location: nearby (same or adjacent zip), same borough, rest (geo.nearRank);
 *      within a tier, hand-verified places first, then same zip before adjacent
 *      (preferPrimary "within_area": org_type serves the need itself, within the same location tier)
 *   5. (openNow) open right now, then evening + weekend hours
 *   6. open later today, speaks the requested language, distance, name
 */
export function rankPlaces(cat: Catalog, need: Need, near: NearResult, opts: RankOptions): Ranked[] {
  const now = opts.now ?? new Date();
  const rows: Array<Ranked & { keys: number[] }> = [];
  for (const place of cat.places) {
    if (!placeNeeds(cat, place).has(need)) continue;
    const parsed = parseHours(place.hours ?? "");
    const r: Ranked = {
      place,
      programs: offeredFor(cat, place.id, need),
      near: nearRank(place, near),
      trustRank: trustRank(place.trust),
      openNow: isOpenAt(parsed, now),
      openToday: isOpenLaterToday(parsed, now),
      openEvenings: placeOpenEvenings(place),
      openWeekends: placeOpenWeekends(place),
      speaksLanguage: speaks(place, opts.language),
      distanceKm: distanceKm(place, near),
    };
    const primary = (PLACE_ORG_NEEDS[place.org_type] ?? []).includes(need) ? 0 : 1;
    const keys = [
      r.trustRank,
      need === "legal" ? (DOJ_ORG_TYPES.includes(place.org_type) ? 0 : 1) : 0,
      // ID: IDNYC (any NYC resident) before consulates (only that country's nationals).
      need === "id" ? (place.org_type === "idnyc" ? 0 : 1) : 0,
      opts.preferPrimary === true ? primary : 0,
      // Same or adjacent zip count as "nearby"; within that, a place a person verified by phone wins.
      r.near <= 1 ? 0 : r.near,
      place.trust === "verified" ? 0 : 1,
      r.near,
      opts.preferPrimary === "within_area" ? primary : 0,
      opts.openNow ? triRank(r.openNow) : 0,
      opts.openNow ? (r.openEvenings === true ? 0 : 1) + (r.openWeekends === true ? 0 : 1) : 0,
      triRank(r.openToday),
      r.speaksLanguage ? 0 : 1,
      r.distanceKm ?? 999,
    ];
    rows.push({ ...r, keys });
  }
  rows.sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
    return String(a.place.name).localeCompare(String(b.place.name));
  });
  return rows.map(({ keys: _keys, ...r }) => r);
}

/**
 * "Matched in that zip and language" (the spec's definition of met):
 * the place is in the asked area AND lists the requested language.
 * Area = the zip or the neighborhood's zips (nearRank 0); when only a borough
 * was given, anywhere in that borough; for "NYC", anywhere. An unrecognized
 * location only checks language.
 */
export function inAreaAndLanguage(r: Ranked, near: NearResult): boolean {
  if (!r.speaksLanguage) return false;
  if (!near.matched) return true;
  if (near.primaryZips.length) return r.near === 0;
  if (near.borough) return r.near <= 2;
  return true; // citywide
}

/** Best official/verified DOJ provider (trust first, then nearest); any DOJ-listed place if none is verified. */
export function bestDojProvider(cat: Catalog, near: NearResult, language: string): Ranked | undefined {
  const legal = rankPlaces(cat, "legal", near, { language }).filter((r) => DOJ_ORG_TYPES.includes(r.place.org_type));
  return legal[0];
}

/**
 * source_url only when it is a real http(s) link. Approved community places
 * without a link carry "community-submission:<id>", which must not look like a
 * URL to a model; they get a plain source_label instead.
 */
export function sourceOf(p: { source_url?: string; last_checked?: string }, lang: string): { source_url: string; source_label?: string } {
  const url = String(p.source_url ?? "");
  if (/^https?:\/\//i.test(url)) return { source_url: url };
  if (url.startsWith("community-submission:")) {
    return { source_url: "", source_label: t(lang, "source_community", { date: p.last_checked ?? "" }) };
  }
  return { source_url: "" };
}

/**
 * The DOJ-listed option block every legal answer ends with. `verified` and
 * the note's heading follow the data: "verified" only for official/verified places.
 */
export function verifiedProviderOut(r: Ranked, lang: string) {
  const p = r.place;
  return {
    id: p.id,
    name: p.name,
    address: p.address ?? "",
    phone: p.phone ?? "",
    hours: p.hours ?? "",
    on_doj_list: DOJ_ORG_TYPES.includes(p.org_type),
    list_checked: p.last_checked ?? "",
    fee: lang.startsWith("en") ? "unknown" : "no sabemos",
    intake: lang.startsWith("en") ? "unknown" : "no sabemos",
    trust: p.trust,
    trust_label: trustLabel(lang, p.trust),
    verified: trustRank(p.trust) === 0,
    ...sourceOf(p, lang),
    last_checked: p.last_checked ?? "",
    note: `${freeProvidersTitle(lang, [p.trust])} ${p.name}, ${p.address ?? ""}${p.phone ? `, ${p.phone}` : ""}.`,
    ...(typeof p.lat === "number" && typeof p.lng === "number" ? { lat: p.lat, lng: p.lng } : {}),
  };
}

// ---------- output shapes ----------

export interface ProgramOut {
  id: string;
  name: string;
  needs: string[];
  who_can_use: string;
  bring: string[];
  how_to_apply: string;
  summary: string;
  status_note: string;
  /** Present only for status-dependent programs: talk with a free legal provider first. */
  before_you_apply?: string;
  source_url: string;
  last_checked: string;
}

export function programOut(prog: Program, lang: string): ProgramOut {
  const out: ProgramOut = {
    id: prog.id,
    name: prog.name,
    needs: asList(prog.needs),
    who_can_use: prog.who_can_use ?? "",
    bring: asList(prog.bring),
    how_to_apply: prog.how_to_apply ?? "",
    summary: (langOf(lang) === "en" ? prog.summary_en : prog.summary_es) || prog.summary_en || prog.summary_es || "",
    status_note: prog.status_note ?? "",
    source_url: prog.source_url ?? "",
    last_checked: prog.last_checked ?? "",
  };
  if (isStatusDependent(prog)) out.before_you_apply = t(lang, "status_talk_to_provider");
  return out;
}

export interface PlaceOut {
  id: string;
  name: string;
  org: string;
  org_type: string;
  type_label: string;
  address: string;
  borough: string;
  zip: string;
  phone: string;
  hours: string;
  open_now: boolean | null;
  open_today: boolean | null;
  open_evenings: boolean | null;
  open_weekends: boolean | null;
  languages: string[];
  speaks_your_language: boolean;
  trust: string;
  trust_label: string;
  distance_km?: number;
  /** For the card's map thumbnail. */
  lat?: number;
  lng?: number;
  bring: string[];
  programs: ProgramOut[];
  summary: string;
  source_url: string;
  /** Only when there is no http(s) source link (e.g. an approved community submission). */
  source_label?: string;
  last_checked: string;
}

/** Unique "what to bring" items across programs, input order kept. */
export function bringOf(programs: Program[]): string[] {
  const out: string[] = [];
  for (const p of programs) for (const b of asList(p.bring)) if (!out.includes(b)) out.push(b);
  return out;
}

export function placeOut(r: Ranked, lang: string, summary: string): PlaceOut {
  const p = r.place;
  const out: PlaceOut = {
    id: p.id,
    name: p.name,
    org: p.org ?? "",
    org_type: p.org_type,
    type_label: orgTypeLabel(lang, p.org_type),
    address: p.address ?? "",
    borough: p.borough ?? "",
    zip: p.zip ?? "",
    phone: p.phone ?? "",
    hours: p.hours ?? "",
    open_now: r.openNow,
    open_today: r.openToday,
    open_evenings: r.openEvenings,
    open_weekends: r.openWeekends,
    languages: asList(p.languages),
    speaks_your_language: r.speaksLanguage,
    trust: p.trust,
    trust_label: trustLabel(lang, p.trust),
    bring: bringOf(r.programs),
    programs: r.programs.map((prog) => programOut(prog, lang)),
    summary,
    ...sourceOf(p, lang),
    last_checked: p.last_checked ?? "",
  };
  if (r.distanceKm !== undefined) out.distance_km = r.distanceKm;
  if (typeof p.lat === "number" && typeof p.lng === "number") {
    out.lat = p.lat;
    out.lng = p.lng;
  }
  return out;
}

/** True when any result is demo sample data (so answers can say so). */
export function hasSampleData(places: Array<{ name?: string; source_url?: string }>): boolean {
  return places.some((p) => /\(sample\)/i.test(p.name ?? "") || /example\.(org|com)\/sample/i.test(p.source_url ?? ""));
}

// ---------- template text (LLM fallback) ----------

const ORG_TYPE_LABELS: Record<Lang, Record<string, string>> = {
  es: {
    pantry: "Despensa de comida",
    doj_roster: "Proveedor legal reconocido por el DOJ",
    doj_pro_bono: "Servicio legal (lista pro bono del DOJ)",
    consulate: "Ayuda consular",
    clinic: "Clínica de salud",
    benefits_office: "Oficina de beneficios",
    idnyc: "Centro de inscripción de IDNYC",
    remittance: "Envío de dinero",
    check_casher: "Cambio de cheques",
    school: "Centro escolar",
    other: "Servicio comunitario",
  },
  en: {
    pantry: "Food pantry",
    doj_roster: "DOJ-recognized legal provider",
    doj_pro_bono: "Legal service (DOJ pro bono list)",
    consulate: "Consular help",
    clinic: "Health clinic",
    benefits_office: "Benefits office",
    idnyc: "IDNYC enrollment center",
    remittance: "Money transfer",
    check_casher: "Check casher",
    school: "School center",
    other: "Community service",
  },
};

/** Plain English description of each org_type, given to the LLM so it describes places without inventing. */
export const ORG_TYPE_DESCRIPTIONS_EN: Record<string, string> = {
  pantry: "food pantry that gives free groceries",
  doj_roster: "nonprofit legal provider recognized by the U.S. Department of Justice (DOJ)",
  doj_pro_bono: "legal services provider on the DOJ pro bono list",
  consulate: "consular services such as passports and consular IDs",
  clinic: "community health clinic",
  benefits_office: "office where people apply for public benefits such as food, cash and health coverage",
  idnyc: "enrollment desk for IDNYC, the free New York City ID card",
  remittance: "money transfer business for sending money to family (we have no data on its fees: tell people to ask the price before sending; never say fees are charged or free)",
  check_casher: "check cashing business (we have no data on its fees: tell people to ask the price first; never say fees are charged or free)",
  school: "public school enrollment and family welcome center",
  other: "community service",
};

export function orgTypeLabel(lang: string, orgType: string): string {
  return ORG_TYPE_LABELS[langOf(lang)][orgType] ?? ORG_TYPE_LABELS[langOf(lang)].other;
}

const LANGUAGE_NAMES: Record<Lang, Record<string, string>> = {
  es: {
    es: "español", en: "inglés", zh: "chino", qu: "quechua", quc: "k'iche'", ht: "criollo haitiano",
    fr: "francés", pt: "portugués", bn: "bengalí", ar: "árabe", ru: "ruso", ko: "coreano",
  },
  en: {
    es: "Spanish", en: "English", zh: "Chinese", qu: "Quechua", quc: "K'iche'", ht: "Haitian Creole",
    fr: "French", pt: "Portuguese", bn: "Bengali", ar: "Arabic", ru: "Russian", ko: "Korean",
  },
};

/** English language name for prompts ("quc" -> "K'iche'"). */
export function languageName(code: string): string {
  return LANGUAGE_NAMES.en[baseLang(code)] ?? code;
}

function joinList(lang: Lang, items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${lang === "en" ? "and" : "y"} ${items[items.length - 1]}`;
}

const DAY_NAMES: Record<Lang, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "de lunes a viernes", "martes, jueves y sábado", "todos los días" (regular days only). */
function daysPhrase(lang: Lang, hours: string): string {
  const p = parseHours(hours);
  if (p.always) return lang === "en" ? "every day" : "todos los días";
  const days = [...new Set(p.intervals.filter((i) => !i.irregular).map((i) => i.day))].sort();
  const key = days.join("");
  if (!days.length) return "";
  if (key === "0123456") return lang === "en" ? "every day" : "todos los días";
  if (key === "12345") return lang === "en" ? "Monday to Friday" : "de lunes a viernes";
  if (key === "123456") return lang === "en" ? "Monday to Saturday" : "de lunes a sábado";
  return joinList(lang, days.map((d) => DAY_NAMES[lang][d]));
}

/** 1-2 plain sentences from fields only, e.g. "Despensa de comida en Corona. Abre martes, jueves y sábado. Hablan español e inglés." */
export function templateSummary(r: Ranked, language: string): string {
  const lang = langOf(language);
  const p = r.place;
  const area = zipToNeighborhood(p.zip ?? "") ?? p.borough ?? "";
  const parts: string[] = [];
  // Spanish: drop English glosses like "WIC (food for women, infants and children)" -> "WIC".
  const offers = r.programs.map((x) => (lang === "en" ? x.name : x.name.replace(/\s*\([^)]*\)/g, "").trim()));
  const where = area ? (lang === "en" ? ` in ${area}` : ` en ${area}`) : "";
  parts.push(
    `${orgTypeLabel(lang, p.org_type)}${where}` +
      (offers.length ? (lang === "en" ? `, offers ${joinList(lang, offers)}.` : `, ofrece ${joinList(lang, offers)}.`) : "."),
  );
  const days = daysPhrase(lang, p.hours ?? "");
  const status = r.openNow === true
    ? (lang === "en" ? "Open now" : "Abierto ahora")
    : r.openToday === true
    ? (lang === "en" ? "Open later today" : "Abre hoy más tarde")
    : "";
  const hoursBits = [status, days ? (lang === "en" ? `open ${days}` : `abre ${days}`) : ""].filter(Boolean);
  let hoursSentence = hoursBits.join("; ");
  if (hoursSentence) hoursSentence = hoursSentence[0].toUpperCase() + hoursSentence.slice(1);
  const langs = asList(p.languages).map((c) => LANGUAGE_NAMES[lang][c.toLowerCase()] ?? c);
  const speak = langs.length ? (lang === "en" ? `They speak ${joinList(lang, langs)}.` : `Hablan ${joinList(lang, langs)}.`) : "";
  parts.push([hoursSentence ? hoursSentence + "." : "", speak].filter(Boolean).join(" "));
  return parts.filter(Boolean).join(" ");
}

/** Plain step title: "Comida: Corona Community Pantry". */
export function templateTitle(need: Need, placeName: string | undefined, language: string): string {
  const label = needLabel(language, need);
  const cap = label[0].toUpperCase() + label.slice(1);
  return placeName ? `${cap}: ${placeName.replace(/\s*\(sample\)\s*$/i, "")}` : cap;
}

// ---------- the one LLM call ----------

export const LLM_TIMEOUT_MS = 8000;

/**
 * One structured LLM call that never throws and never waits longer than
 * `ms`: returns the parsed object, or null on timeout/error/no key (callers
 * then use their templates). Locally the HTTP call is aborted at the deadline
 * (AbortSignal); on Base44 the signal is ignored and the race still caps the wait.
 */
export async function llmJson(
  req: Request,
  prompt: string,
  schema: Record<string, unknown>,
  ms = LLM_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms + 250) : undefined;
    const call = invokeLLM(req, { prompt, response_json_schema: schema, signal }).catch((err) => {
      // Name and status only: provider error text can echo parts of the prompt.
      const e = err as { name?: unknown; status?: unknown } | null;
      console.error("llmJson: LLM failed, using template:", String(e?.name ?? "unknown"), e?.status ?? "");
      return null;
    });
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Accept an LLM string only if it is a non-empty, reasonably short string. keepLines keeps line breaks. */
export function cleanLLMText(v: unknown, max = 600, keepLines = false): string | null {
  if (typeof v !== "string") return null;
  const s = keepLines
    ? v.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n")
    : v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** Prompt line so Spanish answers match the app's tone. */
export const SPANISH_TONE = `When writing Spanish, address the person as "usted" (never "tú").`;

// ---------- text for phones ----------

// Anything about immigration status or legal cases stays out of texts.
const SENSITIVE_RE =
  /immigra|inmigra|status|estatus|asylum|asilo|visa|deport|green card|residenc|papers|papeles|undocumented|indocumentad|sin papeles|migratori/i;

export function isSensitive(s: string): boolean {
  return SENSITIVE_RE.test(s);
}

