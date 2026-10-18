// The resource knowledge graph: every Place, Program and Link, plus the nodes
// and edges their fields imply, in one structure the tools can walk.
//
//   const g = buildGraph(cat);            // cat = loadCatalog(req) (or the local JSON)
//   g.orgOf.get(placeId)                  // "org-bronxworks"
//   g.branches("org-bronxworks")          // its 4 public locations
//   g.docsFor("prog-wic")                 // ["photo_id", "proof_of_address", "proof_of_income", "proof_of_pregnancy"]
//   g.whereToGet("photo_id")              // IDNYC (program) + IDNYC desks and consulates (places)
//
// Node kinds: need, program, org, place, zip, hood, borough, lang, doc.
// Every edge says where it came from:
//   "link"     a curated Link row (offers, unlocks, pairs_with, requires, refers_to)
//   "data"     a field on the record (org, zip, languages, org_type, a submission's needs)
//   "inferred" a written rule below (DOC_PATTERNS, DOC_SOURCES, OFFER_RULES), with `why`
// Inferred edges only ever restate what the data already says in another form
// ("WIC asks for a photo ID" + "IDNYC is a photo ID" -> IDNYC helps before WIC);
// no rule adds a fact that is not in a record.
//
// Individual people (DOJ accredited representatives listed by name) never become
// nodes: they are counted on their organization (accredited_reps) and nothing else.

import type { Link, Need, OrgType, Place, Program } from "./schema.ts";
import { NEEDS, ORG_TYPE_NEEDS } from "./schema.ts";
import { zipToBorough, zipToNeighborhood } from "./geo.ts";
import { stripAccents } from "./text.ts";

export type NodeKind = "need" | "program" | "org" | "place" | "zip" | "hood" | "borough" | "lang" | "doc";
export type Rel =
  | "serves" // place|program -> need
  | "offers" // place -> program
  | "branch_of" // place -> org
  | "in_zip" // place -> zip
  | "in_hood" // zip -> hood
  | "in_borough" // zip|hood -> borough
  | "speaks" // place -> lang
  | "asks_for" // program -> doc
  | "gives" // program|place -> doc
  | "unlocks" // program|place -> program
  | "pairs_with"
  | "requires"
  | "refers_to";
export type Provenance = "link" | "data" | "inferred";

export interface KNode {
  id: string;
  kind: NodeKind;
  label: string;
  label_es?: string;
  /** Place / program id this node stands for. */
  ref?: string;
  /** org nodes: how many DOJ accredited representatives the roster lists for it (people are never nodes). */
  accredited_reps?: number;
}

export interface KEdge {
  from: string;
  to: string;
  rel: Rel;
  source: Provenance;
  /** English reason (Link.reason, or the rule that produced an inferred edge). */
  why?: string;
}

// ---------- people ----------

const ORG_WORDS =
  /\b(inc|llc|llp|pllc|pc|corp|ltd|co|ny|nyc|center|centre|services?|church|society|association|council|foundation|fund|project|network|coalition|legal|law|aid|committee|office|program|department|university|college|school|house|alliance|league|institute|catholic|charities|ministr\w*)\b\.?/i;

/** "Last, First" style names (DOJ accredited representatives). */
export function looksLikePerson(name: string): boolean {
  const n = name.trim();
  if (!/^[^,()0-9]+,\s*[^,()0-9]+$/.test(n)) return false;
  return !ORG_WORDS.test(n);
}

/**
 * Individual people are never shown. DOJ accredited representatives are listed
 * as persons (place-doj-rep-*, "Last, First", name differs from org, no address).
 */
export function isPerson(p: Pick<Place, "id" | "name" | "org" | "org_type" | "address">): boolean {
  if (p.org_type !== "doj_roster" && p.org_type !== "doj_pro_bono") return false;
  if (p.id.startsWith("place-doj-rep-")) return true;
  if (looksLikePerson(p.name) && p.name !== p.org) return true;
  if (looksLikePerson(p.name) && !p.address) return true;
  return false;
}

// ---------- organizations ----------

const ORG_NOISE = /\b(the|inc|incorporated|llc|corp|corporation|ltd|co|of new york|nyc|ny)\b/g;

/**
 * One key per organization, so branches group together:
 *   "BronxWorks (Townsend Avenue - Bronx Extension Office)" + org "BronxWorks" -> "bronxworks"
 *   "AARP Foundation Tax-Aide - Hollis" (no org)                              -> "aarp-foundation-tax-aide"
 * Uses `org` when the record has one, else the name before a " - " / "(" branch suffix.
 */
