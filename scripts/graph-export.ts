// Export the knowledge graph (shared/graph.ts) built from data/*.json as open data.
//
//   deno run -A scripts/graph-export.ts
//   -> web/public/graph/knowledge-graph.json   { generated, counts, nodes, edges }
//   -> web/public/graph/nodes.csv, edges.csv   the same, for spreadsheets and the Hugging Face dataset
//
// Run after scripts/base44-pull.ts; then `npm --prefix web run graph:data` folds it into the Mapa page.
// Individual people are never exported (they are not nodes; organizations carry a count).

import { buildGraph } from "../shared/graph.ts";
import type { Link, Place, Program } from "../shared/schema.ts";

const ROOT = new URL("../", import.meta.url);
const read = async <T>(name: string): Promise<T[]> => JSON.parse(await Deno.readTextFile(new URL(`data/${name}.json`, ROOT)));
const [places, programs, links] = await Promise.all([read<Place>("Place"), read<Program>("Program"), read<Link>("Link")]);
const g = buildGraph({ places, programs, links });

const nodes = [...g.nodes.values()].map((n) => {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind, label: n.label };
  if (n.label_es) out.label_es = n.label_es;
  if (n.accredited_reps) out.accredited_reps = n.accredited_reps;
  if (n.kind === "org") out.locations = g.branches(n.id).length;
  if (n.kind === "program") out.documents = g.docsFor(n.ref!);
  return out;
});
const edges = g.edges.map((e) => ({ from: e.from, to: e.to, rel: e.rel, source: e.source, ...(e.why ? { why: e.why } : {}) }));
const count = (xs: Array<Record<string, unknown>>, k: string) =>
  xs.reduce<Record<string, number>>((m, x) => ((m[String(x[k])] = (m[String(x[k])] ?? 0) + 1), m), {});

const dir = new URL("web/public/graph/", ROOT);
await Deno.mkdir(dir, { recursive: true });
const generated = new Date().toISOString().slice(0, 10);
await Deno.writeTextFile(
  new URL("knowledge-graph.json", dir),
  JSON.stringify({
    generated,
    license: "Facts from public sources (NYC Open Data, DOJ EOIR, NYC agencies); each place keeps its source_url in data/Place.json.",
    counts: { nodes: count(nodes, "kind"), edges: count(edges, "rel"), by_source: count(edges, "source"), people_excluded: g.people.size },
    nodes,
    edges,
  }),
);
const csv = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("|") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
await Deno.writeTextFile(
  new URL("nodes.csv", dir),
  ["id,kind,label,label_es,locations,accredited_reps,documents", ...nodes.map((n) =>
    [n.id, n.kind, n.label, n.label_es, n.locations, n.accredited_reps, n.documents].map(csv).join(","))].join("\n") + "\n",
);
await Deno.writeTextFile(
  new URL("edges.csv", dir),
  ["from,to,rel,source,why", ...edges.map((e) => [e.from, e.to, e.rel, e.source, e.why].map(csv).join(","))].join("\n") + "\n",
);
console.log(`knowledge graph: ${nodes.length} nodes, ${edges.length} edges, ${g.people.size} people excluded -> web/public/graph/`);
