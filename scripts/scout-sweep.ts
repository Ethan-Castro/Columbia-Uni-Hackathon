// Big citywide Scout sweep: many Tavily searches -> pending Submissions on Base44.
// Nothing goes live: every draft waits in the review queue for a person.
//
//   deno run -A scripts/scout-sweep.ts [--url https://inmigracion-nyc.com/functions/scout] [--concurrency 3]
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
const queries = qfile
  ? (await Deno.readTextFile(qfile)).split("\n").map((l) => l.trim()).filter(Boolean)
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
