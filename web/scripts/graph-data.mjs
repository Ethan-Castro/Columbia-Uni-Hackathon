// Builds web/public/graph.json for the "Mapa de recursos" page (src/pages/Graph.tsx).
//
//   npm --prefix web run graph:data
//
// Reads ../data/Place.json, Program.json and Link.json and writes compact nodes
// (need hubs, programs, places) and edges, with a pre-computed force layout
// (x, y) so the browser never has to run the simulation.
//
// Individual people are left out: DOJ accredited representatives listed by
// person ("Last, First" names or no address). Organizations stay.
// Needs per place follow shared/rank.ts placeNeeds(): org_type defaults plus
// the needs of programs the place offers (plus an optional `needs` array).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { forceSimulation, forceLink, forceManyBody, forceCollide } from "d3-force";

const root = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(root(p), "utf8"));

const NEEDS = ["food", "legal", "health", "benefits", "money", "school", "id", "housing", "work", "transit"];
// Ring order for the hubs: the two big clusters (food, legal) sit opposite each other.
const RING = ["food", "health", "benefits", "id", "money", "legal", "school", "housing", "work", "transit"];

// Same defaults as shared/rank.ts PLACE_ORG_NEEDS.
const PLACE_ORG_NEEDS = {
  doj_roster: ["legal"], doj_pro_bono: ["legal"], pantry: ["food"], consulate: ["id"], clinic: ["health"],
  benefits_office: ["benefits", "food", "health"], idnyc: ["id"], remittance: ["money"], check_casher: ["money"],
  school: ["school"], other: [],
};

const places = read("../../data/Place.json");
const programs = read("../../data/Program.json");
const links = read("../../data/Link.json");

// Neighborhood names by zip, taken from shared/geo.ts NEIGHBORHOOD_ZIPS (same rule as zipToNeighborhood).
function loadNeighborhoods() {
  try {
    const src = readFileSync(root("../../shared/geo.ts"), "utf8");
    const m = /NEIGHBORHOOD_ZIPS[^=]*=\s*(\{[\s\S]*?\n\});/.exec(src);
    if (!m) return () => "";
    const body = m[1].replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1");
    const table = JSON.parse(body);
    return (zip) => {
      let any = "";
      for (const [name, zips] of Object.entries(table)) {
        if (zips[0] === zip) return name;
        if (!any && zips.includes(zip)) any = name;
      }
      return any;
    };
  } catch {
    return () => "";
  }
}
const hoodOf = loadNeighborhoods();

const DOJ = new Set(["doj_roster", "doj_pro_bono"]);
const PERSON_RE = /^[^,()]+,\s*[^,()]+$/; // "Last, First Middle"
const ORG_WORD_RE = /\b(inc|llc|corp|services|center|society|foundation|church|project|council|association|office|ltd|pllc|nyc|ny|york)\b/i;
function isPerson(p) {
  if (!DOJ.has(p.org_type)) return false;
  if (!String(p.address ?? "").trim()) return true;
  return PERSON_RE.test(p.name) && !ORG_WORD_RE.test(p.name);
}

// The knowledge graph export (scripts/graph-export.ts) is the source of truth for who is a person,
// organizations, documents and inferred connections. Without it, fall back to the simple rules here.
let kg = null;
try {
  kg = read("../public/graph/knowledge-graph.json");
} catch {
  console.warn("graph-data: no public/graph/knowledge-graph.json; run deno run -A scripts/graph-export.ts for the full graph");
}
const kgPlaces = kg ? new Set(kg.nodes.filter((n) => n.kind === "place").map((n) => n.id.slice("place:".length))) : null;
const keptPlaces = places.filter((p) => (kgPlaces ? kgPlaces.has(p.id) : !isPerson(p)));
const kgNode = new Map((kg?.nodes ?? []).map((n) => [n.id, n]));
const orgOfPlace = new Map((kg?.edges ?? []).filter((e) => e.rel === "branch_of").map((e) => [e.from.slice("place:".length), kgNode.get(e.to)]));
const DOC_LABELS = new Map((kg?.nodes ?? []).filter((n) => n.kind === "doc").map((n) => [n.id.slice("doc:".length), { en: n.label, es: n.label_es }]));
const programById = new Map(programs.map((g) => [g.id, g]));
const placeIds = new Set(keptPlaces.map((p) => p.id));

const offers = new Map(); // place id -> program ids
// Inferred connections from the knowledge graph (an IDNYC desk offers IDNYC; IDNYC before WIC), with their reasons.
const inferred = (kg?.edges ?? [])
  .filter((e) => e.source === "inferred" && (e.rel === "offers" || e.rel === "unlocks"))
  .map((e) => ({ from_id: e.from.replace(/^(place|program):/, ""), to_id: e.to.replace(/^(place|program):/, ""), type: e.rel, reason: e.why }));