export function orgKey(p: Pick<Place, "name" | "org">): string {
  let base = String(p.org ?? "").trim() || String(p.name ?? "");
  base = base.replace(/\s*\(sample\)\s*/i, " ").replace(/\s*\([^)]*\)\s*/g, " ").split(/\s+[-–—]\s+|:\s/)[0];
  const key = stripAccents(base.toLowerCase())
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(ORG_NOISE, " ")
    .trim()
    .replace(/\s+/g, "-");
  return key || "unknown";
}

/** Display name for an organization: its `org` field, else the shortest branch name without the suffix. */
function orgLabel(members: Place[]): string {
  const withOrg = members.find((p) => String(p.org ?? "").trim());
  if (withOrg) return String(withOrg.org).trim();
  const names = members.map((p) => p.name.replace(/\s*\([^)]*\)\s*/g, " ").split(/\s+[-–—]\s+/)[0].trim());
  return names.sort((a, b) => a.length - b.length)[0] ?? members[0]?.name ?? "";
}

// ---------- documents ----------

export interface DocType {
  id: string;
  en: string;
  es: string;
  /** Matches the English "bring" text of a program. */
  re: RegExp;
  /** About immigration status: never put in a text message, never asked about. */
  sensitive?: boolean;
}

/** Documents programs ask for, read from their "bring" text. Order = how they are listed. */
export const DOC_PATTERNS: DocType[] = [
  {
    id: "photo_id",
    en: "Photo ID",
    es: "Identificación con foto",
    re: /\bphoto id\b|\bidentification\b|\bidentity\b|driver'?s licen[cs]e|state id|government[- ]issued id|\bID\b(?!NYC)|IDNYC/,
  },
  { id: "passport", en: "Passport", es: "Pasaporte", re: /passport/i },
  { id: "birth_certificate", en: "Birth certificate", es: "Acta de nacimiento", re: /birth certificate/i },
  { id: "proof_of_age", en: "Proof of age", es: "Comprobante de edad", re: /\bage\b|date of birth|birth dates?/i },
  {
    id: "proof_of_address",
    en: "Proof of address",
    es: "Comprobante de domicilio",
    re: /proof of (address|residen\w*)|where you live|\bresiden(cy|ce)\b|\blease\b|utility bill|rent receipt/i,
  },
  {
    id: "proof_of_income",
    en: "Proof of income",
    es: "Comprobante de ingresos",
    re: /\bincome\b|pay ?stubs?|benefits? statements?|profit and loss/i,
  },
  { id: "tax_documents", en: "Tax documents (W-2, 1099)", es: "Documentos de impuestos (W-2, 1099)", re: /W-2|1099|tax returns?|file your taxes/i },
  { id: "household_info", en: "Household members' information", es: "Datos de las personas del hogar", re: /household (size|members?)|each member of your household/i },
  { id: "ssn", en: "Social Security number", es: "Número de Seguro Social", re: /social security|\bSSN\b/i },
  { id: "itin", en: "ITIN", es: "ITIN", re: /\bITIN\b|individual taxpayer identification/i },
  { id: "proof_of_pregnancy", en: "Proof of pregnancy", es: "Comprobante de embarazo", re: /pregnan/i },
  { id: "immunization_records", en: "Immunization records", es: "Registro de vacunas", re: /immuniz|vaccin/i },
  { id: "medical_documents", en: "Medical documents", es: "Documentos médicos", re: /medical (documents|records)|health examination|disability award/i },
  { id: "student_records", en: "Student ID or school records", es: "Documentos escolares", re: /student id|report card|transcript|housing questionnaire/i },
  {
    id: "immigration_documents",
    en: "Immigration documents",
    es: "Documentos migratorios",
    re: /immigration (status|documents?)|naturalization|green card|permanent resident/i,
    sensitive: true,
  },
];
const DOC_BY_ID = new Map(DOC_PATTERNS.map((d) => [d.id, d]));

/** Document ids a "bring" text mentions, in DOC_PATTERNS order. */
export function extractDocs(texts: string[]): string[] {
  const text = texts.join(" \n ");
  if (/do not need to submit any documents|not required to submit documentation/i.test(text) && text.length < 120) return [];
  return DOC_PATTERNS.filter((d) => d.re.test(text)).map((d) => d.id);
}

