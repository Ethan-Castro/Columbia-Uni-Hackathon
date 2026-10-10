// Tests for the MCP Apps surface of handlers/mcp (ChatGPT plugin + Claude connector):
// initialize capabilities, resources/list|read, tools/list titles/annotations/_meta,
// and tools/call structuredContent for the three UI tools. Run: deno task test
// With --allow-write the data dir is copied to a temp dir (DATA_DIR) first, so
// RequestLog rows never land in the real data/. No network: LLM calls fall back to templates.
import handler from "../handlers/mcp/entry.ts";
import { CARD_HTML, CARD_MIME, CARD_URI } from "../shared/ui/card.ts";
import { summarize } from "../shared/ui/result.ts";

function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(`assertion failed ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const src = new URL("./fixtures/sample-data/", import.meta.url).pathname;
if ((await Deno.permissions.query({ name: "write" })).state === "granted") {
  const dir = await Deno.makeTempDir({ prefix: "mcp_apps_test_" });
  for await (const f of Deno.readDir(src)) {
    if (f.isFile && f.name.endsWith(".json")) await Deno.copyFile(src + f.name, `${dir}/${f.name}`);
  }
  Deno.env.set("DATA_DIR", dir);
} else {
  // Read-only run: point at the fixture itself (log writes fail quietly).
  Deno.env.set("DATA_DIR", src);
}

// deno-lint-ignore no-explicit-any
type Any = any;
async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await handler(
    new Request("http://localhost/functions/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return { status: res.status, body: await res.json() as Any };
}
const call = async (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  (await rpc("tools/call", { name, arguments: args, ...extra })).body.result;

Deno.test("initialize: resources capability, supported protocol, instructions", async () => {
  const { body } = await rpc("initialize", { protocolVersion: "2025-06-18" });
  eq(body.result.protocolVersion, "2025-06-18", "echo a supported version");
  ok(body.result.capabilities.tools && body.result.capabilities.resources, "tools and resources");
  ok(body.result.instructions.includes("never legal advice"), "instructions kept");
  const unknown = await rpc("initialize", { protocolVersion: "2099-01-01" });
  eq(unknown.body.result.protocolVersion, "2025-11-25", "latest supported for unknown");
});

Deno.test("modern-era probe gets 400 -32600, initialize never rejected", async () => {
  const probe = await rpc("tools/list", {}, { "mcp-protocol-version": "2026-07-28" });
  eq([probe.status, probe.body.error.code], [400, -32600]);
  const init = await rpc("initialize", {}, { "mcp-protocol-version": "2026-07-28", "mcp-method": "initialize" });
  eq(init.status, 200);
  const legacy = await rpc("tools/list", {}, { "mcp-protocol-version": "2025-11-25" });
  eq(legacy.status, 200);
});

Deno.test("resources/list, templates and read", async () => {
  const list = (await rpc("resources/list")).body.result.resources;
  eq(list.map((r: Any) => [r.uri, r.mimeType]), [[CARD_URI, CARD_MIME]]);
  eq((await rpc("resources/templates/list")).body.result, { resourceTemplates: [] });
  const c = (await rpc("resources/read", { uri: CARD_URI })).body.result.contents[0];
  eq([c.uri, c.mimeType], [CARD_URI, "text/html;profile=mcp-app"]);
  ok(c.text.startsWith("<!doctype html>") && c.text === CARD_HTML, "inline html");
  eq(c._meta.ui.prefersBorder, true);
  eq(c._meta["openai/widgetPrefersBorder"], true);
  ok(typeof c._meta["openai/widgetDescription"] === "string");
  ok(!("domain" in c._meta.ui), "no ui.domain");
  ok(!/<script[^>]+src=|<link[^>]+href=|https?:\/\/[^"' ]+\.(js|css)/i.test(c.text), "no external assets");
  eq((await rpc("resources/read", { uri: "ui://nope" })).body.error.code, -32002);
});

Deno.test("tools/list: titles, annotations, UI _meta", async () => {
  const tools = (await rpc("tools/list")).body.result.tools as Any[];
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const t of tools) {
    ok(t.title && t.annotations.title === t.title, `${t.name} title`);
    for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      ok(typeof t.annotations[k] === "boolean", `${t.name} ${k}`);
    }
  }
  for (const n of ["find_resources", "make_plan", "check_provider", "ping"]) {
    eq([by[n].annotations.readOnlyHint, by[n].annotations.openWorldHint], [true, false], n);
  }
  eq([
    by.send_to_phone.annotations.readOnlyHint,
    by.send_to_phone.annotations.destructiveHint,
    by.send_to_phone.annotations.openWorldHint,
  ], [false, true, true]);
  for (const n of ["find_resources", "make_plan", "check_provider"]) {
    const m = by[n]._meta;
    eq([m.ui.resourceUri, m["openai/outputTemplate"]], [CARD_URI, CARD_URI], n);
    ok(
      m["openai/toolInvocation/invoking"].length <= 64 && m["openai/toolInvocation/invoked"].length <= 64,
      `${n} labels`,
    );
    eq(by[n].outputSchema.required, ["kind"]);
  }
  ok(!by.send_to_phone._meta?.ui && !by.ping._meta?.ui, "no widget on send_to_phone / ping");
});

Deno.test("tools/call: structuredContent + short Spanish summary", async () => {
  const fr = await call("find_resources", { need: "food", near: "11368" });
  eq(fr.structuredContent.kind, "resources");
  ok(fr.structuredContent.results.length > 0 && fr.structuredContent.results[0].source_url !== undefined);
  ok(fr.content[0].text.startsWith("Encontré"), "spanish first");
  ok(/revisado el \d{4}-\d{2}-\d{2}/.test(fr.content[0].text), "checked date in summary");
  ok(fr.content[0].text.includes("no es consejo legal"), "disclaimer in summary");
  eq(JSON.parse(fr.content[1].text).need, "food", "compact JSON fallback");

  const plan = await call("make_plan", { needs: ["food", "id"], near: "Corona" });
  eq(plan.structuredContent.kind, "plan");
  ok(Array.isArray(plan.structuredContent.steps) && plan.content[0].text.startsWith("Plan de"));

  const cp = await call("check_provider", { name: "Jose Perez Notario", near: "11368" });
  eq(cp.structuredContent.kind, "provider_check");
  ok(cp.structuredContent.found === false && cp.content[0].text.length > 0);

  const en = await call("find_resources", { need: "food", near: "11368", language: "en" });
  ok(en.content[0].text.startsWith("Found"), "english when asked");
});

Deno.test("tools/call: ChatGPT gets no JSON copy; non-UI tools have no structuredContent; errors stay plain", async () => {
  const fr = await call("find_resources", { need: "food", near: "11368" }, { _meta: { "openai/session": "x" } });
  eq(fr.content.length, 1);
  ok(fr.structuredContent, "still structured");
  const ping = await call("ping", {});
  eq([ping.content[0].text, "structuredContent" in ping], ["pong", false]);
  const bad = await call("find_resources", { need: "nope", near: "11368" });
  eq([bad.isError, "structuredContent" in bad], [true, false]);
});

Deno.test("summarize reads check_provider defensively (new field names)", () => {
  const text = summarize("check_provider", {
    found: false,
    what_this_means: "No aparece.",
    list_name: "EOIR roster",
    list_checked: "2026-10-01",
    doj_listed_options: [{
      name: "Clinic",
      address: "1 St",
      fee: "unknown",
      source_url: "https://x.org",
      last_checked: "2026-10-01",
    }],
    language: "es",
  });
  ok(text.includes("EOIR roster") && text.includes("Clinic") && text.includes("https://x.org"), text);
  ok(text.includes("no es consejo legal"), "falls back to the standard disclaimer");
});
