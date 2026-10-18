// Import public service sites from the City's Facilities Database (NYC Planning, FacDB,
// data.cityofnewyork.us ji82-xba5) into data/Place.json, for the needs our catalog was thin on:
// health, benefits, work, housing, legal, adult classes.
//
//   deno run -A scripts/import-facilities.ts            # dry run: counts per need, examples, duplicates skipped
//   deno run -A scripts/import-facilities.ts --write    # append to data/Place.json (then graph-export, pages, seed)
//
// Only the facility types in TYPES below, each an official City or State listing (HRA SNAP and
// Medicaid offices, HRA Job Centers, SBS Workforce1, DHS Homebase and drop-in centers, MOEO-funded
// legal, immigrant and adult literacy sites, NYC Health + Hospitals, NYS DOH hospitals and community
// health centers, public libraries). Same rules as the other official imports: trust "official",
// the row's own source link, last_checked = today. A row is skipped when a place with a similar name
// is already in that zip, or one already sits at the same street address. Sites of one organization at
// one address merge into one place, with every service they offer named in the place name.

import type { Need, OrgType, Place } from "../shared/schema.ts";
import { ORG_TYPE_NEEDS } from "../shared/schema.ts";
import { normalizeBorough, zipToNeighborhood } from "../shared/geo.ts";
import { similarity, stripAccents } from "../shared/text.ts";

const ROOT = new URL("../", import.meta.url);
const WRITE = Deno.args.includes("--write");
const API = "https://data.cityofnewyork.us/resource/ji82-xba5.json";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

interface Kind {
  org_type: OrgType;
  needs: Need[];
  en: string; // service label shown in the name
  /** Optional name filter (community health centers among all diagnostic & treatment centers). */
  keep?: RegExp;
}

const FQHC_NAMES =
  /health center|healthcare|health care|community health|family health|medical center|clinic|ryan|urban health|charles b\.? wang|betances|morris heights|ezra|addabbo|sunset park|lutheran|nyu langone family|institute for family health|community healthcare network|planned parenthood|callen-lorde|apicha|bronx-lebanon|metropolitan|union community|settlement health|harlem united|segundo ruiz belvis|la casa de salud/i;

const TYPES: Record<string, Kind> = {
  "SNAP CENTER": { org_type: "benefits_office", needs: ["benefits", "food"], en: "SNAP center" },
  "MEDICAID OFFICE": { org_type: "benefits_office", needs: ["benefits", "health"], en: "Medicaid office" },
  "JOBS AND SERVICE CENTER": { org_type: "benefits_office", needs: ["benefits", "money", "work"], en: "HRA Job Center" },
  "WORKFORCE1 CAREER CENTER": { org_type: "other", needs: ["work"], en: "Workforce1 career center" },
  "WORKFORCE 1 CAREER CENTERS": { org_type: "other", needs: ["work"], en: "Workforce1 career center" },
  "JOBS PLUS": { org_type: "other", needs: ["work"], en: "Jobs-Plus" },
  "IMMIGRANT WORKERS": { org_type: "other", needs: ["work"], en: "immigrant worker services" },
  "HOMEBASE HOMELESSNESS PREVENTION": { org_type: "other", needs: ["housing"], en: "Homebase homelessness prevention" },
  "DROP-IN CENTER": { org_type: "other", needs: ["housing"], en: "drop-in center" },
  "DROP-IN CENTERS": { org_type: "other", needs: ["housing"], en: "drop-in center" },
  "LEGAL SERVICES": { org_type: "other", needs: ["legal"], en: "legal services" },
  "FAMILY JUSTICE CENTER": { org_type: "other", needs: ["legal", "health", "housing"], en: "Family Justice Center" },
  "IMMIGRANT SERVICES": { org_type: "other", needs: ["legal"], en: "immigrant services" },
  "IMMIGRANT FAMILY SERVICES": { org_type: "other", needs: ["legal", "benefits"], en: "immigrant family services" },
  "LEGAL SERVICES FOR IMMIGRANT YOUTH": { org_type: "other", needs: ["legal"], en: "legal services for immigrant youth" },
  "CIVICS CLASSES": { org_type: "other", needs: ["school"], en: "civics classes" },
  "ADULT LITERACY - ENGLISH FOR SPEAKERS OF OTHER LANGUAGES": { org_type: "other", needs: ["school"], en: "English classes (ESL)" },
  "ADULT LITERACY - ADULT BASIC EDUCATION/HIGH SCHOOL EQUIVALENCY": { org_type: "other", needs: ["school"], en: "adult education / HSE" },
  "ADULT LITERACY": { org_type: "other", needs: ["school"], en: "adult literacy" },
  "PUBLIC LIBRARY": { org_type: "other", needs: ["school"], en: "public library" },
  "CHILD HEALTH CENTER": { org_type: "clinic", needs: ["health"], en: "child health center" },
  "ACUTE CARE HOSPITAL": { org_type: "clinic", needs: ["health"], en: "hospital" },
  "DIAGNOSTIC & TREATMENT CENTER": { org_type: "clinic", needs: ["health"], en: "health center" },
  "HOSPITAL": { org_type: "clinic", needs: ["health"], en: "hospital" },
  "DIAGNOSTIC AND TREATMENT CENTER": { org_type: "clinic", needs: ["health"], en: "health center", keep: FQHC_NAMES },
};