export function docLabel(id: string, lang: string): string {
  const d = DOC_BY_ID.get(id);
  if (!d) return id;
  return lang.startsWith("en") ? d.en : d.es;
}

export function isSensitiveDoc(id: string): boolean {
  return DOC_BY_ID.get(id)?.sensitive === true;
}

/**
 * Where a document can be had, from facts already in the catalog. Programs by id
 * (used only if present), places by org_type. Each line says why, in English.
 */
export const DOC_SOURCES: Record<string, { programs: string[]; orgTypes: OrgType[]; why: string }> = {
  photo_id: {
    programs: ["prog-idnyc"],
    orgTypes: ["idnyc", "consulate"],
    why: "IDNYC is a free photo ID for New Yorkers 10 and older; a consulate issues ID to its own nationals.",
  },
  passport: { programs: [], orgTypes: ["consulate"], why: "Passports are issued by your country's consulate." },
  birth_certificate: {
    programs: [],
    orgTypes: ["consulate"],
    why: "Consulates can issue birth certificate copies to their own nationals.",
  },
};

// ---------- inferred offers ----------

/**
 * Places whose type or official name already says they deliver a program the
 * catalog describes, but no curated Link says so yet. Each rule restates the
 * record (an IDNYC enrollment desk offers IDNYC).
 */
export const OFFER_RULES: Array<{ program: string; test: (p: Place) => boolean; why: string }> = [
  { program: "prog-idnyc", test: (p) => p.org_type === "idnyc", why: "Listed as an IDNYC enrollment center." },
  {
    program: "prog-school-enrollment",
    test: (p) => /family welcome center/i.test(p.name),
    why: "NYC Public Schools Family Welcome Centers enroll students.",
  },
  {
    program: "prog-snap",
    test: (p) => p.org_type === "benefits_office" && /\bSNAP\b/i.test(p.name),
    why: "Named as an HRA SNAP center.",
  },
  {
    program: "prog-cash-assistance",
    test: (p) => p.org_type === "benefits_office" && /\bjob center\b/i.test(p.name),
    why: "HRA Job Centers take Cash Assistance applications.",
  },
  { program: "prog-wic", test: (p) => /\bWIC\b/.test(p.name), why: "Named as a WIC site." },
  {
    program: "prog-medicaid",
    test: (p) => p.org_type === "benefits_office" && /\bmedicaid\b/i.test(p.name),
    why: "Named as an HRA Medicaid office.",
  },
  { program: "prog-workforce1", test: (p) => /\bworkforce ?1\b/i.test(p.name), why: "Named as a Workforce1 career center." },
  { program: "prog-homebase", test: (p) => /\bhomebase\b/i.test(p.name), why: "Listed by the City as a Homebase site." },
  { program: "prog-family-justice-centers", test: (p) => /family justice center/i.test(p.name), why: "Listed by the City as a Family Justice Center." },
  { program: "prog-jobs-plus", test: (p) => /\bjobs[- ]plus\b/i.test(p.name), why: "Listed by the City as a Jobs-Plus site." },
  {
    program: "prog-nyc-care",
    test: (p) => /NYC Health ?\+ ?Hospitals|\bNYC H ?\+ ?H\b/i.test(`${p.name} ${p.org ?? ""}`),
    why: "NYC Care services are at NYC Health + Hospitals locations.",
  },
  {
    program: "prog-library-card",
    test: (p) => /\bpublic library\b/i.test(`${p.name} ${p.org ?? ""}`) && !/^place-doj/.test(p.id),
    why: "A public library branch in NYC issues library cards.",
  },
];

// ---------- the graph ----------

export interface GraphInput {
  places: Place[];
  programs: Program[];
  links: Link[];
}

export interface KnowledgeGraph {
  nodes: Map<string, KNode>;
  edges: KEdge[];
  out: Map<string, KEdge[]>;
  in: Map<string, KEdge[]>;
  /** public place id -> org node id */
  orgOf: Map<string, string>;
  /** Places that are people (never shown); kept so callers can drop them. */
  people: Set<string>;
  /** Offers the rules above add (place id -> program ids), for the ranking. */
  inferredOffers: Map<string, Array<{ program: string; why: string }>>;
  /** Program -> program "do this first" edges inferred from documents (A gives a doc B asks for). */
  inferredUnlocks: Array<{ from: string; to: string; doc: string; why: string }>;
  branches(orgId: string): Place[];
  docsFor(programId: string): string[];
  whereToGet(docId: string): { programs: Program[]; places: Place[]; orgTypes: OrgType[]; why: string } | null;
  neighbors(id: string, rel?: Rel): KEdge[];
}

