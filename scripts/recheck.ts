// Freshness check: re-verify places against the sources they came from.
//
//   deno run -A scripts/recheck.ts              # report only -> data/recheck-report.json
//   deno run -A scripts/recheck.ts --write      # also set last_checked = today on places the source still confirms
//   flags: --limit N (web pages to fetch, default 150), --concurrency N (default 6)
//
// Run `deno run -A scripts/base44-pull.ts` first, and `scripts/base44-seed.ts` after --write.
//
// What it checks:
//   1. Food pantries (NYC Food Help ArcGIS layer, 523 rows): ONE query for the whole layer. A place is
//      confirmed when its row is still there, status "Open", same name, phone and address. A row that
//      closed, vanished, or changed since our last_checked goes in the report for a person to fix.
//   2. Places with an ordinary web page as source (nyc.gov, org sites): the page must still load and
//      still mention the place's name or phone. Broken or silent pages go in the report.
//   3. DOJ roster PDFs are listed, not fetched: EOIR republishes the roster as a new PDF; re-import it.
//
// Confirming only ever moves last_checked; any changed fact is left for a person (the report says what
// the source says now). Nothing about people is fetched or stored.

import { isPerson } from "../shared/graph.ts";
import type { Place } from "../shared/schema.ts";

const ROOT = new URL("../", import.meta.url);
const arg = (name: string, fallback: number) => {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Number(Deno.args[i + 1]) || fallback : fallback;
};
const WRITE = Deno.args.includes("--write");
const LIMIT = arg("--limit", 150);
const CONCURRENCY = arg("--concurrency", 6);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const places = JSON.parse(await Deno.readTextFile(new URL("data/Place.json", ROOT))) as Place[];
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const words = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const streetOf = (s: unknown) => words(String(s ?? "").split(",")[0]).replace(/\b(street|st|avenue|ave|road|rd|place|pl|boulevard|blvd)\b/g, "").replace(/\s+/g, " ").trim();

interface Finding {
  id: string;
  name: string;
  kind: "closed" | "missing" | "changed" | "broken_source" | "not_on_page";
  detail: string;
  source_url: string;
}
const findings: Finding[] = [];
const confirmed = new Set<string>();

// ---------- 1. ArcGIS food help layer ----------

const LAYER = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/Food_Help_Programs_PROD_view/FeatureServer/0";
const pantries = places.filter((p) => p.source_url.startsWith(LAYER));
if (pantries.length) {
  const fields = "FID,program,org_phone,distadd,distzip,status,EditDate,fp_days_orig,fp_hours_orig,sk_days_orig,sk_hours_orig";
  const res = await fetch(`${LAYER}/query?where=1%3D1&outFields=${fields}&returnGeometry=false&resultRecordCount=2000&f=json`);
  const rows = new Map<number, Record<string, unknown>>();
  for (const f of (await res.json()).features ?? []) rows.set(Number(f.attributes.FID), f.attributes);
  for (const p of pantries) {
    const fid = Number(new URL(p.source_url).searchParams.get("where")?.match(/FID=(\d+)/)?.[1]);
    const row = rows.get(fid);
    const base = { id: p.id, name: p.name, source_url: p.source_url };
    if (!row) {
      findings.push({ ...base, kind: "missing", detail: "No longer in the City's Food Help layer." });
      continue;
    }
    if (String(row.status ?? "").toLowerCase() !== "open") {
      findings.push({ ...base, kind: "closed", detail: `Source status is "${row.status}".` });
      continue;
    }
    const diffs: string[] = [];
    if (words(row.program) !== words(p.name)) diffs.push(`name now "${row.program}"`);
    if (digits(row.org_phone) !== digits(p.phone)) diffs.push(`phone now "${row.org_phone ?? ""}"`);
    if (streetOf(row.distadd) !== streetOf(p.address)) diffs.push(`address now "${row.distadd ?? ""}"`);
    const edited = typeof row.EditDate === "number" ? new Date(row.EditDate).toISOString().slice(0, 10) : "";
    if (edited && p.last_checked && edited > p.last_checked) {
      diffs.push(`edited at source on ${edited}; hours there: ${[row.fp_days_orig, row.fp_hours_orig, row.sk_days_orig, row.sk_hours_orig].filter(Boolean).join(" ")}`);
    }
    if (diffs.length) findings.push({ ...base, kind: "changed", detail: diffs.join("; ") });
    else confirmed.add(p.id);
  }
}

// ---------- 2. web pages ----------

const SKIP = /justice\.gov|arcgis\.com|\.pdf(\b|$)|data\.cityofnewyork\.us/i;
const pages = places
  .filter((p) => !isPerson(p) && /^https?:\/\//.test(p.source_url) && !SKIP.test(p.source_url))
  .sort((a, b) => String(a.last_checked).localeCompare(String(b.last_checked)))
  .slice(0, LIMIT);
const bySource = new Map<string, Place[]>();
for (const p of pages) bySource.set(p.source_url, [...(bySource.get(p.source_url) ?? []), p]);
const queue = [...bySource.entries()];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let item; (item = queue.shift());) {
    const [url, list] = item;
    let text = "";
    let status = 0;
    try {
      const r = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; inmigracion-nyc recheck; +https://inmigracion-nyc.com)" },
      });
      status = r.status;
      text = words((await r.text()).replace(/<[^>]+>/g, " ")).slice(0, 2_000_000);
    } catch (err) {
      status = -1;
      text = err instanceof Error ? err.name : "";
    }
    for (const p of list) {
      const base = { id: p.id, name: p.name, source_url: url };
      if (status < 200 || status >= 400) {
        findings.push({ ...base, kind: "broken_source", detail: status === -1 ? `fetch failed (${text})` : `HTTP ${status}` });
        continue;
      }
      // The name's distinctive words (or the phone) must still be on the page.
      const key = words(p.name).split(" ").filter((w) => w.length > 3).slice(0, 3);
      const onPage = (key.length && key.every((w) => text.includes(w))) || (digits(p.phone).length === 10 && text.replace(/\D/g, "").includes(digits(p.phone)));
      if (onPage) confirmed.add(p.id);
      else findings.push({ ...base, kind: "not_on_page", detail: "The source page loads but no longer mentions this place." });
    }
  }
}));

// ---------- report ----------

const doj = places.filter((p) => /justice\.gov/.test(p.source_url) && !isPerson(p)).length;
const count = (k: Finding["kind"]) => findings.filter((f) => f.kind === k).length;
const report = {
  checked_on: today,
  pantries_checked: pantries.length,
  pages_checked: pages.length,
  confirmed: confirmed.size,
  closed: count("closed"),
  missing: count("missing"),
  changed: count("changed"),
  broken_source: count("broken_source"),
  not_on_page: count("not_on_page"),
  doj_roster_places: doj,
  doj_note: "DOJ roster entries come from EOIR's PDF roster: re-import the newest roster to refresh them.",
  findings,
};
await Deno.writeTextFile(new URL("data/recheck-report.json", ROOT), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, findings: undefined }, null, 2));

if (WRITE && confirmed.size) {
  for (const p of places) if (confirmed.has(p.id)) p.last_checked = today;
  await Deno.writeTextFile(new URL("data/Place.json", ROOT), JSON.stringify(places, null, 2) + "\n");
  console.log(`last_checked -> ${today} on ${confirmed.size} places. Now: deno run -A scripts/base44-seed.ts`);
}
