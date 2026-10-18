// Shared helpers for scripts/articles.ts and scripts/build-pages.ts.
// Reads data/*.json directly (local-only scripts, never copied to Base44).

import type { Link, Need, OrgType, Place, Program } from "../shared/schema.ts";
import { ORG_TYPE_NEEDS } from "../shared/schema.ts";

export const ROOT = new URL("../", import.meta.url);
export const DATA = new URL("data/", ROOT);
export const ARTICLES = new URL("data/articles/", ROOT);
export const SITE = "https://inmigracion-nyc.com";
export const SITE_NAME = "Mapa de Servicios NYC";

export interface Catalog {
  places: Place[];
  programs: Program[];
  links: Link[];
  programById: Map<string, Program>;
}

export async function loadCatalog(): Promise<Catalog> {
  const read = async <T>(name: string): Promise<T[]> => JSON.parse(await Deno.readTextFile(new URL(name, DATA)));
  const [places, programs, links] = await Promise.all([
    read<Place>("Place.json"),
    read<Program>("Program.json"),
    read<Link>("Link.json"),
  ]);
  return { places, programs, links, programById: new Map(programs.map((p) => [p.id, p])) };
}

// One rule for who is a person, shared with search and the knowledge graph.
import { isPerson, looksLikePerson } from "../shared/graph.ts";
export { isPerson, looksLikePerson };

/** Places that get an article and a page: a street address and not a person. */
const ORG_TYPE_NEEDS_SET: Record<string, true> = Object.fromEntries(
  ["food", "legal", "health", "benefits", "money", "school", "id", "housing", "work", "transit"].map((n) => [n, true]),
);

export function eligiblePlaces(places: Place[]): Place[] {
  return places.filter((p) => (p.address ?? "").trim() !== "" && !isPerson(p));
}

/** Programs a place offers (Link type "offers", place -> program). */
export function offeredPrograms(cat: Catalog, placeId: string): Program[] {
  return cat.links
    .filter((l) => l.type === "offers" && l.from_id === placeId)
    .map((l) => cat.programById.get(l.to_id))
    .filter((p): p is Program => !!p);
}

export function placeNeeds(cat: Catalog, p: Place): Need[] {
  // Same rule as shared/rank.ts: a place's own needs replace the org_type default.
  const own = ((p as Place & { needs?: Need[] }).needs ?? []).filter((n) => n in ORG_TYPE_NEEDS_SET);
  const set = new Set<Need>(own.length ? own : ORG_TYPE_NEEDS[p.org_type] ?? []);
  for (const prog of offeredPrograms(cat, p.id)) for (const n of prog.needs) set.add(n);
  return [...set];
}

export const ORG_TYPE_MEANING: Record<OrgType, { es: string; en: string; prompt: string }> = {
  doj_roster: {
    es: "Organización reconocida por el DOJ",
    en: "DOJ-recognized organization",
    prompt:
      "Listed on the U.S. Department of Justice (EOIR) Roster of Recognized Organizations and Accredited Representatives. Recognized organizations are non-profits whose DOJ-accredited representatives may give immigration legal help. Fees and intake process are unknown unless given.",
  },
  doj_pro_bono: {
    es: "Proveedor legal pro bono (lista del DOJ)",
    en: "Pro bono legal provider (DOJ list)",
    prompt:
      "Listed on the U.S. Department of Justice (EOIR) List of Pro Bono Legal Service Providers. Whether it takes new cases, fees and intake are unknown unless given.",
  },
  pantry: {
    es: "Despensa de alimentos",
    en: "Food pantry",
    prompt:
      "A food pantry or soup kitchen listed on the City's Food Help NYC map. What food is given and any requirements are unknown unless given.",
  },
  consulate: {
    es: "Consulado",
    en: "Consulate",
    prompt:
      "A foreign government consulate in New York. Specific services and appointment rules are unknown unless given.",
  },
  clinic: {
    es: "Clínica de salud",
    en: "Health clinic",
    prompt: "A health clinic or hospital site. Specific services, costs and eligibility are unknown unless given.",
  },
  benefits_office: {
    es: "Oficina de beneficios (HRA)",
    en: "Benefits office (HRA)",
    prompt: "A NYC Human Resources Administration (HRA) public benefits office.",
  },
  idnyc: {
    es: "Centro de inscripción IDNYC",
    en: "IDNYC enrollment center",
    prompt: "A City IDNYC enrollment center where people apply for the IDNYC card.",
  },
  remittance: {
    es: "Envío de dinero",
    en: "Money transfer agent",
    prompt: "A money transfer (remittance) agent. It is a business. We have no data on its fees: tell people to ask the price before sending money.",
  },
  check_casher: {
    es: "Cambio de cheques",
    en: "Check casher",
    prompt: "A licensed check cashing business. We have no data on its fees: tell people to ask the price first.",
  },
  school: {
    es: "Centro de bienvenida escolar",
    en: "School welcome center",
    prompt: "A NYC Public Schools Family Welcome Center that helps families enroll students.",
  },
  other: { es: "Servicio comunitario", en: "Community service", prompt: "A community service location." },
};

