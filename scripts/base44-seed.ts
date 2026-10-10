// Load our catalog JSON (data/Program.json, Place.json, Link.json) into the live Base44 app.
//
//   deno run -A scripts/base44-seed.ts                 # upsert from ./data
//   deno run -A scripts/base44-seed.ts path/to/dir     # upsert from another folder with the same three files
//   deno run -A scripts/base44-seed.ts --replace       # ...and delete Base44 records that are not in the files
//   flags: --data-env prod|dev (default prod, the data the deployed functions read), --dry-run
//
// Upsert keys: Program and Place by key (our CSV id, e.g. place-corona-pantry), Link by from_id+to_id+type.
// --replace never touches Submission or RequestLog, never deletes Places with trust=community
// (approved community submissions), and keeps Links that point at those Places.
//
// How: it writes a script with the data embedded and pipes it to `base44 exec --privileged`
// (exec runs locally in Deno with your Base44 CLI login). exec asks Base44 for the app's
// published site URL; until the site is published that lookup 404s, so this script then runs exec
// through a tiny local proxy that answers only that one lookup with the app's own URL
// (everything else, including your login, passes straight through to app.base44.com).
// Afterwards it reads counts back through the public health function to prove the deployed
// functions see the same data.

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const APP_ID = "6aca64c59c3d35bc8bab2330";
const APP_URL = "https://nyc-navigator.base44.app";
const HEALTH_URL = `${APP_URL}/api/apps/${APP_ID}/functions/health`;
const SDK_VERSION = "0.8.53";

const argv = [...Deno.args];
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i >= 0) argv.splice(i, 1);
  return i >= 0;
};
const option = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const REPLACE = flag("--replace");
const DRY = flag("--dry-run");
const DATA_ENV = option("--data-env", "prod");
if (!["prod", "dev"].includes(DATA_ENV)) {
  console.error("--data-env must be prod or dev");
  Deno.exit(1);
}
const dir = argv[0] ? (argv[0].startsWith("/") ? argv[0] : `${Deno.cwd()}/${argv[0]}`) : `${ROOT}/data`;

type Row = Record<string, unknown>;
const AUTO = ["id", "created_date", "updated_date", "created_by", "created_by_id", "is_sample", "_b44id"];

async function readRows(name: string): Promise<Row[]> {
  const text = await Deno.readTextFile(`${dir}/${name}.json`);
  const rows = text.trim() ? JSON.parse(text) : [];
  if (!Array.isArray(rows)) throw new Error(`${name}.json is not an array`);
  return rows as Row[];
}

