// Tests for scripts/csv.ts and scripts/import.ts. Every write goes to a temp
// copy of data/; the last test checks the real data/ was not touched.
//
//   deno test --allow-read --allow-write --allow-env scripts/
//   (set TEST_TMPDIR=/some/dir to choose where the temp copies go)

import { parseCsv } from "./csv.ts";
import { formatReport, runImport } from "./import.ts";
import type { ImportReport } from "./import.ts";

const ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const REAL_DATA = `${ROOT}data`;
const GOOD = `${ROOT}scripts/fixtures/good`;
const BAD = `${ROOT}scripts/fixtures/bad`;
const NOW = new Date("2026-10-10T16:00:00Z");

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function hashDir(dir: string, only?: string[]): Promise<string> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".json") && (!only || only.includes(e.name))) names.push(e.name);
  }
  const parts: string[] = [];
  for (const n of names.sort()) {
    const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(`${dir}/${n}`));
    parts.push(`${n}:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  }
  return parts.join("\n");
}

// The live dev server may append RequestLog rows meanwhile, so only the files
// this script writes are compared.
const IMPORT_FILES = ["Program.json", "Place.json", "Link.json", "import-report.json"];
const realBefore = await hashDir(REAL_DATA, IMPORT_FILES);

/** Fresh temp copy of the seeded data/ JSON files (not the import report). */
async function dataCopy(): Promise<string> {
  const dir = await Deno.makeTempDir({ dir: Deno.env.get("TEST_TMPDIR") || undefined, prefix: "import-test-" });
  for (const n of ["Program", "Place", "Link", "Submission", "RequestLog"]) {
    await Deno.copyFile(`${REAL_DATA}/${n}.json`, `${dir}/${n}.json`);
  }
  return dir;
}
async function readJson(dir: string, entity: string): Promise<Record<string, unknown>[]> {
  return JSON.parse(await Deno.readTextFile(`${dir}/${entity}.json`));
}
const run = (srcDir: string, outDir: string, extra: Partial<Parameters<typeof runImport>[0]> = {}) =>
  runImport({ srcDir, outDir, now: NOW, reportPath: `${outDir}/import-report.json`, ...extra });

/** "places.csv:9 bad_quotes" for every error in the report. */
function errorKeys(r: ImportReport): string[] {
  return r.issues.filter((i) => i.level === "error").map((i) => `${i.file}:${i.line} ${i.code}`);
}

// ---------- CSV parser ----------

Deno.test("csv: quotes, escaped quotes, embedded commas/newlines, CRLF, BOM, blank lines", () => {
  const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"line1\r\nline2",z\r\n3,,\n';
  const { records, problems } = parseCsv(text);
  eq(problems, []);
  eq(records.map((r) => r.fields), [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line1\nline2", "z"], ["3", "", ""]]);
  eq(records.map((r) => [r.line, r.endLine]), [[1, 1], [2, 2], [4, 5], [6, 6]]);
});

Deno.test("csv: no trailing newline and CR-only line endings", () => {
  eq(parseCsv("a,b\r1,2\r3,4").records.map((r) => r.fields), [["a", "b"], ["1", "2"], ["3", "4"]]);
});

Deno.test("csv: unclosed quote at the end costs one row", () => {
  const { records, problems } = parseCsv('a,b\n1,ok\nbad-1,"never closed\n3,fine\n');
  eq(records.map((r) => r.fields), [["a", "b"], ["1", "ok"], ["3", "fine"]]);
  eq(problems.map((p) => [p.line, p.firstField]), [[3, "bad-1"]]);
});

Deno.test("csv: a stray quote mid-file does not swallow the following rows", () => {
  const { records, problems } = parseCsv('a,b,c\n1,"broken,x\n2,y,z\n3,"fine",ok\n4,w,v\n');
  eq(problems.map((p) => p.line), [2]);
  eq(records.slice(1).map((r) => r.fields[0]), ["2", "3", "4"]);
});

Deno.test("csv: loose quote inside an unquoted field is kept and flagged", () => {
  const { records } = parseCsv('a,b\n1,5" pipe\n');
  eq(records[1].fields, ["1", '5" pipe']);
  ok(records[1].looseQuote);
});

// ---------- import: good fixtures ----------

Deno.test("import good fixtures: all rows in, samples out, shapes match db.ts", async () => {
  const out = await dataCopy();
  const r = await run(GOOD, out);
  eq(r.exit_code, 0);
  eq(errorKeys(r), []);
  eq(r.issues.filter((i) => i.level === "warning").length, 0, "no warnings");
  eq([r.files.programs.new, r.files.places.new, r.files.links.new], [3, 4, 4]);
  eq(r.totals, { Program: 3, Place: 4, Link: 4 }, "sample records removed");
  eq(r.removed.length, 29);

  const programs = await readJson(out, "Program");
  const id = programs.find((p) => p.id === "prog-fixture-city-id")!;
  eq(id.bring, ["passport or consular ID", "proof of address, like a lease or bill"], "pipes and quoted commas");
  eq(id.needs, ["id"]);
  ok(typeof id.created_date === "string" && typeof id.updated_date === "string", "auto fields");
  eq(programs.find((p) => p.id === "prog-fixture-legal-screening")!.how_to_apply, "Call to book.\nSay you need a screening.");

  const places = await readJson(out, "Place");
  const clinic = places.find((p) => p.id === "place-fixture-legal-clinic")!;
  eq([clinic.borough, clinic.lat, clinic.open_evenings, clinic.languages, clinic.org], ["Queens", 40.749, true, ["es", "en", "quc"], "Fixture Legal Aid, Inc."]);

  const links = await readJson(out, "Link");
  ok(links.every((l) => typeof l.id === "string" && l.created_date), "links get ids");
  ok(links.some((l) => l.type === "refers_to" && String(l.reason).includes("|")), "pipe inside a quoted reason is kept");

  const report = JSON.parse(await Deno.readTextFile(`${out}/import-report.json`));
  eq(report.files.places.new, 4, "report written");
  ok(formatReport(r).includes("places.csv"), "table renders");
});

Deno.test("import is idempotent: second run changes nothing", async () => {
  const out = await dataCopy();
  await run(GOOD, out);
  const before = await hashDir(out);
  const r = await run(GOOD, out, { now: new Date("2026-10-11T12:00:00Z") });
  eq([r.files.programs.unchanged, r.files.places.unchanged, r.files.links.unchanged], [3, 4, 4]);
  eq([r.files.programs.updated, r.files.places.new], [0, 0]);
  eq((await hashDir(out)).split("\n").filter((l) => !l.startsWith("import-report")), before.split("\n").filter((l) => !l.startsWith("import-report")));
});

Deno.test("--keep-sample keeps samples; non-sample records survive unless --replace", async () => {
  const out = await dataCopy();
  // a community-approved place that is not in Felix's CSV
  const places = await readJson(out, "Place");
  places.push({ ...places[0], id: "place-community-approved", name: "Community Pantry", trust: "community", source_url: "https://example.com/community", created_date: NOW.toISOString(), updated_date: NOW.toISOString() });
  await Deno.writeTextFile(`${out}/Place.json`, JSON.stringify(places));

  const kept = await run(GOOD, out, { keepSample: true, dryRun: true });
  eq(kept.totals, { Program: 11, Place: 15, Link: 15 }, "samples kept");

  const merged = await run(GOOD, out);
  eq(merged.totals.Place, 5, "4 new + community place preserved");
  ok((await readJson(out, "Place")).some((p) => p.id === "place-community-approved"));

  const replaced = await run(GOOD, out, { replace: true });
  eq(replaced.totals.Place, 4);
  ok(replaced.removed.some((x) => x.id === "place-community-approved" && x.reason.includes("--replace")));
});

Deno.test("updating a record keeps id and created_date, bumps updated_date", async () => {
  const out = await dataCopy();
  await run(GOOD, out);
  const src = await Deno.makeTempDir({ dir: Deno.env.get("TEST_TMPDIR") || undefined, prefix: "import-src-" });
  const csv = (await Deno.readTextFile(`${GOOD}/places.csv`)).replace("555-0201", "555-0999");
  await Deno.writeTextFile(`${src}/places.csv`, csv);
  const before = (await readJson(out, "Place")).find((p) => p.id === "place-fixture-corona-pantry")!;
  const r = await run(src, out, { now: new Date("2026-10-12T00:00:00Z") });
  eq([r.files.places.updated, r.files.places.unchanged], [1, 3]);
  const after = (await readJson(out, "Place")).find((p) => p.id === "place-fixture-corona-pantry")!;
  eq([after.phone, after.created_date, after.updated_date], ["555-0999", before.created_date, "2026-10-12T00:00:00.000Z"]);
  eq(r.files.programs.present, false);
  ok(r.notes.some((n) => n.includes("programs.csv not found")));
});

// ---------- import: bad fixtures ----------

Deno.test("import bad fixtures: every bad row reported with its reasons, good rows still in", async () => {
  const out = await dataCopy();
  const r = await run(BAD, out);
  eq(r.exit_code, 0, "bad rows never fail the run");
  eq(errorKeys(r).sort(), [
    "links.csv:3 dangling_link", // to_id does not exist
    "links.csv:4 bad_enum", // "unlock"
    "links.csv:5 self_link",
    "places.csv:3 bad_enum", // "panty"
    "places.csv:4 bad_boolean", // "maybe"
    "places.csv:6 extra_values", // unquoted comma
    "places.csv:8 bad_date", // 2026-13-01
    "places.csv:8 bad_url", // ftp://
    "places.csv:8 out_of_nyc",
    "places.csv:9 bad_quotes", // unclosed quote
    "programs.csv:3 bad_id",
    "programs.csv:4 bad_enum", // comida
    "programs.csv:5 bad_date", // 2026-02-30
    "programs.csv:6 missing", // source_url
  ].sort());
  const warn = (code: string) => r.issues.filter((i) => i.level === "warning" && i.code === code).map((i) => `${i.file}:${i.line}`);
  eq(warn("duplicate_id"), ["links.csv:6", "programs.csv:7"]);
  eq(warn("duplicate_place"), ["places.csv:5"]);
  eq(warn("extra_column"), ["programs.csv:1"]);
  eq(warn("loose_boolean"), ["places.csv:7", "places.csv:7"]);
  eq(warn("swapped_coords"), ["places.csv:7"]);
  ok(r.issues.some((i) => i.code === "bad_enum" && i.message.includes('did you mean "food"')), "synonym hint");
  ok(r.issues.some((i) => i.code === "bad_enum" && i.message.includes('did you mean "pantry"')), "typo hint");
  eq(r.issues.find((i) => i.code === "bad_quotes")!.id, "place-bad-quote");

  eq([r.files.programs.new, r.files.places.new, r.files.links.new], [1, 3, 1]);
  const prog = (await readJson(out, "Program")).find((p) => p.id === "prog-bad-ok")!;
  eq([prog.name, prog.needs, prog.last_checked], ["Valid Program (second)", ["food", "benefits"], "2026-10-09"], "later duplicate wins");
  const loose = (await readJson(out, "Place")).find((p) => p.id === "place-bad-loose")!;
  eq([loose.borough, loose.lat, loose.lng, loose.open_evenings], ["Queens", 40.749, -73.88, false]);
  ok((await readJson(out, "Place")).some((p) => p.id === "place-bad-after"), "row after the unclosed quote is imported");
  eq((await readJson(out, "Place")).find((p) => p.id === "place-bad-ok")!.languages, ["es", "en"], "Spanish -> es, de-duplicated");
  eq((await readJson(out, "Link"))[0].reason, "Same link again (wins).");
});

Deno.test("--dry-run writes nothing but the report", async () => {
  const out = await dataCopy();
  const before = await hashDir(out);
  const r = await run(BAD, out, { dryRun: true });
  eq(r.dry_run, true);
  ok(r.files.places.new > 0);
  eq((await hashDir(out)).split("\n").filter((l) => !l.startsWith("import-report")).join("\n"), before);
});

Deno.test("unusable header -> exit 1, that entity untouched, others still import", async () => {
  const out = await dataCopy();
  const src = await Deno.makeTempDir({ dir: Deno.env.get("TEST_TMPDIR") || undefined, prefix: "import-src-" });
  await Deno.writeTextFile(`${src}/places.csv`, "name,zip\nSomething,11368\n");
  await Deno.copyFile(`${GOOD}/programs.csv`, `${src}/programs.csv`);
  const placeBefore = await Deno.readTextFile(`${out}/Place.json`);
  const r = await run(src, out);
  eq(r.exit_code, 1);
  ok(r.files.places.fatal?.includes("missing id"), r.files.places.fatal);
  eq(await Deno.readTextFile(`${out}/Place.json`), placeBefore);
  eq(r.files.programs.new, 3);
  // sample links that pointed at removed sample programs are pruned
  ok(r.removed.some((x) => x.entity === "Link" && x.reason.includes("no longer exists")));
  ok((await readJson(out, "Link")).every((l) => !String(l.from_id).startsWith("prog-idnyc")));
});

Deno.test("no CSVs at all -> exit 1 and nothing changes", async () => {
  const out = await dataCopy();
  const src = await Deno.makeTempDir({ dir: Deno.env.get("TEST_TMPDIR") || undefined, prefix: "import-src-" });
  const before = await hashDir(out);
  const r = await run(src, out, { reportPath: null });
  eq(r.exit_code, 1);
  eq(await hashDir(out), before);
});

Deno.test("the real data/ was never touched", async () => {
  eq(await hashDir(REAL_DATA, IMPORT_FILES), realBefore);
});
