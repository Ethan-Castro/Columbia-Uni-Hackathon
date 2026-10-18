// Pull the live catalog (Program, Place, Link) from Base44 into data/*.json, the reverse of
// base44-seed.ts. Run it before building articles, pages or the knowledge graph so they include
// every place a person approved on the live site.
//
//   deno run -A scripts/base44-pull.ts              # writes data/Program.json, Place.json, Link.json
//   deno run -A scripts/base44-pull.ts --dry-run    # counts only
//
// Same mechanism as the seed: a script piped to `base44 exec --privileged` (your CLI login).
// Our ids live in Base44's `key` field; they come back as `id`. Submission and RequestLog are
// never pulled (not public, and RequestLog stays on the server).

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const SDK_VERSION = "0.8.53";
const DRY = Deno.args.includes("--dry-run");
const AUTO = ["created_by", "created_by_id", "is_sample", "key"];

const execScript = `
// deno-lint-ignore no-explicit-any
const E: any = (globalThis as any).base44.entities;
async function all(name: string) {
  const rows: any[] = [];
  for (let skip = 0;; skip += 500) {
    const page = await E[name].list("created_date", 500, skip || undefined);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
const out = { Program: await all("Program"), Place: await all("Place"), Link: await all("Link") };
console.log("PULL_RESULT " + JSON.stringify(out));
`;

const child = new Deno.Command("base44", {
  args: ["exec", "--privileged", "--data-env", "prod"],
  cwd: ROOT,
  env: { BASE44_EXEC_SDK_VERSION: SDK_VERSION },
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();
const w = child.stdin.getWriter();
await w.write(new TextEncoder().encode(execScript));
await w.close();
const res = await child.output();
const text = new TextDecoder().decode(res.stdout) + new TextDecoder().decode(res.stderr);
const line = text.split("\n").find((l) => l.startsWith("PULL_RESULT "));
if (res.code !== 0 || !line) {
  console.error(text.trim().split("\n").slice(-30).join("\n"));
  console.error("\nbase44-pull: exec failed");
  Deno.exit(1);
}

type Row = Record<string, unknown>;
const pulled = JSON.parse(line.slice("PULL_RESULT ".length)) as Record<string, Row[]>;

function tidy(row: Row, keyed: boolean): Row {
  const out: Row = {};
  if (keyed) out.id = row.key ?? row.id;
  for (const [k, v] of Object.entries(row)) {
    if (AUTO.includes(k) || v === null || v === undefined || (keyed && k === "id")) continue;
    if (!keyed && k === "id") continue; // Link: Base44's record id means nothing locally
    out[k] = v;
  }
  return out;
}

const sortBy = (k: string) => (a: Row, b: Row) => String(a[k]).localeCompare(String(b[k]));
// Links have no key on Base44: keep the local row (and its link-NN id) when from/to/type match.
const linkKey = (l: Row) => [l.from_id, l.to_id, l.type].join("|");
const localLinks = new Map(
  (JSON.parse(await Deno.readTextFile(`${ROOT}/data/Link.json`).catch(() => "[]")) as Row[]).map((l) => [linkKey(l), l]),
);
const files: Record<string, Row[]> = {
  Program: pulled.Program.map((r) => tidy(r, true)).sort(sortBy("id")),
  // A key stored twice on Base44 (an old double import) comes back once.
  Place: pulled.Place.map((r) => tidy(r, true)).filter((r) => typeof r.id === "string" && r.id.startsWith("place-"))
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .sort(sortBy("id")),
  Link: pulled.Link.map((r) => localLinks.get(linkKey(r)) ?? tidy(r, false)),
};

for (const [name, live] of Object.entries(files)) {
  const before = JSON.parse(await Deno.readTextFile(`${ROOT}/data/${name}.json`).catch(() => "[]")) as Row[];
  // Keep the local file's order (small diffs); rows new on the live site go at the end.
  const pos = new Map(before.map((r, i) => [name === "Link" ? linkKey(r) : r.id, i]));
  const at = (r: Row) => pos.get(name === "Link" ? linkKey(r) : r.id) ?? Infinity;
  const rows = [...live].sort((a, b) => at(a) - at(b));
  console.log(`${name.padEnd(8)} live ${rows.length} (local had ${before.length})`);
  if (!DRY) await Deno.writeTextFile(`${ROOT}/data/${name}.json`, JSON.stringify(rows, null, 2) + "\n");
}