function clean(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (AUTO.includes(k) || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function keyed(rows: Row[], prefix: "prog" | "place", entity: string): Row[] {
  const re = new RegExp(`^${prefix}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
  const seen = new Set<string>();
  return rows.map((r) => {
    const key = String(r.key ?? r.id ?? "");
    if (!re.test(key)) throw new Error(`${entity}: bad id "${key}" (expected ${prefix}-<slug>)`);
    if (seen.has(key)) throw new Error(`${entity}: duplicate id ${key}`);
    seen.add(key);
    const out = clean(r);
    delete out.key;
    // Base44 rejects "" for constrained fields (zip pattern, uri format); leave them unset instead.
    for (const [k, v] of Object.entries(out)) if (v === "" && ["zip", "source_url", "last_checked"].includes(k)) delete out[k];
    return { key, ...out };
  });
}

const programs = keyed(await readRows("Program"), "prog", "Program");
const places = keyed(await readRows("Place"), "place", "Place");
const links = (await readRows("Link")).map(clean);
for (const l of links) {
  if (!l.from_id || !l.to_id || !l.type) throw new Error(`Link missing from_id/to_id/type: ${JSON.stringify(l)}`);
}

console.log(`files in ${dir.replace(ROOT + "/", "")}: Program ${programs.length}, Place ${places.length}, Link ${links.length}`);
console.log(`target: app ${APP_ID}, data env ${DATA_ENV}${REPLACE ? ", --replace" : ""}${DRY ? ", --dry-run" : ""}`);

// ---------- the script base44 exec runs ----------

const execScript = `
const DATA = ${JSON.stringify({ programs, places, links })};
const REPLACE = ${REPLACE};
const DRY = ${DRY};
// deno-lint-ignore no-explicit-any
const E: any = (globalThis as any).base44.entities;
const out: Record<string, unknown> = {};
const CHUNK = 200;

async function all(name: string) {
  const rows: any[] = [];
  for (let skip = 0;; skip += 500) {
    const page = await E[name].list("created_date", 500, skip || undefined);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
async function upsert(name: string, rows: any[], key: string | string[]) {
  let created = 0, updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (DRY) continue;
    const r = await E[name].upsert(rows.slice(i, i + CHUNK), { key });
    created += r.created ?? 0;
    updated += r.updated ?? 0;
  }
  return { created, updated };
}
const linkId = (l: any) => [l.from_id, l.to_id, l.type].join("|");

out.Program = await upsert("Program", DATA.programs, "key");
out.Place = await upsert("Place", DATA.places, "key");
out.Link = await upsert("Link", DATA.links, ["from_id", "to_id", "type"]);

if (REPLACE) {
  const keepProg = new Set(DATA.programs.map((r: any) => r.key));
  const keepPlace = new Set(DATA.places.map((r: any) => r.key));
  const keepLink = new Set(DATA.links.map(linkId));
  const placesNow = await all("Place");
  const community = new Set(placesNow.filter((p: any) => p.trust === "community").map((p: any) => p.key));
  const del: Record<string, number> = { Program: 0, Place: 0, Link: 0 };
  for (const p of await all("Program")) if (!keepProg.has(p.key)) { if (!DRY) await E.Program.delete(p.id); del.Program++; }
  for (const p of placesNow) {
    if (keepPlace.has(p.key) || p.trust === "community") continue;
    if (!DRY) await E.Place.delete(p.id);
    del.Place++;
  }
  for (const l of await all("Link")) {
    if (keepLink.has(linkId(l)) || community.has(l.from_id) || community.has(l.to_id)) continue;
    if (!DRY) await E.Link.delete(l.id);
    del.Link++;
  }
  out.deleted = del;
}

out.totals = {
  Program: await E.Program.count(),
  Place: await E.Place.count(),
  Link: await E.Link.count(),
  Submission: await E.Submission.count(),
  RequestLog: await E.RequestLog.count(),
};
console.log("SEED_RESULT " + JSON.stringify(out));
`;

// ---------- run base44 exec ----------

async function runExec(extraEnv: Record<string, string>): Promise<{ code: number; text: string }> {
  const child = new Deno.Command("base44", {
    args: ["exec", "--privileged", "--data-env", DATA_ENV],
    cwd: ROOT,
    env: { BASE44_EXEC_SDK_VERSION: SDK_VERSION, ...extraEnv },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(execScript));
  await w.close();
  const res = await child.output();
  const text = new TextDecoder().decode(res.stdout) + new TextDecoder().decode(res.stderr);
  return { code: res.code, text };
}

/** Local pass-through proxy to app.base44.com that answers the published-url lookup itself. */
function startProxy(): { url: string; close: () => Promise<void> } {
  const upstream = Deno.env.get("BASE44_API_URL") || "https://app.base44.com";
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    const u = new URL(req.url);
    if (req.method === "GET" && u.pathname === `/api/apps/platform/${APP_ID}/published-url`) {
      return Response.json({ url: APP_URL });
    }
    const headers = new Headers(req.headers);
    headers.delete("host");
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const r = await fetch(upstream + u.pathname + u.search, { method: req.method, headers, body, redirect: "manual" });
    const h = new Headers(r.headers);
    h.delete("content-encoding");
    h.delete("content-length");
    return new Response(r.body, { status: r.status, headers: h });
  });
  return { url: `http://127.0.0.1:${server.addr.port}`, close: async () => { ac.abort(); await server.finished; } };
}

let result = await runExec({});
if (result.code !== 0 && /fetching site URL/i.test(result.text)) {
  console.log("exec: app has no published site yet; retrying through the local published-url shim");
  const proxy = startProxy();
  try {
    result = await runExec({ BASE44_API_URL: proxy.url });
  } finally {
    await proxy.close();
  }
}

const line = result.text.split("\n").find((l) => l.startsWith("SEED_RESULT "));
if (result.code !== 0 || !line) {
  console.error(result.text.trim().split("\n").slice(-30).join("\n"));
  console.error("\nbase44-seed: exec failed");
  Deno.exit(1);
}
const seeded = JSON.parse(line.slice("SEED_RESULT ".length));
for (const name of ["Program", "Place", "Link"]) {
  const r = seeded[name];
  console.log(`${name.padEnd(8)} created ${r.created}, updated ${r.updated}`);
}
if (seeded.deleted) console.log(`deleted (not in files): ${JSON.stringify(seeded.deleted)}`);
console.log(`Base44 totals (${DATA_ENV}): ${JSON.stringify(seeded.totals)}`);

// ---------- read back through the deployed health function ----------

if (DATA_ENV === "prod" && !DRY) {
  try {
    const health = await (await fetch(HEALTH_URL)).json();
    const counts = health?.counts ?? {};
    const same = ["Program", "Place", "Link"].every((n) => counts[n] === seeded.totals[n]);
    console.log(`health function sees: ${JSON.stringify(counts)} -> ${same ? "MATCH" : "MISMATCH"}`);
    if (!same) Deno.exit(2);
  } catch (err) {
    console.warn(`could not read ${HEALTH_URL}: ${err instanceof Error ? err.message : err}`);
  }
}