export const NEED_LABEL: Record<Need, { es: string; en: string }> = {
  food: { es: "Comida", en: "Food" },
  legal: { es: "Ayuda legal", en: "Legal help" },
  health: { es: "Salud", en: "Health" },
  benefits: { es: "Beneficios", en: "Benefits" },
  money: { es: "Dinero", en: "Money" },
  school: { es: "Escuela", en: "School" },
  id: { es: "Identificación", en: "ID" },
  housing: { es: "Vivienda", en: "Housing" },
  work: { es: "Trabajo", en: "Work" },
  transit: { es: "Transporte", en: "Transit" },
};

export interface FaqItem {
  q: string;
  a: string;
}

export interface Article {
  title_es: string;
  title_en: string;
  summary_es: string;
  summary_en: string;
  how_they_help_es: string[];
  how_they_help_en: string[];
  visit_tips_es: string[];
  visit_tips_en: string[];
  faq_es: FaqItem[];
  faq_en: FaqItem[];
}

export interface ArticleFile {
  place_id: string;
  model: string;
  generated_at: string;
  facts_hash: string;
  article: Article;
}

/** The facts the model sees (and that the page shows). Stable order for hashing. */
export function placeFacts(cat: Catalog, p: Place) {
  return {
    name: p.name,
    org: p.org !== p.name ? p.org : undefined,
    type: p.org_type,
    type_meaning: ORG_TYPE_MEANING[p.org_type]?.prompt,
    address: p.address,
    borough: p.borough || undefined,
    zip: p.zip || undefined,
    hours: p.hours || undefined,
    open_evenings: p.open_evenings || undefined,
    open_weekends: p.open_weekends || undefined,
    languages: p.languages?.length ? p.languages : undefined,
    phone: p.phone || undefined,
    trust: p.trust,
    last_checked: p.last_checked,
    programs_offered: offeredPrograms(cat, p.id).map((g) => ({
      name: g.name,
      who_can_use: g.who_can_use || undefined,
      bring: g.bring?.length ? g.bring : undefined,
      how_to_apply: g.how_to_apply || undefined,
      summary_en: g.summary_en || undefined,
      summary_es: g.summary_es || undefined,
    })),
  };
}

/** Facts JSON exactly as sent to the model, and its hash (stale-article check). */
export function factsJson(cat: Catalog, p: Place): string {
  return JSON.stringify(placeFacts(cat, p), null, 1);
}
export function factsHash(cat: Catalog, p: Place): Promise<string> {
  return sha1(factsJson(cat, p));
}

export async function readArticle(id: string): Promise<ArticleFile | null> {
  try {
    return JSON.parse(await Deno.readTextFile(new URL(`${id}.json`, ARTICLES)));
  } catch {
    return null;
  }
}

export async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function loadEnv(path: URL): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const line of (await Deno.readTextFile(path)).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[2]) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch { /* no .env */ }
  return out;
}