const allLinks = [...links, ...inferred.filter((x) => !links.some((l) => l.from_id === x.from_id && l.to_id === x.to_id && l.type === x.type))];
for (const l of allLinks) {
  if (l.type === "offers" && placeIds.has(l.from_id) && programById.has(l.to_id)) {
    if (!offers.has(l.from_id)) offers.set(l.from_id, []);
    if (!offers.get(l.from_id).includes(l.to_id)) offers.get(l.from_id).push(l.to_id);
  }
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const nodes = [];
const edges = [];

for (const n of NEEDS) nodes.push({ id: `need-${n}`, type: "need", label: n, needs: [n] });

for (const g of programs) {
  nodes.push({
    id: g.id,
    type: "program",
    label: g.name,
    needs: (g.needs ?? []).filter((n) => NEEDS.includes(n)),
    summary_es: clean(g.summary_es),
    summary_en: clean(g.summary_en),
    who: clean(g.who_can_use),
    source_url: clean(g.source_url),
    last_checked: clean(g.last_checked),
    ...(() => {
      const docs = kgNode.get(`program:${g.id}`)?.documents ?? [];
      return docs.length
        ? { docs_es: docs.map((d) => DOC_LABELS.get(d)?.es ?? d), docs_en: docs.map((d) => DOC_LABELS.get(d)?.en ?? d) }
        : {};
    })(),
  });
}

for (const p of keptPlaces) {
  // Same rule as shared/rank.ts placeNeeds: a place's own needs replace the org_type default.
  const own = Array.isArray(p.needs) ? p.needs.filter((n) => NEEDS.includes(n)) : [];
  const needs = new Set(own.length ? own : PLACE_ORG_NEEDS[p.org_type] ?? []);
  for (const gid of offers.get(p.id) ?? []) for (const n of programById.get(gid).needs ?? []) needs.add(n);
  const node = {
    id: p.id,
    type: "place",
    label: p.name,
    borough: clean(p.borough),
    zip: clean(p.zip),
    hood: hoodOf(clean(p.zip)),
    org_type: clean(p.org_type),
    needs: NEEDS.filter((n) => needs.has(n)),
    trust: clean(p.trust),
    address: clean(p.address),
    phone: clean(p.phone),
    hours: clean(p.hours),
    languages: Array.isArray(p.languages) ? p.languages : [],
    source_url: clean(p.source_url),
    last_checked: clean(p.last_checked),
  };
  if (clean(p.org) && clean(p.org) !== node.label) node.org = clean(p.org);
  const org = orgOfPlace.get(p.id);
  if (org?.locations > 1) {
    node.org = org.label;
    node.org_locations = org.locations;
  }
  if (org?.accredited_reps) node.accredited_reps = org.accredited_reps;
  for (const k of Object.keys(node)) if (node[k] === "" || (Array.isArray(node[k]) && !node[k].length && k !== "needs")) delete node[k];
  nodes.push(node);
}

const ids = new Set(nodes.map((n) => n.id));
for (const l of allLinks) {
  if (!ids.has(l.from_id) || !ids.has(l.to_id)) continue;
  edges.push({ source: l.from_id, target: l.to_id, type: l.type, ...(l.reason ? { reason: l.reason } : {}) });
}
for (const n of nodes) {
  if (n.type === "need") continue;
  for (const need of n.needs) edges.push({ source: n.id, target: `need-${need}`, type: "need" });
}

// ---------- layout ----------
// Hubs are pinned on a ring; everything else settles around them.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const R = 560;
const hubPos = new Map(RING.map((n, i) => {
  const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
  return [`need-${n}`, [Math.cos(a) * R, Math.sin(a) * R]];
}));
const degree = new Map();
for (const e of edges) {
  degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
  degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
}
const radius = (n) => (n.type === "need" ? 16 + Math.min(18, Math.sqrt(degree.get(n.id) ?? 0)) : n.type === "program" ? 6 : 3.2);

const simNodes = nodes.map((n) => {
  const s = { id: n.id, r: radius(n) };
  if (n.type === "need") {
    [s.fx, s.fy] = hubPos.get(n.id);
    s.x = s.fx;
    s.y = s.fy;
  } else {
    const hubs = n.needs.map((k) => hubPos.get(`need-${k}`));
    const [cx, cy] = hubs.length
      ? [hubs.reduce((a, h) => a + h[0], 0) / hubs.length, hubs.reduce((a, h) => a + h[1], 0) / hubs.length]
      : [0, 0];
    s.x = cx + (rand() - 0.5) * 80;
    s.y = cy + (rand() - 0.5) * 80;
  }
  return s;
});
const simLinks = edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));

const sim = forceSimulation(simNodes)
  .randomSource(rand)
  .force("link", forceLink(simLinks).id((d) => d.id)
    .distance((l) => (l.type === "need" ? (l.source.r > 5 ? 90 : 46) : l.type === "offers" ? 24 : 70))
    .strength((l) => (l.type === "need" ? 0.5 / Math.max(1, (degree.get(l.source.id) ?? 1)) + 0.05 : 0.3)))
  .force("charge", forceManyBody().strength((d) => (d.r > 10 ? -400 : d.r > 5 ? -40 : -6)).distanceMax(260))
  .force("collide", forceCollide().radius((d) => d.r + (d.r > 10 ? 10 : 1.6)).iterations(2))
  .stop();
for (let i = 0; i < 400; i++) sim.tick();

const pos = new Map(simNodes.map((s) => [s.id, s]));
for (const n of nodes) {
  const s = pos.get(n.id);
  n.x = Math.round(s.x * 10) / 10;
  n.y = Math.round(s.y * 10) / 10;
  n.r = s.r;
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  counts: {
    places: keptPlaces.length,
    programs: programs.length,
    needs: NEEDS.length,
    people_excluded: places.length - keptPlaces.length,
    edges: edges.length,
  },
  nodes,
  edges,
};
writeFileSync(root("../public/graph.json"), JSON.stringify(out));
console.log(`graph.json: ${nodes.length} nodes, ${edges.length} edges (${out.counts.people_excluded} individual people excluded)`);
