// check_provider: is this person or office on the DOJ lists? Plus up to 3 DOJ-listed options nearby.
//
// Wording rules (immigration attorney on the panel): options are "DOJ-listed",
// each names its list and our check date; fee and intake are "unknown" unless a
// source says otherwise; a name that isn't found is "not on the lists we
// searched", never called a fraud.
//
// Fast and deterministic (no LLM). Fuzzy-matches the name against Places whose
// org_type is doj_roster (DOJ recognized organizations / accredited
// representatives) or doj_pro_bono (EOIR pro bono list), on both name and org.
//
// Match thresholds (shared/text.ts similarity, 0..1), tuned on the sample data:
//   FOUND_THRESHOLD    0.60  typos and partial names match ("Queens Imigrant Legl
//                            Clinic" 0.78, "Roosevelt Pro Bono" 0.81), unrelated
//                            names do not ("Jose Perez Notario" 0.02).
//   POSSIBLE_THRESHOLD 0.40  shown as possible_matches so the person can compare.
// A score above FOUND only counts as found when the query shares a distinctive
// word with the match (or, for all-generic names, scores >= 0.85, so plain
// "legal clinic" is only a possible match), and has no red-flag word
// (notario, travel agency, consultor) that the listed name lacks. Otherwise it is
// only a possible match: claiming a notario is DOJ-listed is the worst mistake.
//
// The searched name is NEVER logged.

import { getDb } from "../db.ts";
import { distanceKm, nearRank, resolveNear } from "../geo.ts";
import type { NearResult } from "../geo.ts";
import { disclaimer, langOf, trustLabel } from "../i18n.ts";
import type { Lang } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import type { Place } from "../schema.ts";
import { sourceOf, speaks } from "../rank.ts";
import { normalize, ratio, similarity, tokens } from "../text.ts";
import { getLanguage, getString } from "./input.ts";
import type { Tool } from "./types.ts";

export const FOUND_THRESHOLD = 0.6;
export const POSSIBLE_THRESHOLD = 0.4;
/** For queries made only of generic words: "Immigrant Legal Clinic" 0.87 counts, "Legal Clinic" 0.70 does not. */
export const GENERIC_ONLY_THRESHOLD = 0.85;
const DOJ_ORG_TYPES = ["doj_roster", "doj_pro_bono"];
const MAX_POSSIBLE = 3;
const MAX_PROVIDERS = 3;

/** Words that never make a match on their own (normalized, no accents). */
const NON_DISTINCTIVE = new Set([
  "of", "and", "for", "de", "del", "y", "en", "nyc", "new", "york", "ny", "queens", "brooklyn", "bronx",
  "manhattan", "staten", "island", "center", "centro", "services", "service", "servicios", "community",
  "comunidad", "legal", "legales", "law", "office", "oficina", "offices", "group", "project", "proyecto",
  "program", "programa", "help", "ayuda", "immigrant", "immigrants", "immigration", "inmigrante", "inmigrantes",
  "inmigracion", "migratorio", "family", "familia", "clinic", "clinica", "association", "asociacion", "society",
  "organization", "lawyer", "lawyers", "attorney", "attorneys", "abogado", "abogada", "abogados", "mr", "mrs",
  "ms", "sr", "sra", "senor", "senora", "don", "dona", "dr",
]);

/** Words that describe people who cannot give immigration legal help. */
const RED_FLAGS = new Set([
  "notario", "notaria", "notary", "notarios", "consultor", "consultora", "consultores", "consultant",
  "consultants", "consulting", "consultoria", "travel", "agency", "agencia", "viajes", "viaje", "multiservicios",
  "multiservices", "tax", "taxes", "impuestos", "preparer", "gestor", "gestoria", "tramites", "paralegal",
]);

const HOW_TO_VERIFY = {
  es: [
    {
      label: "Lista oficial del DOJ (EOIR) de organizaciones reconocidas y representantes acreditados",
      url: "https://www.justice.gov/eoir/recognition-and-accreditation-roster-reports",
    },
    {
      label: "Buscar a un abogado con licencia en Nueva York (directorio de las cortes de NY)",
      url: "https://iapps.courts.state.ny.us/attorneyservices/search",
    },
  ],
  en: [
    {
      label: "Official DOJ (EOIR) roster of recognized organizations and accredited representatives",
      url: "https://www.justice.gov/eoir/recognition-and-accreditation-roster-reports",
    },
    {
      label: "Look up a licensed New York attorney (NY courts attorney search)",
      url: "https://iapps.courts.state.ny.us/attorneyservices/search",
    },
  ],
} as const;

