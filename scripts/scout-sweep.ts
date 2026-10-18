// Big citywide Scout sweep: many Tavily searches -> pending Submissions on Base44.
// Nothing goes live: every draft waits in the review queue for a person.
//
//   deno run -A scripts/scout-sweep.ts [--url https://inmigracion-nyc.com/functions/scout] [--concurrency 3]
//   deno run -A scripts/scout-sweep.ts --gaps [--max 60]   # only neighborhood + need pairs with nothing listed
//
// --gaps reads data/*.json (run scripts/base44-pull.ts first) and builds the knowledge graph, then
// searches each neighborhood + need that has no place yet, core needs first (food, health, legal,
// then housing, work, benefits, id, school). That is the search that fills the holes the
// insights page shows.
//
// Reads ADMIN_TOKEN from .env. Prints one line per query (counts only).

const env: Record<string, string> = {};
for (const line of (await Deno.readTextFile(new URL("../.env", import.meta.url))).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const arg = (k: string, d: string) => { const i = Deno.args.indexOf(`--${k}`); return i >= 0 ? Deno.args[i + 1] : d; };
const URL_ = arg("url", "https://inmigracion-nyc.com/functions/scout");
const CONC = Number(arg("concurrency", "3"));

const TOPICS = [
  "food pantry", "soup kitchen free meals", "nonprofit immigration legal services", "low cost immigration lawyer",
  "legal aid tenant rights", "know your rights workshop immigrants", "WIC office", "SNAP benefits center",
  "community health center sliding scale", "free mental health counseling Spanish", "IDNYC enrollment site",
  "family welcome center school enrollment", "free ESL classes adults", "adult education GED Spanish",
  "after school program free", "worker center day laborers", "job training program immigrants",
  "domestic violence services Spanish", "shelter intake families", "free tax preparation ITIN",
  "credit union open account IDNYC", "public library immigrant services", "consulate", "baby supplies diapers free",
];
const BOROUGHS = ["Queens", "Brooklyn", "Bronx", "Manhattan", "Staten Island"];
// --queries <file>: one query per line (e.g. to retry the ones that failed).
const qfile = arg("queries", "");
const GAP_TOPICS: Record<string, string> = {
  food: "free food pantry",
  health: "community health center low cost clinic",
  legal: "free immigration legal services",
  housing: "tenant help housing assistance",
  work: "job training employment center",
  benefits: "SNAP Medicaid enrollment help",
  id: "IDNYC enrollment",
  school: "free ESL English classes adults",
};

async function gapQueries(max: number): Promise<string[]> {
  const { buildGraph, graphNeeds } = await import("../shared/graph.ts");
  const { NEIGHBORHOOD_ZIPS, zipToBorough } = await import("../shared/geo.ts");
  const read = async (n: string) => JSON.parse(await Deno.readTextFile(new URL(`../data/${n}.json`, import.meta.url)));
  const places = await read("Place");
  const g = buildGraph({ places, programs: await read("Program"), links: await read("Link") });
  const zipHood = new Map<string, string>();
  for (const [h, zs] of Object.entries(NEIGHBORHOOD_ZIPS)) for (const z of zs) if (!zipHood.has(z)) zipHood.set(z, h);
  const have = new Set<string>();
  for (const p of places) {
    const h = zipHood.get(p.zip);
    if (h && !g.people.has(p.id)) for (const n of graphNeeds(g, p.id)) have.add(`${h}|${n}`);
  }
  const out: string[] = [];
  for (const need of Object.keys(GAP_TOPICS)) {
    for (const [hood, zips] of Object.entries(NEIGHBORHOOD_ZIPS)) {
      if (!have.has(`${hood}|${need}`)) out.push(`${GAP_TOPICS[need]} ${hood} ${zipToBorough(zips[0]) ?? ""}`.trim());
    }
  }
  console.log(`${out.length} neighborhood + need pairs with nothing listed; searching the first ${Math.min(max, out.length)}`);
  return out.slice(0, max);
}

const queries = qfile
  ? (await Deno.readTextFile(qfile)).split("\n").map((l) => l.trim()).filter(Boolean)
  : Deno.args.includes("--gaps")
  ? await gapQueries(Number(arg("max", "60")))
  : TOPICS.flatMap((t) => BOROUGHS.map((b) => `${t} ${b}`));

let done = 0, drafted = 0, dupes = 0, failed = 0;
async function run(q: string) {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": env.ADMIN_TOKEN },
      body: JSON.stringify({ query: q, max_results: 5 }),
      signal: AbortSignal.timeout(170_000),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(String(d?.error ?? r.status));
    drafted += d.drafted ?? 0; dupes += d.skipped_duplicates ?? 0;
    console.log(`[${++done}/${queries.length}] ${q}: +${d.drafted ?? 0} drafts, ${d.skipped_duplicates ?? 0} known`);
  } catch (e) {
    failed++;
    console.log(`[${++done}/${queries.length}] ${q}: FAILED ${e instanceof Error ? e.message.slice(0, 80) : ""}`);
  }
}
const queue = [...queries];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await run(queue.shift()!); }));
console.log(`\nDone: ${queries.length} searches, ${drafted} new pending drafts, ${dupes} already known, ${failed} failed.`);
