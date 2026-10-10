// check_provider: is this person or office on the DOJ lists? Plus 3 free verified providers nearby.
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
import { disclaimer, langOf, t, trustLabel } from "../i18n.ts";
import type { Lang } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import type { Place } from "../schema.ts";
import { ratio, similarity, tokens } from "../text.ts";
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

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    found_roster:
      "\"{match}\" aparece en la lista del Departamento de Justicia (DOJ) de organizaciones reconocidas y representantes acreditados, que sí pueden dar ayuda legal de inmigración. Aun así, confirme en persona que es la misma oficina (nombre y dirección) antes de pagar o firmar algo.",
    found_pro_bono:
      "\"{match}\" aparece en la lista de proveedores legales gratuitos (pro bono) de la corte de inmigración (EOIR, Departamento de Justicia). Aun así, confirme en persona que es la misma oficina (nombre y dirección) antes de firmar algo.",
    not_found:
      "No encontramos \"{name}\" en las listas del Departamento de Justicia (DOJ) de organizaciones reconocidas, representantes acreditados y proveedores gratuitos. Si dice que es abogado, búsquelo en el directorio de abogados de las cortes de Nueva York (enlace abajo).",
    possible: " Hay nombres parecidos abajo; revise si es exactamente la misma oficina y dirección.",
    warning:
      "Solo los abogados con licencia y los representantes acreditados por el Departamento de Justicia (DOJ) pueden dar ayuda legal de inmigración. Los notarios, las agencias de viajes y los \"consultores\" no pueden, aunque digan que sí. Nunca pague a nadie que le prometa \"arreglar los papeles\". Antes de pagar o firmar algo, hable con uno de los proveedores gratuitos de abajo.",
    trust_note:
      "Algunos de estos proveedores están en las listas del DOJ, pero nuestro equipo todavía no revisó sus datos. Llame antes de ir.",
    none_nearby:
      "Todavía no tenemos proveedores legales gratuitos en nuestra lista. Puede llamar al 311 y pedir \"ayuda legal de inmigración gratis\" (ActionNYC).",
  },
  en: {
    found_roster:
      "\"{match}\" appears on the Department of Justice (DOJ) roster of recognized organizations and accredited representatives, who can give immigration legal help. Still, confirm in person that it is the same office (name and address) before you pay or sign anything.",
    found_pro_bono:
      "\"{match}\" appears on the immigration court's (EOIR, Department of Justice) list of free (pro bono) legal providers. Still, confirm in person that it is the same office (name and address) before you sign anything.",
    not_found:
      "We did not find \"{name}\" on the Department of Justice (DOJ) lists of recognized organizations, accredited representatives, and free providers. If they say they are a lawyer, look them up in the NY courts attorney search (link below).",
    possible: " There are similar names below; check that it is exactly the same office and address.",
    warning:
      "Only licensed attorneys and DOJ-accredited representatives can give immigration legal help. Notarios, travel agencies, and \"consultants\" cannot, even if they say they can. Never pay anyone who promises to \"fix your papers\". Before you pay or sign anything, talk with one of the free providers below.",
    trust_note:
      "Some of these providers are on the DOJ lists, but our team has not reviewed their details yet. Call before you go.",
    none_nearby:
      "We do not have free legal providers on our list yet. You can call 311 and ask for \"free immigration legal help\" (ActionNYC).",
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
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score);
  const match = scored[0]?.strong ? scored[0] : null;
  const possible = scored.filter((s) => s !== match).slice(0, MAX_POSSIBLE);
  return { match, possible };
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
  const trustOrder = (p: Place) => (p.trust === "official" ? 0 : p.trust === "verified" ? 1 : p.trust === "community" ? 2 : 3);
  return [...places]
    .sort((a, b) =>
      Number(isVerified(b)) - Number(isVerified(a)) ||
      nearRank(a, near) - nearRank(b, near) ||
      (distanceKm(a, near) ?? 999) - (distanceKm(b, near) ?? 999) ||
      trustOrder(a) - trustOrder(b) ||
      String(a.name).localeCompare(String(b.name))
    )
    .slice(0, MAX_PROVIDERS);
}

function providerView(p: Place, near: NearResult, lang: Lang) {
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
    ...(km !== undefined ? { distance_km: km } : {}),
    source_url: p.source_url,
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
      "always returns 3 free verified legal providers nearby plus links to verify. Only licensed attorneys and " +
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
          description: "Zip code, neighborhood, or borough for nearby free providers, e.g. '11368' or 'Corona'.",
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

    const places = await getDb(req).Place.filter({ org_type: { $in: DOJ_ORG_TYPES } });
    const { match, possible } = matchProvider(name, places);
    const providers = pickProviders(places, near);
    const found = match !== null;

    let what = found
      ? fill(match.place.org_type === "doj_pro_bono" ? text.found_pro_bono : text.found_roster, {
        match: displayName(match.place),
      })
      : fill(text.not_found, { name });
    if (!found && possible.length) what += text.possible;

    const result = {
      query_name: name,
      found,
      match: match
        ? {
          name: match.place.name,
          org: match.place.org,
          org_type: match.place.org_type,
          address: match.place.address,
          phone: match.place.phone,
          trust: match.place.trust,
          source_url: match.place.source_url,
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
      free_providers_title: providers.length ? t(lang, "free_providers_nearby") : text.none_nearby,
      free_verified_providers: providers.map((p) => providerView(p, near, lang)),
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
      unmet: !found && providers.length === 0,
    });
    return result;
  },
};
