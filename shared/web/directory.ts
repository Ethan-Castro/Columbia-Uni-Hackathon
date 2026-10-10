// Public directory for the web app (functions/list_places).
//
//   listPlaces(req, { need: "food", borough: "Queens", language: "es", q: "corona", ui_language: "en" })
//
// Filters places by need (org_type + offered programs), borough, a language
// the place speaks, and free text. Sorted by trust (official first), then
// name. Every place carries hours, languages, bring, trust, source_url and
// last_checked. Writes one RequestLog row (channel "web") only when a need
// filter is used, so browsing alone never counts as a request.

import { HttpError } from "../http.ts";
import { normalizeBorough, zipToBorough } from "../geo.ts";
import { isOpenAt, isOpenLaterToday, placeOpenEvenings, placeOpenWeekends } from "../hours.ts";
import { disclaimer, langOf, t, trustLabel } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import { bringOf, isStatusDependent, loadCatalog, offeredFor, trustRank } from "../rank.ts";
import type { Need, Place, Program } from "../schema.ts";
import { normalize } from "../text.ts";
import { parseNeed } from "../tools/input.ts";
import { directoryNeeds } from "./needs.ts";
import type { Body } from "./handler.ts";

/** Language names people type -> codes used in Place.languages. */
export const LANGUAGE_WORDS: Record<string, string> = {
  spanish: "es", espanol: "es", castellano: "es", english: "en", ingles: "en",
  chinese: "zh", chino: "zh", mandarin: "zh", cantonese: "yue", kiche: "quc", "k iche": "quc",
  quiche: "quc", quechua: "qu", french: "fr", frances: "fr", "haitian creole": "ht", creole: "ht",
  arabic: "ar", arabe: "ar", bengali: "bn", bangla: "bn", russian: "ru", ruso: "ru", portuguese: "pt",
  portugues: "pt", mam: "mam", nahuatl: "nah", mixteco: "mix", mixtec: "mix", hindi: "hi", urdu: "ur",
  nepali: "ne", tibetan: "bo", korean: "ko", coreano: "ko", polish: "pl", italian: "it",
};

/** "Español" -> "es", "es-MX" -> "es", "quc" -> "quc"; "" when unrecognized. */
export function languageCode(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (/^[a-zA-Z]{2,3}(-[A-Za-z]{2,4})?$/.test(s)) return s.split("-")[0].toLowerCase();
  return LANGUAGE_WORDS[normalize(s, { dropSuffixes: false })] ?? "";
}

export interface DirectoryProgram {
  id: string;
  name: string;
  needs: Need[];
  summary: string;
  summary_es: string;
  summary_en: string;
  who_can_use: string;
  status_note: string;
  /** Eligibility may depend on the person's situation: talk with a free legal provider first. */
  status_dependent: boolean;
  /** Fixed sentence in the UI language when status_dependent, else "". */
  status_advice: string;
  how_to_apply: string;
  source_url: string;
  last_checked: string;
}

export interface DirectoryPlace {
  id: string;
  name: string;
  org: string;
  org_type: string;
  address: string;
  borough: string;
  zip: string;
  lat?: number;
  lng?: number;
  hours: string;
  open_now: boolean | null;
  open_today: boolean | null;
  open_evenings: boolean;
  open_weekends: boolean;
  languages: string[];
  phone: string;
  needs: Need[];
  bring: string[];
  programs: DirectoryProgram[];
  trust: string;
  trust_label: string;
  source_url: string;
  last_checked: string;
}

function toProgram(p: Program, lang: "es" | "en"): DirectoryProgram {
  return {
    id: p.id,
    name: p.name,
    needs: p.needs ?? [],
    summary: (lang === "en" ? p.summary_en : p.summary_es) || p.summary_es || p.summary_en || "",
    summary_es: p.summary_es ?? "",
    summary_en: p.summary_en ?? "",
    who_can_use: p.who_can_use ?? "",
    status_note: p.status_note ?? "",
    status_dependent: isStatusDependent(p),
    status_advice: isStatusDependent(p) ? t(lang, "status_talk_to_provider") : "",
    how_to_apply: p.how_to_apply ?? "",
    source_url: p.source_url ?? "",
    last_checked: p.last_checked ?? "",
  };
}