const placeNode = (id: string) => `place:${id}`;
const programNode = (id: string) => `program:${id}`;

export function buildGraph(input: GraphInput): KnowledgeGraph {
  const nodes = new Map<string, KNode>();
  const edges: KEdge[] = [];
  const seen = new Set<string>();
  const node = (n: KNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  const edge = (e: KEdge) => {
    const k = `${e.from}|${e.rel}|${e.to}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push(e);
  };

  for (const need of NEEDS) node({ id: `need:${need}`, kind: "need", label: need });

  const programById = new Map(input.programs.map((p) => [p.id, p]));
  for (const prog of input.programs) {
    const id = node({ id: programNode(prog.id), kind: "program", label: prog.name, ref: prog.id });
    for (const n of asList(prog.needs)) edge({ from: id, to: `need:${n}`, rel: "serves", source: "data" });
  }

  // Programs -> documents they ask for.
  const docsByProgram = new Map<string, string[]>();
  for (const prog of input.programs) {
    const docs = extractDocs(asList(prog.bring));
    docsByProgram.set(prog.id, docs);
    for (const d of docs) {
      const doc = DOC_BY_ID.get(d)!;
      node({ id: `doc:${d}`, kind: "doc", label: doc.en, label_es: doc.es });
      edge({ from: programNode(prog.id), to: `doc:${d}`, rel: "asks_for", source: "inferred", why: `Its "what to bring" text mentions ${doc.en.toLowerCase()}.` });
    }
  }

  // Places, organizations, geography, languages.
  const people = new Set<string>();
  const members = new Map<string, Place[]>();
  const reps = new Map<string, number>();
  for (const p of input.places) {
    const key = `org:${orgKey(p)}`;
    if (isPerson(p)) {
      people.add(p.id);
      reps.set(key, (reps.get(key) ?? 0) + 1);
      continue;
    }
    members.set(key, [...(members.get(key) ?? []), p]);
  }
  const orgOf = new Map<string, string>();
  for (const [key, list] of members) {
    node({ id: key, kind: "org", label: orgLabel(list), ...(reps.get(key) ? { accredited_reps: reps.get(key) } : {}) });
    for (const p of list) orgOf.set(p.id, key);
  }

  const inferredOffers = new Map<string, Array<{ program: string; why: string }>>();
  for (const p of input.places) {
    if (people.has(p.id)) continue;
    const id = node({ id: placeNode(p.id), kind: "place", label: p.name, ref: p.id });
    edge({ from: id, to: orgOf.get(p.id)!, rel: "branch_of", source: "data" });
    // Needs: a submission's own needs replace the org_type default (a "clinic" that does legal intake).
    const own = asList((p as Place & { needs?: unknown }).needs).filter((n) => (NEEDS as readonly string[]).includes(n));
    for (const n of own.length ? own : ORG_TYPE_NEEDS[p.org_type] ?? []) edge({ from: id, to: `need:${n}`, rel: "serves", source: "data" });
    const zip = String(p.zip ?? "");
    if (/^\d{5}$/.test(zip)) {
      const z = node({ id: `zip:${zip}`, kind: "zip", label: zip });
      edge({ from: id, to: z, rel: "in_zip", source: "data" });
      const hood = zipToNeighborhood(zip);
      const borough = zipToBorough(zip) ?? (p.borough || undefined);
      if (hood) {
        const h = node({ id: `hood:${slug(hood)}`, kind: "hood", label: hood });
        edge({ from: z, to: h, rel: "in_hood", source: "data" });
        if (borough) edge({ from: h, to: node({ id: `borough:${slug(borough)}`, kind: "borough", label: borough }), rel: "in_borough", source: "data" });
      }
      if (borough) edge({ from: z, to: node({ id: `borough:${slug(borough)}`, kind: "borough", label: borough }), rel: "in_borough", source: "data" });
    }
    for (const l of asList(p.languages)) {
      const code = l.toLowerCase().split("-")[0];
      edge({ from: id, to: node({ id: `lang:${code}`, kind: "lang", label: code }), rel: "speaks", source: "data" });
    }
    for (const rule of OFFER_RULES) {
      if (!programById.has(rule.program) || !rule.test(p)) continue;
      inferredOffers.set(p.id, [...(inferredOffers.get(p.id) ?? []), { program: rule.program, why: rule.why }]);
    }
  }

  // Curated links.
  const endpoint = (id: string) => (id.startsWith("prog-") ? programNode(id) : placeNode(id));
  for (const l of input.links) {
    const from = endpoint(l.from_id), to = endpoint(l.to_id);
    if (!nodes.has(from) || !nodes.has(to)) continue;
    edge({ from, to, rel: l.type as Rel, source: "link", why: l.reason });
  }
  // Inferred offers, unless a Link already says it.
  for (const [placeId, list] of inferredOffers) {
    for (const o of list) edge({ from: placeNode(placeId), to: programNode(o.program), rel: "offers", source: "inferred", why: o.why });
  }
  // Offered programs' needs count for the place too.
  for (const e of [...edges]) {
    if (e.rel !== "offers") continue;
    for (const n of asList(programById.get(e.to.slice("program:".length))?.needs)) {
      edge({ from: e.from, to: `need:${n}`, rel: "serves", source: e.source === "link" ? "link" : "inferred", why: "Offers a program for this need." });
    }
  }

  // Documents -> where to get them, and the "do this first" chains they imply.
  const inferredUnlocks: KnowledgeGraph["inferredUnlocks"] = [];
  const curated = new Set(input.links.filter((l) => l.type !== "offers").map((l) => `${l.from_id}|${l.to_id}`));
  for (const [docId, src] of Object.entries(DOC_SOURCES)) {
    if (!nodes.has(`doc:${docId}`)) continue;
    for (const pid of src.programs) {
      if (!programById.has(pid)) continue;
      edge({ from: programNode(pid), to: `doc:${docId}`, rel: "gives", source: "inferred", why: src.why });
      for (const [progId, docs] of docsByProgram) {
        if (progId === pid || !docs.includes(docId) || curated.has(`${pid}|${progId}`)) continue;
        const why = `${programById.get(progId)!.name} asks for ${DOC_BY_ID.get(docId)!.en.toLowerCase()}; ${programById.get(pid)!.name} gives you one.`;
        inferredUnlocks.push({ from: pid, to: progId, doc: docId, why });
        edge({ from: programNode(pid), to: programNode(progId), rel: "unlocks", source: "inferred", why });
      }
    }
    for (const p of input.places) {
      if (!people.has(p.id) && src.orgTypes.includes(p.org_type)) {
        edge({ from: placeNode(p.id), to: `doc:${docId}`, rel: "gives", source: "inferred", why: src.why });
      }
    }
  }

  const out = new Map<string, KEdge[]>();
  const inn = new Map<string, KEdge[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  const placeById = new Map(input.places.map((p) => [p.id, p]));

  return {
    nodes,
    edges,
    out,
    in: inn,
    orgOf,
    people,
    inferredOffers,
    inferredUnlocks,
    branches: (orgId) => (members.get(orgId) ?? []),
    docsFor: (programId) => docsByProgram.get(programId) ?? [],
    whereToGet(docId) {
      const src = DOC_SOURCES[docId];
      if (!src) return null;
      const programs = src.programs.map((id) => programById.get(id)).filter((p): p is Program => !!p);
      const places = (inn.get(`doc:${docId}`) ?? [])
        .filter((e) => e.rel === "gives" && e.from.startsWith("place:"))
        .map((e) => placeById.get(e.from.slice("place:".length)))
        .filter((p): p is Place => !!p);
      return { programs, places, orgTypes: src.orgTypes, why: src.why };
    },
    neighbors(id, rel) {
      const all = [...(out.get(id) ?? []), ...(inn.get(id) ?? [])];
      return rel ? all.filter((e) => e.rel === rel) : all;
    },
  };
}

/** Cached per catalog object, so one request builds the graph once. */
const cache = new WeakMap<object, KnowledgeGraph>();
export function graphOf(cat: GraphInput): KnowledgeGraph {
  let g = cache.get(cat);
  if (!g) {
    g = buildGraph(cat);
    cache.set(cat, g);
  }
  return g;
}

/** Needs a place serves according to the graph (own needs, else org_type, plus offered programs). */
export function graphNeeds(g: KnowledgeGraph, placeId: string): Set<Need> {
  const out = new Set<Need>();
  for (const e of g.out.get(placeNode(placeId)) ?? []) if (e.rel === "serves") out.add(e.to.slice("need:".length) as Need);
  return out;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return v.split("|").map((s) => s.trim()).filter(Boolean);
  return [];
}

function slug(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