// ---------- fetch ----------

const where = `factype in (${Object.keys(TYPES).map((t) => `'${t.replace(/'/g, "''")}'`).join(",")})`;
const url = `${API}?${new URLSearchParams({
  $where: where,
  $select: "uid,facname,address,zipcode,boro,factype,opname,datasource,latitude,longitude",
  $limit: "5000",
})}`;
const rows = (await (await fetch(url)).json()) as Array<Record<string, string>>;
console.log(`FacDB rows for ${Object.keys(TYPES).length} types: ${rows.length}`);

// ---------- clean ----------

const KEEP_UPPER = new Set(["NYC", "HRA", "SNAP", "ESL", "HSE", "NY", "DOE", "YMCA", "YWCA", "CUNY", "NYPL", "BPL", "LGBT", "HIV", "II", "III", "IV"]);
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z][a-z'.&+-]*)/g, (w) => {
    const up = w.toUpperCase();
    if (KEEP_UPPER.has(up.replace(/[.']/g, ""))) return up;
    if (["of", "and", "the", "for", "in", "at", "de", "la", "del"].includes(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).replace(/^./, (c) => c.toUpperCase()).replace(/\bInc\b\.?/g, "Inc.").replace(/\s+/g, " ").trim();
}
const slug = (s: string) => stripAccents(s.toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).replace(/-+$/, "");
const streetKey = (a: string) => stripAccents(a.toLowerCase()).replace(/\b(street|st|avenue|ave|road|rd|place|pl|boulevard|blvd|east|west|e|w)\b/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

interface Site {
  name: string;
  org: string;
  address: string;
  zip: string;
  borough: string;
  lat: number;
  lng: number;
  org_type: OrgType;
  needs: Set<Need>;
  services: string[];
  uid: string;
}

const sites = new Map<string, Site>();
let filtered = 0;
for (const r of rows) {
  const kind = TYPES[r.factype];
  if (!kind || !/^\d{5}$/.test(r.zipcode ?? "") || !r.address) continue;
  if (kind.keep && !kind.keep.test(r.facname ?? "")) {
    filtered++;
    continue;
  }
  const name = titleCase(r.facname ?? "");
  const key = `${slug(r.opname || r.facname)}|${streetKey(r.address)}|${r.zipcode}`;
  const s = sites.get(key) ?? {
    name,
    org: titleCase(r.opname || r.facname || ""),
    address: /,\s*NY\b/i.test(r.address) ? titleCase(r.address) : `${titleCase(r.address)}, ${titleCase(r.boro === "MANHATTAN" ? "New York" : r.boro)}, NY ${r.zipcode}`,
    zip: r.zipcode,
    borough: normalizeBorough(r.boro) ?? titleCase(r.boro),
    lat: Number(r.latitude),
    lng: Number(r.longitude),
    org_type: kind.org_type,
    needs: new Set<Need>(),
    services: [],
    uid: r.uid,
  };
  for (const n of kind.needs) s.needs.add(n);
  if (!s.services.includes(kind.en)) s.services.push(kind.en);
  // A clinic or benefits office at the same site sets the type; "other" never overrides it.
  if (s.org_type === "other" && kind.org_type !== "other") s.org_type = kind.org_type;
  sites.set(key, s);
}

// ---------- dedupe against the catalog ----------

const places = JSON.parse(await Deno.readTextFile(new URL("data/Place.json", ROOT))) as Place[];
const byZip = new Map<string, Place[]>();
for (const p of places) byZip.set(p.zip, [...(byZip.get(p.zip) ?? []), p]);
const taken = new Set(places.map((p) => p.id));

const added: Array<Place & { needs: Need[] }> = [];
const dupes: string[] = [];
const enriched: string[] = [];
for (const s of sites.values()) {
  const here = byZip.get(s.zip) ?? [];
  const same = here.find((p) =>
    similarity(p.name, s.name) >= 0.8 || similarity(p.org ?? "", s.org) >= 0.9 && streetKey(p.address.split(",")[0]) === streetKey(s.address.split(",")[0]) ||
    streetKey(p.address.split(",")[0]) === streetKey(s.address.split(",")[0]) && similarity(p.name, s.name) >= 0.5
  );
  if (same) {
    // Already listed: it also does what this row says (a pantry that teaches English). Its own needs
    // replace the org_type default, so keep that default in the list too.
    const have = new Set<Need>([...(((same as Place & { needs?: Need[] }).needs ?? []) as Need[]), ...(ORG_TYPE_NEEDS[same.org_type] ?? [])]);
    const extra = [...s.needs].filter((n) => !have.has(n));
    if (extra.length) {
      (same as Place & { needs?: Need[] }).needs = [...have, ...extra];
      enriched.push(`${same.name} + ${extra.join(", ")}`);
    }
    dupes.push(`${s.name} = ${same.name}`);
    continue;
  }
  // Name the services the name does not already say: "Coney Island Hospital (child health center)".
  const lower = s.name.toLowerCase();
  const missing = s.services.filter((x) => !/^(public library|hospital)$/.test(x) || !lower.includes(x.split(" ").pop()!))
    .filter((x) => !lower.includes(x.toLowerCase().split(/[ (]/)[0]));
  const name = missing.length ? `${s.name} (${missing.join(", ")})` : s.name;
  let id = `place-fac-${slug(s.name)}-${s.zip}`;
  for (let i = 2; taken.has(id); i++) id = `place-fac-${slug(s.name)}-${s.zip}-${i}`;
  taken.add(id);
  added.push({
    id,
    name,
    org: s.org,
    org_type: s.org_type,
    address: s.address,
    borough: s.borough,
    zip: s.zip,
    lat: s.lat,
    lng: s.lng,
    hours: "",
    open_evenings: false,
    open_weekends: false,
    languages: [],
    phone: "",
    trust: "official",
    source_url: `${API}?uid=${s.uid}`,
    last_checked: today,
    needs: [...s.needs],
  });
}

// Same name at several addresses (a library system, one nonprofit's sites): add the neighborhood or street.
const nameCount = new Map<string, number>();
for (const p of added) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
for (const p of added) {
  if ((nameCount.get(p.name) ?? 0) < 2) continue;
  const where = zipToNeighborhood(p.zip) ?? p.address.split(",")[0];
  p.name = p.name.replace(/^([^(]+?)(\s*\(.*\))?$/, (_, base: string, rest = "") => `${base.trim()} - ${where}${rest}`);
}

const perNeed: Record<string, number> = {};
for (const p of added) for (const n of p.needs) perNeed[n] = (perNeed[n] ?? 0) + 1;
console.log(`sites after merging: ${sites.size} (filtered non-community D&TCs: ${filtered})`);
console.log(`already in the catalog: ${dupes.length}; new: ${added.length}`);
console.log("new places per need:", perNeed);
console.log("examples:", added.slice(0, 8).map((p) => `${p.name} | ${p.address}`).join("\n  "));
console.log("duplicates (first 8):", dupes.slice(0, 8).join("\n  "));
console.log(`existing places that gain a need: ${enriched.length}`, enriched.slice(0, 6).join("; "));

if (WRITE) {
  await Deno.writeTextFile(new URL("data/Place.json", ROOT), JSON.stringify([...places, ...added], null, 2) + "\n");
  console.log(`\nwrote ${added.length} places to data/Place.json. Next: graph-export, graph:data, pages, base44-seed.`);
}