export async function listPlaces(req: Request, body: Body) {
  const ui = langOf(body.ui_language ?? "es");

  // ---- parse filters (each optional; a given-but-unknown value is a 400) ----
  const needRaw = typeof body.need === "string" ? body.need.trim() : "";
  const need = needRaw ? parseNeed(needRaw) : undefined;
  if (needRaw && !need) throw new HttpError(400, `Unknown need "${needRaw.slice(0, 40)}"`);

  const boroughRaw = typeof body.borough === "string" ? body.borough.trim() : "";
  const borough = boroughRaw ? normalizeBorough(boroughRaw) : undefined;
  if (boroughRaw && !borough) throw new HttpError(400, `Unknown borough "${boroughRaw.slice(0, 40)}"`);

  const languageRaw = typeof body.language === "string" ? body.language.trim() : "";
  const language = languageRaw ? languageCode(languageRaw) : "";
  if (languageRaw && !language) throw new HttpError(400, `Unknown language "${languageRaw.slice(0, 40)}"`);

  const q = typeof body.q === "string" ? body.q.trim().slice(0, 100) : "";
  const qTokens = normalize(q, { dropSuffixes: false }).split(" ").filter(Boolean);

  // ---- load everything once (small tables) ----
  const cat = await loadCatalog(req);
  const places = cat.places;

  const results: DirectoryPlace[] = [];
  for (const place of places) {
    const needs = directoryNeeds(cat, place);
    if (need && !needs.includes(need)) continue;

    const placeBorough = normalizeBorough(place.borough) ?? zipToBorough(place.zip) ?? place.borough ?? "";
    if (borough && placeBorough !== borough) continue;

    const languages = (place.languages ?? []).map((l) => String(l).toLowerCase());
    if (language && !languages.some((l) => l.split("-")[0] === language)) continue;

    const offered = offeredFor(cat, place.id);
    if (qTokens.length) {
      const hay = normalize(
        [place.name, place.org, place.address, place.zip, placeBorough, ...offered.map((p) => p.name)].join(" "),
        { dropSuffixes: false },
      );
      if (!qTokens.every((tok) => hay.includes(tok))) continue;
    }

    results.push(toDirectoryPlace(place, placeBorough, needs, offered, ui));
  }

  results.sort((a, b) =>
    trustRank(a.trust) - trustRank(b.trust) ||
    a.name.localeCompare(b.name, ui)
  );

  const result = {
    places: results,
    count: results.length,
    total: places.length,
    filters: { need: need ?? null, borough: borough ?? null, language: language || null, q: q || null },
    ui_language: ui,
    disclaimer: disclaimer(ui),
    sample_data: places.some((p) => /\(sample\)/i.test(p.name ?? "")),
    sample_data_note: t(ui, "sample_data_note"),
  };

  // Log only real "I need X" searches. A 5-digit search text counts as the zip.
  if (need) {
    void logRequest(req, {
      needs: [need],
      zip: /^\d{5}$/.test(q) ? q : "",
      language: language || ui,
      channel: "web",
      results_found: results.length,
      unmet: results.length === 0,
    });
  }
  return result;
}

function toDirectoryPlace(
  place: Place,
  borough: string,
  needs: Need[],
  offered: Program[],
  ui: "es" | "en",
): DirectoryPlace {
  return {
    id: place.id,
    name: place.name,
    org: place.org ?? "",
    org_type: place.org_type,
    address: place.address ?? "",
    borough,
    zip: place.zip ?? "",
    ...(typeof place.lat === "number" && typeof place.lng === "number" ? { lat: place.lat, lng: place.lng } : {}),
    hours: place.hours ?? "",
    open_now: place.hours ? isOpenAt(place.hours) : null,
    open_today: place.hours ? isOpenLaterToday(place.hours) : null,
    open_evenings: placeOpenEvenings(place),
    open_weekends: placeOpenWeekends(place),
    languages: place.languages ?? [],
    phone: place.phone ?? "",
    needs,
    bring: bringOf(offered),
    programs: offered.map((p) => toProgram(p, ui)),
    trust: place.trust,
    trust_label: trustLabel(ui, place.trust),
    source_url: place.source_url ?? "",
    last_checked: place.last_checked ?? "",
  };
}
