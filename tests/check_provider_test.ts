// Tests for check_provider. Run:
//   deno test --allow-read --allow-env --allow-write tests/check_provider_test.ts
// With --allow-write, the data dir is copied to a temp dir (DATA_DIR) so the
// real data/ is never touched, and the RequestLog row is checked. Without it,
// log checks are skipped (writes fail silently inside logRequest).
import { getDb } from "../shared/db.ts";
import { resolveNear } from "../shared/geo.ts";
import type { Place } from "../shared/schema.ts";
import { checkProvider, matchProvider, pickProviders } from "../shared/tools/check_provider.ts";
import handler from "../functions/check_provider/entry.ts";

function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(`assertion failed ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const CAN_WRITE = (await Deno.permissions.query({ name: "write" })).state === "granted";
const SRC_DATA = new URL("../data/", import.meta.url).pathname;
if (CAN_WRITE) {
  const dir = await Deno.makeTempDir({ prefix: "check_provider_test_" });
  for await (const f of Deno.readDir(SRC_DATA)) {
    if (f.isFile && f.name.endsWith(".json")) await Deno.copyFile(SRC_DATA + f.name, `${dir}/${f.name}`);
  }
  Deno.env.set("DATA_DIR", dir);
}

const req = new Request("http://localhost/functions/check_provider", { method: "POST" });
const run = (input: Record<string, unknown>) =>
  checkProvider.run(req, input, { channel: "mcp" }) as Promise<Record<string, any>>;

async function logCount(): Promise<number> {
  return await getDb(req).RequestLog.count();
}
async function waitForLogs(n: number) {
  for (let i = 0; i < 100 && (await logCount()) < n; i++) await new Promise((r) => setTimeout(r, 20));
}

const opts = { sanitizeOps: false, sanitizeResources: false };
const dojPlaces = async () =>
  (await getDb(req).Place.filter({ org_type: { $in: ["doj_roster", "doj_pro_bono"] } })) as Place[];

Deno.test("fuzzy match: exact, typo, partial, unrelated", opts, async () => {
  const places = await dojPlaces();
  eq(places.length, 2, "sample data has 2 DOJ places");
  const exact = matchProvider("Queens Immigrant Legal Clinic", places);
  eq(exact.match?.place.id, "place-queens-immigrant-legal-clinic", "exact");
  eq(exact.match?.score, 1);
  eq(matchProvider("Queens Imigrant Legl Clinic", places).match?.place.id, "place-queens-immigrant-legal-clinic", "typo");
  eq(matchProvider("queens immigrant clinic", places).match?.place.id, "place-queens-immigrant-legal-clinic", "partial");
  eq(matchProvider("Roosevelt Pro Bono", places).match?.place.id, "place-roosevelt-pro-bono-project", "partial");
  eq(matchProvider("Rosevelt Ave Pro Bono", places).match?.place.id, "place-roosevelt-pro-bono-project", "typo 2");
  const unrelated = matchProvider("Jose Perez Notario", places);
  eq(unrelated.match, null, "unrelated");
  eq(unrelated.possible.length, 0);
  eq(matchProvider("Agencia de Viajes El Sol", places).match, null, "travel agency");
  // Red flag word not in the listed name -> never "found".
  eq(matchProvider("Roosevelt Notary Services", places).match, null, "notary red flag");
  // Generic-only words -> only a possible match.
  const generic = matchProvider("Legal Clinic", places);
  eq(generic.match, null, "generic");
  eq(generic.possible[0]?.place.id, "place-queens-immigrant-legal-clinic");
});

Deno.test("free providers: nearest first, verified preferred", opts, async () => {
  const places = await dojPlaces();
  eq(pickProviders(places, resolveNear("11373")).map((p) => p.id)[0], "place-roosevelt-pro-bono-project");
  eq(pickProviders(places, resolveNear("11372")).map((p) => p.id)[0], "place-queens-immigrant-legal-clinic");
  // A verified place beats a closer unverified one.
  const verified = places.map((p) => p.id === "place-queens-immigrant-legal-clinic" ? { ...p, trust: "verified" as const } : p);
  eq(pickProviders(verified, resolveNear("11373"))[0].id, "place-queens-immigrant-legal-clinic");
});

Deno.test("check_provider: notario not found (Spanish) + log row", opts, async () => {
  const before = CAN_WRITE ? await logCount() : 0;
  const r = await run({ name: "Jose Perez Notario", near: "11368" });
  eq(r.found, false);
  eq(r.match, null);
  ok(r.warning.includes("notarios") && r.warning.includes("arreglar los papeles"), "warning es");
  ok(r.what_this_means.includes("Jose Perez Notario"));
  eq(r.free_legal_providers.length, 2, "only 2 DOJ places in sample data");
  for (const p of r.free_legal_providers) ok(p.source_url && p.last_checked && p.trust_label, "source + date");
  ok(r.trust_note, "sample places are unverified -> trust_note");
  eq(r.how_to_verify.map((l: { url: string }) => l.url), [
    "https://www.justice.gov/eoir/recognition-and-accreditation-roster-reports",
    "https://iapps.courts.state.ny.us/attorneyservices/search",
  ]);
  ok(r.disclaimer.includes("no es consejo legal"));
  eq(r.near, "Corona, Queens (11368)");

  if (CAN_WRITE) {
    await waitForLogs(before + 1);
    const rows = await getDb(req).RequestLog.list("-created_date", 1);
    const row = rows[0] as unknown as Record<string, unknown>;
    eq([row.needs, row.zip, row.language, row.channel, row.results_found, row.unmet], [["legal"], "11368", "es", "mcp", 2, true]); // unmet: no provider in 11368 itself (spec: that zip + language)
    const file = await Deno.readTextFile(`${Deno.env.get("DATA_DIR")}/RequestLog.json`);
    ok(!/perez|notario/i.test(file), "searched name never logged");
  }
});

Deno.test("check_provider: found (English)", opts, async () => {
  const r = await run({ name: "Roosevelt Avenue Pro Bono", near: "Elmhurst", language: "en" });
  eq(r.found, true);
  eq(r.match.org_type, "doj_pro_bono");
  ok(r.match.source_url && r.match.last_checked);
  eq(r.warning, null);
  ok(r.what_this_means.includes("pro bono") && r.what_this_means.includes("confirm in person"));
  ok(r.disclaimer.startsWith("This is information"));
  eq(r.free_legal_providers[0].id, "place-roosevelt-pro-bono-project");
});

Deno.test("check_provider HTTP entry", opts, async () => {
  eq((await handler(new Request("http://x/", { method: "OPTIONS" }))).status, 204);
  eq((await handler(new Request("http://x/", { method: "GET" }))).status, 405);
  const bad = await handler(new Request("http://x/", { method: "POST", body: "{}" }));
  eq(bad.status, 400);
  const res = await handler(
    new Request("http://x/", { method: "POST", body: JSON.stringify({ name: "Un señor en la agencia de viajes" }) }),
  );
  eq(res.status, 200);
  const body = await res.json();
  eq([body.found, body.free_legal_providers.length > 0, body.near], [false, true, null]);
});