/** The two DOJ lists we search, named the way a person would recognize them. */
const LIST_NAME: Record<string, Record<Lang, string>> = {
  doj_roster: {
    es: "Lista del DOJ (EOIR) de organizaciones reconocidas y representantes acreditados",
    en: "DOJ EOIR roster of recognized organizations and accredited representatives",
  },
  doj_pro_bono: {
    es: "Lista pro bono del DOJ (EOIR) de proveedores de servicios legales",
    en: "DOJ EOIR list of pro bono legal service providers",
  },
};

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    found_roster:
      "\"{match}\" aparece en la lista del DOJ (EOIR) de organizaciones reconocidas y representantes acreditados (revisada el {date}). Las organizaciones reconocidas y sus representantes acreditados sí pueden dar ayuda legal de inmigración. Aun así, confirme en persona que es la misma oficina (nombre y dirección) antes de pagar o firmar algo. Estar en la lista no dice si es gratis ni si están aceptando casos.",
    found_rep:
      "\"{match}\" aparece en la lista del DOJ (EOIR) como representante acreditado de {org} (revisada el {date}). Los representantes acreditados sí pueden dar ayuda legal de inmigración por medio de su organización. Confirme en persona que trabaja en esa organización antes de pagar o firmar algo.",
    found_pro_bono:
      "\"{match}\" aparece en la lista pro bono del DOJ (EOIR) de proveedores de servicios legales (revisada el {date}). Aun así, confirme en persona que es la misma oficina (nombre y dirección) antes de firmar algo, y pregunte el costo y si están aceptando casos.",
    not_found:
      "\"{name}\" no aparece en las listas del DOJ que revisamos: la lista de la EOIR de organizaciones reconocidas y representantes acreditados, y la lista pro bono de la EOIR (revisadas el {date}). Eso solo no prueba un fraude: un abogado con licencia puede no estar en estas listas; búsquelo en el directorio de abogados de las cortes de Nueva York (enlace abajo).",
    possible: " Hay nombres parecidos abajo; revise si es exactamente la misma oficina y dirección.",
    warning:
      "Solo los abogados con licencia y los representantes acreditados por el DOJ pueden dar ayuda legal de inmigración. Los notarios, las agencias de viajes y los \"consultores\" no pueden, aunque digan que sí. Nunca pague a nadie que le prometa \"arreglar los papeles\". Antes de pagar o firmar algo, consulte una de las opciones de las listas del DOJ de abajo.",
    options_title: "Opciones de las listas del DOJ cerca de usted. No sabemos el costo ni si están aceptando casos: llame para confirmar.",
    trust_note:
      "Algunas de estas opciones están en las listas del DOJ, pero nuestro equipo todavía no revisó sus datos. Llame antes de ir.",
    none_nearby:
      "Todavía no tenemos opciones de las listas del DOJ con dirección en esta zona. Puede llamar al 311 y pedir ayuda legal de inmigración (ActionNYC).",
    unknown: "no sabemos",
  },
  en: {
    found_roster:
      "\"{match}\" appears on the DOJ EOIR roster of recognized organizations and accredited representatives (checked {date}). Recognized organizations and their accredited representatives can give immigration legal help. Still, confirm in person that it is the same office (name and address) before you pay or sign anything. Being listed doesn't say whether it's free or taking cases.",
    found_rep:
      "\"{match}\" appears on the DOJ EOIR roster as an accredited representative of {org} (checked {date}). Accredited representatives can give immigration legal help through their organization. Confirm in person that they work there before you pay or sign anything.",
    found_pro_bono:
      "\"{match}\" appears on the DOJ EOIR list of pro bono legal service providers (checked {date}). Still, confirm in person that it is the same office (name and address) before you sign anything, and ask about cost and whether they are taking cases.",
    not_found:
      "\"{name}\" is not on the DOJ lists we searched: the EOIR roster of recognized organizations and accredited representatives, and the EOIR pro bono list (checked {date}). That alone isn't proof of fraud: a licensed attorney may not appear on these lists, so look them up in the NY courts attorney search (link below).",
    possible: " There are similar names below; check that it is exactly the same office and address.",
    warning:
      "Only licensed attorneys and DOJ-accredited representatives can give immigration legal help. Notarios, travel agencies, and \"consultants\" cannot, even if they say they can. Never pay anyone who promises to \"fix your papers\". Before you pay or sign anything, contact one of the DOJ-listed options below.",
    options_title: "DOJ-listed options near you. We don't know the cost or whether they are taking cases: call to confirm.",
    trust_note:
      "Some of these options are on the DOJ lists, but our team has not reviewed their details yet. Call before you go.",
    none_nearby:
      "We don't have DOJ-listed options with an address in this area yet. You can call 311 and ask for immigration legal help (ActionNYC).",
    unknown: "unknown",
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** The listed name without our "(sample)" tag, for display in sentences. */
function displayName(p: Place): string {
  return (p.name || p.org || "").replace(/\s*\(sample\)\s*/gi, " ").trim();
}

/** True when some word of `query` (a-word) fuzzy-matches a word of the candidate. */
function hasWord(word: string, candidate: string[]): boolean {
  return candidate.some((c) => c === word || ratio(word, c) >= 0.8);
}

export interface ScoredPlace {
  place: Place;
  score: number;
  /** score >= FOUND_THRESHOLD and passes the distinctive-word and red-flag checks. */
  strong: boolean;
}

/** Score one DOJ place against the searched name (best of name and org). Exported for tests. */
export function scorePlace(query: string, place: Place): ScoredPlace {
  const score = Math.max(similarity(query, place.name), similarity(query, place.org));
  const q = tokens(query);
  const cand = [...new Set([...tokens(place.name), ...tokens(place.org)])];
  const distinctive = q.filter((w) => !NON_DISTINCTIVE.has(w) && !RED_FLAGS.has(w));
  // All-generic names ("Queens Immigrant Legal Clinic") need a near-exact score instead.
  const sharesDistinctive = distinctive.length
    ? distinctive.some((w) => hasWord(w, cand))
    : score >= GENERIC_ONLY_THRESHOLD;
  const unmatchedRedFlag = q.some((w) => RED_FLAGS.has(w) && !hasWord(w, cand));
  return { place, score, strong: score >= FOUND_THRESHOLD && sharesDistinctive && !unmatchedRedFlag };
}

/** Best match and possible matches among DOJ places. Exported for tests. */
export function matchProvider(query: string, places: Place[]): { match: ScoredPlace | null; possible: ScoredPlace[] } {
  const scored = places
    .map((p) => scorePlace(query, p))
    .filter((s) => s.score >= POSSIBLE_THRESHOLD)
    .sort((a, b) =>
      Number(b.strong) - Number(a.strong) || b.score - a.score ||
      // Ties (an org and its representatives all match the org field): the org's own row wins.
      similarity(query, b.place.name) - similarity(query, a.place.name) ||
      Number(Boolean(b.place.address)) - Number(Boolean(a.place.address))
    );
  const match = scored[0]?.strong ? scored[0] : null;
  const possible = scored.filter((s) => s !== match).slice(0, MAX_POSSIBLE);
  return { match, possible };
}

/** In the asked area: the zip or neighborhood zips; the borough if only a borough was given; anywhere otherwise. */
function inArea(p: Place, near: NearResult): boolean {
  if (!near.matched) return true;
  if (near.primaryZips.length) return nearRank(p, near) === 0;
  if (near.borough) return nearRank(p, near) <= 2;
  return true;
}

function isVerified(p: Place): boolean {
  return p.trust === "official" || p.trust === "verified";
}

/**
 * Up to 3 free legal providers: official/verified DOJ places first, nearest
 * first (same zip, adjacent, same borough, rest). When fewer than 3 are
 * verified (sample data has none), the rest are filled with other DOJ-listed
 * places, each showing its trust level, and a trust_note says so.
 */
export function pickProviders(places: Place[], near: NearResult): Place[] {
  places = places.filter((p) => p.zip && p.address);
  const trustOrder = (p: Place) => (p.trust === "official" ? 0 : p.trust === "verified" ? 1 : p.trust === "community" ? 2 : 3);
  // One option per office: an org on both DOJ lists shows once (both list names, see providerView).
  const seen = new Set<string>();
  return [...places]
    .sort((a, b) =>
      Number(isVerified(b)) - Number(isVerified(a)) ||
      nearRank(a, near) - nearRank(b, near) ||
      (distanceKm(a, near) ?? 999) - (distanceKm(b, near) ?? 999) ||
      trustOrder(a) - trustOrder(b) ||
      String(a.name).localeCompare(String(b.name))
    )
    .filter((p) => {
      const key = `${normalize(p.name)}|${normalize(p.address)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PROVIDERS);
}

/** Every DOJ list an office is on (an org can be on the roster and the pro bono list). */
function listsFor(p: Place, all: Place[], lang: Lang): string {
  const key = `${normalize(p.name)}|${normalize(p.address)}`;
  const types = new Set(all.filter((q) => `${normalize(q.name)}|${normalize(q.address)}` === key).map((q) => q.org_type));
  types.add(p.org_type);
  return [...types].map((t) => LIST_NAME[t]?.[lang]).filter(Boolean).join("; ");
}

function providerView(p: Place, near: NearResult, lang: Lang, all: Place[] = []) {
  const km = distanceKm(p, near);
  return {
    id: p.id,
    name: p.name,
    org: p.org,
    org_type: p.org_type,
    address: p.address,
    borough: p.borough,
    zip: p.zip,
    phone: p.phone,
    hours: p.hours,
    languages: p.languages,
    trust: p.trust,
    trust_label: trustLabel(lang, p.trust),
    list_name: listsFor(p, all, lang),
    list_checked: p.last_checked,
    fee: TEXT[lang].unknown,
    intake: TEXT[lang].unknown,
    ...(km !== undefined ? { distance_km: km } : {}),
    ...sourceOf(p, lang),
    last_checked: p.last_checked,
  };
}

export const checkProvider: Tool = {
  definition: {
    name: "check_provider",
    description:
      "Check if a person or office offering immigration help is allowed to give it. Use whenever someone mentions " +
      "a notario, notary, consultant, consultor, travel agency (agencia de viajes), lawyer (abogado), or anyone who " +
      "says they can fix papers (\"me arregla los papeles\", \"someone says they can fix my papers\"), or asks \"is " +
      "this person legit?\" / \"¿es de confianza?\", especially if they ask for money. Looks the name up in the " +
      "Department of Justice lists (recognized organizations, accredited representatives, EOIR pro bono list) and " +
      "returns up to 3 DOJ-listed options nearby, each with the list it is on and the date we checked it (fee and " +
      "intake capacity are unknown), plus links to verify. End your answer with those DOJ-listed options. If the " +
      "name is not found, say it is not on the lists we searched; never call anyone a fraud, since licensed " +
      "attorneys may not appear on these lists. Only licensed attorneys and " +
      "DOJ-accredited representatives can give immigration legal help; notarios cannot. Do not ask about the " +
      "person's immigration status. Information and referrals only, not legal advice.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the person, office, or business offering help, e.g. 'Jose Perez Notario'.",
        },
        near: {
          type: "string",
          description: "Zip code, neighborhood, or borough for nearby DOJ-listed options, e.g. '11368' or 'Corona'.",
        },
        language: {
          type: "string",
          description: "Language code for the answer, e.g. 'es' (default) or 'en'.",
          default: "es",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },

  async run(req, input, ctx) {
    const name = getString(input, "name", { required: true, max: 200 });
    const near = resolveNear(getString(input, "near", { max: 200 }));
    const language = getLanguage(input);
    const lang = langOf(language);
    const text = TEXT[lang];

    // Whole table, filtered here: portable (no $in operator needed on Base44), and Place is small.
    const places = (await getDb(req).Place.list("name", 5000)).filter((p) => DOJ_ORG_TYPES.includes(p.org_type));
    const { match, possible } = matchProvider(name, places);
    const providers = pickProviders(places, near);
    const found = match !== null;

    // Our check date for the lists: the newest last_checked among DOJ rows.
    const listsChecked = places.reduce((d, p) => (p.last_checked > d ? p.last_checked : d), "");
    const isRep = found && match.place.org && match.place.name !== match.place.org &&
      similarity(name, match.place.org) >= similarity(name, match.place.name);
    let what = found
      ? fill(
        match.place.org_type === "doj_pro_bono" ? text.found_pro_bono : isRep ? text.found_rep : text.found_roster,
        { match: displayName(match.place), org: match.place.org, date: match.place.last_checked || listsChecked },
      )
      : fill(text.not_found, { name, date: listsChecked });
    if (!found && possible.length) what += text.possible;

    const result = {
      query_name: name,
      found,
      match: match
        ? {
          name: match.place.name,
          org: match.place.org,
          org_type: match.place.org_type,
          list_name: LIST_NAME[match.place.org_type]?.[lang] ?? "",
          list_checked: match.place.last_checked,
          address: match.place.address,
          phone: match.place.phone,
          trust: match.place.trust,
          ...sourceOf(match.place, lang),
          last_checked: match.place.last_checked,
          score: match.score,
        }
        : null,
      possible_matches: possible.map((s) => ({
        name: s.place.name,
        org: s.place.org,
        org_type: s.place.org_type,
        address: s.place.address,
        source_url: s.place.source_url,
        last_checked: s.place.last_checked,
        score: s.score,
      })),
      what_this_means: what,
      warning: found ? null : text.warning,
      options_title: providers.length ? text.options_title : text.none_nearby,
      doj_listed_options: providers.map((p) => providerView(p, near, lang, places)),
      ...(providers.some((p) => !isVerified(p)) ? { trust_note: text.trust_note } : {}),
      how_to_verify: HOW_TO_VERIFY[lang],
      near: near.matched ? near.label : null,
      language,
      disclaimer: disclaimer(lang),
    };

    // One anonymous row. Never the searched name.
    void logRequest(req, {
      needs: ["legal"],
      zip: near.zip ?? "",
      language,
      channel: ctx.channel,
      results_found: providers.length,
      // Spec: unmet when nothing matched in that area and language.
      unmet: !providers.some((p) => inArea(p, near) && speaks(p, language)),
    });
    return result;
  },
};
