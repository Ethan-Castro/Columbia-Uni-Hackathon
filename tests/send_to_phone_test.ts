// Tests for send_to_phone, redact and twilio. NEVER sends a real message:
// globalThis.fetch is replaced by a mock in every test that gets past consent,
// and Twilio secrets are fake values. Run:
//   deno test --allow-read --allow-env --allow-write tests/send_to_phone_test.ts
// With --allow-write the data dir is copied to a temp dir (DATA_DIR) and the
// RequestLog rows are checked; without it, log checks are skipped.
import { getDb } from "../shared/db.ts";
import { mentionsStatus, redactStatus } from "../shared/redact.ts";
import { MAX_MESSAGE_CHARS, maskPhone, normalizePhone, sendToPhone } from "../shared/tools/send_to_phone.ts";
import handler from "../functions/send_to_phone/entry.ts";

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
  const dir = await Deno.makeTempDir({ prefix: "send_to_phone_test_" });
  for await (const f of Deno.readDir(SRC_DATA)) {
    if (f.isFile && f.name.endsWith(".json")) await Deno.copyFile(SRC_DATA + f.name, `${dir}/${f.name}`);
  }
  Deno.env.set("DATA_DIR", dir);
}

// Fake Twilio config (the real .env is never loaded by tests).
const FAKE = { TWILIO_ACCOUNT_SID: "ACtest000", TWILIO_AUTH_TOKEN: "fake-token", TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886" };
for (const [k, v] of Object.entries(FAKE)) Deno.env.set(k, v);

const PHONE = "(718) 555-0161";
const PHONE_DIGITS = "7185550161";
const req = new Request("http://localhost/functions/send_to_phone", { method: "POST" });
const run = (input: Record<string, unknown>) =>
  sendToPhone.run(req, input, { channel: "mcp" }) as Promise<Record<string, any>>;

const PLAN = [
  "Paso 1: Corona Community Pantry, 104-10 Sample Ave. Mar y Jue 10am-2pm. Lleve una bolsa.",
  "Paso 2: WIC en Junction Family Health Center. Lleve identificación y comprobante de domicilio. No importa su estatus migratorio.",
  "Paso 3: IDNYC. Lleve pasaporte. Si tiene una cita en corte de inmigración, avísele a su abogado.",
  "Su número A-123-456-789 y su caso de asilo con el formulario I-589.",
  "Mi teléfono es 718-555-0161.",
  "",
  "Resumen para llevar a su cita legal",
  "Llegó hace dos meses con sus dos hijos.",
  "Quiere saber sobre TPS.",
].join("\n");

/** Replace fetch; records calls. Throws if `allow` is false and fetch is called. */
function mockFetch(respond: () => Response, allow = true) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init: RequestInit = {}) => {
    if (!allow) throw new Error("fetch must not be called");
    calls.push({ url: String(url), init });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** Capture console output so we can assert the phone never appears in logs. */
function captureConsole() {
  const lines: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(saved) as Array<keyof typeof saved>) {
    console[k] = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  }
  return { lines, restore: () => Object.assign(console, saved) };
}

async function waitForLogs(n: number) {
  for (let i = 0; i < 100 && (await getDb(req).RequestLog.count()) < n; i++) await new Promise((r) => setTimeout(r, 20));
}
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("normalizePhone and maskPhone", () => {
  eq(normalizePhone("(718) 555-0161"), "+17185550161");
  eq(normalizePhone("1-718-555-0161"), "+17185550161");
  eq(normalizePhone("+52 55 1234 5678"), "+525512345678");
  eq(normalizePhone("0052 55 1234 5678"), "+525512345678");
  eq(normalizePhone("whatsapp:+17185550161"), "+17185550161");
  eq(normalizePhone("123"), null);
  eq(normalizePhone("555-0161"), null, "7 digits");
  eq(normalizePhone("+0123456789"), null);
  eq(normalizePhone("call me"), null);
  eq(normalizePhone(undefined), null);
  eq(maskPhone("+17185550161"), "•••• ••61");
});

Deno.test("redactStatus removes status sentences and intake sections", () => {
  const { text, removed } = redactStatus(PLAN);
  ok(text.includes("Corona Community Pantry") && text.includes("Lleve una bolsa."), "keeps places");
  ok(text.includes("Lleve identificación y comprobante de domicilio."), "keeps what to bring");
  ok(text.includes("Lleve pasaporte."), "keeps passport (ID, not status)");
  for (const bad of ["estatus", "corte", "A-123", "asilo", "I-589", "Resumen para llevar", "dos hijos", "TPS"]) {
    ok(!text.includes(bad), `removed "${bad}"`);
  }
  eq(removed, 6, "count only");
  ok(mentionsStatus("Talk to ICE about your green card"));
  ok(mentionsStatus("Necesita una VISA"));
  ok(mentionsStatus("No importa si es indocumentado"));
  ok(mentionsStatus("Fill out form I-130"));
  ok(mentionsStatus("su situación migratoria"));
  ok(!mentionsStatus("Bring proof of residency and a photo ID"));
  ok(!mentionsStatus("Mon-Fri 9am-5pm, 104-10 Sample Ave, Corona NY 11368, 555-0101"));
  ok(!mentionsStatus("Lleve sus papeles de identidad y un comprobante de residencia"));
  ok(!mentionsStatus("Free ice cream on Saturdays") === false, "ice is always treated as ICE (conservative)");
});

Deno.test("redactStatus: adversarial status phrasings never reach the phone", () => {
  const leaks = [
    "I overstayed my tourist permit",
    "No tengo estatus.",
    "Entré sin inspección por la frontera.",
    "Soy ilegal aquí.",
    "I have no status.",
    "Mi caso de inmigración sigue abierto.",
    "Tengo corte el 3 de mayo.",
    "Bring your I94 and I 589",
    "La migra me paró ayer",
    "Soy mojado",
    "a​sylum hearing next week",
  ];
  for (const s of leaks) {
    const { text, removed } = redactStatus(`Despensa: martes 10am-2pm.\n${s}`);
    eq(text, "Despensa: martes 10am-2pm.", `leaked: ${s}`);
    ok(removed >= 1, `counted: ${s}`);
  }
  // A phrase split across lines drops both lines.
  const split = redactStatus("1. Despensa, martes 10am-2pm\nAviso: todavía no tengo\npapeles\nLleve una bolsa");
  eq(split.text, "1. Despensa, martes 10am-2pm\nLleve una bolsa");
  // An intake section does not end at a "Label:" line; it ends at a blank line + plan step.
  const intake = redactStatus(
    'Intake summary\nNeeds: legal\nArea: Corona\nIn their own words:\n"I entered without inspection in 2021"\n\n2. Pantry, Tue 10am-2pm',
  );
  eq(intake.text, "2. Pantry, Tue 10am-2pm");
  // Plain plan lines survive.
  for (const s of ["Horario: Mon-Fri 9am-5pm", "Dirección: 104-10 Sample Ave, Corona NY 11368", "Qué llevar: pasaporte; prueba de domicilio"]) {
    ok(!mentionsStatus(s), `kept: ${s}`);
  }
});

Deno.test("consent false or not strictly true: nothing sent, no fetch", opts, async () => {
  const f = mockFetch(() => new Response("{}"), false);
  try {
    for (const consent of [false, "true", 1, "yes", null, undefined]) {
      const r = await run({ phone: PHONE, plan_text: PLAN, consent });
      eq([r.sent, r.reason], [false, "consent_required"], `consent=${consent}`);
      ok(r.message.includes("permiso"));
      ok(!JSON.stringify(r).includes("0161"), "no phone in output");
    }
    eq(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("invalid phone: nothing sent, no fetch", opts, async () => {
  const f = mockFetch(() => new Response("{}"), false);
  try {
    const r = await run({ phone: "12345", plan_text: PLAN, consent: true, language: "en" });
    eq([r.sent, r.reason], [false, "phone_invalid"]);
    ok(r.message.startsWith("That phone number"));
    const empty = await run({ phone: PHONE, plan_text: "Su estatus migratorio.", consent: true });
    eq([empty.sent, empty.reason, empty.to], [false, "empty_plan", "•••• ••61"]);
  } finally {
    f.restore();
  }
});

Deno.test("mocked Twilio: request shape, redaction, no phone in output or logs", opts, async () => {
  const before = CAN_WRITE ? await getDb(req).RequestLog.count() : 0;
  const f = mockFetch(() => Response.json({ sid: "SMfake123", status: "queued" }, { status: 201 }));
  const c = captureConsole();
  let r: Record<string, any>;
  try {
    r = await run({ phone: PHONE, plan_text: PLAN, consent: true });
  } finally {
    f.restore();
    c.restore();
  }
  eq([r.sent, r.sid, r.status, r.to], [true, "SMfake123", "queued", "•••• ••61"]);
  eq(f.calls.length, 1);
  const { url, init } = f.calls[0];
  eq(url, "https://api.twilio.com/2010-04-01/Accounts/ACtest000/Messages.json");
  eq(init.method, "POST");
  const headers = new Headers(init.headers);
  eq(headers.get("authorization"), `Basic ${btoa("ACtest000:fake-token")}`);
  eq(headers.get("content-type"), "application/x-www-form-urlencoded");
  ok(init.signal instanceof AbortSignal, "has timeout signal");
  const form = new URLSearchParams(String(init.body));
  eq(form.get("From"), "whatsapp:+14155238886");
  eq(form.get("To"), "whatsapp:+17185550161");
  const body = form.get("Body")!;
  ok(body.startsWith("NYC Navigator: su plan"), "header");
  ok(body.endsWith("Info y referidos, no asesoría legal."), "footer");
  ok(body.includes("Corona Community Pantry") && body.includes("Lleve pasaporte."));
  for (const bad of ["estatus", "corte de inmigración", "A-123", "asilo", "I-589", "TPS", "dos hijos", "555-0161"]) {
    ok(!body.includes(bad), `body has no "${bad}"`);
  }
  ok(body.length <= MAX_MESSAGE_CHARS);
  eq(r.removed_status_items, 6);
  eq(r.text_sent, body);
  const out = JSON.stringify(r);
  ok(!out.includes(PHONE_DIGITS) && !out.includes("555-0161") && !out.includes("718"), "no phone in output");
  ok(!c.lines.join("\n").includes("0161"), "no phone in console");

  if (CAN_WRITE) {
    await waitForLogs(before + 1);
    // Earlier tests' rows may land late; wait for the sent row itself.
    for (let i = 0; i < 100; i++) {
      if ((await getDb(req).RequestLog.count({ channel: "mcp", results_found: 1 })) > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const file = await Deno.readTextFile(`${Deno.env.get("DATA_DIR")}/RequestLog.json`);
    ok(!file.includes("0161") && !file.includes("Pantry"), "no phone or text in RequestLog");
    const sentRows = await getDb(req).RequestLog.filter({ channel: "mcp", results_found: 1 });
    eq(sentRows.length, 1, "exactly one sent row");
    const row = sentRows[0] as unknown as Record<string, unknown>;
    eq([row.needs, row.zip, row.language, row.channel, row.results_found, row.unmet], [[], "", "es", "mcp", 1, false]);
    eq(Object.keys(row).sort(), ["channel", "created_at", "created_date", "id", "language", "needs", "results_found", "unmet", "updated_date", "zip"]);
  }
});

Deno.test("mocked Twilio error 63015: sandbox hint, phone not echoed", opts, async () => {
  const f = mockFetch(() =>
    Response.json(
      { code: 63015, message: "Channel could not find To address whatsapp:+17185550161", status: 400 },
      { status: 400 },
    )
  );
  const c = captureConsole();
  let r: Record<string, any>;
  try {
    r = await run({ phone: PHONE, plan_text: "Pantry: Tue 10am-2pm.", consent: true, language: "en" });
  } finally {
    f.restore();
    c.restore();
  }
  eq([r.sent, r.reason, r.error_code], [false, "send_failed", 63015]);
  ok(r.message.includes("join"), "sandbox hint");
  ok(r.detail.includes("63015") && r.detail.includes("Sandbox"));
  ok(!JSON.stringify(r).includes("0161") && !c.lines.join("\n").includes("0161"));
});

Deno.test("long plan is capped at 1500 chars; missing config -> not_configured", opts, async () => {
  const f = mockFetch(() => Response.json({ sid: "SMx", status: "queued" }, { status: 201 }));
  try {
    const long = Array.from({ length: 200 }, (_, i) => `Lugar ${i}: Mon-Fri 9am-5pm. Lleve ID.`).join("\n");
    const r = await run({ phone: "+525512345678", plan_text: long, consent: true });
    ok(r.sent && r.chars <= MAX_MESSAGE_CHARS, `chars ${r.chars}`);
    ok(r.text_sent.includes("…") && r.text_sent.endsWith("no asesoría legal."));
  } finally {
    f.restore();
  }
  const g = mockFetch(() => new Response("{}"), false);
  Deno.env.delete("TWILIO_AUTH_TOKEN");
  try {
    const r = await run({ phone: PHONE, plan_text: "Pantry", consent: true });
    eq([r.sent, r.reason], [false, "not_configured"]);
  } finally {
    Deno.env.set("TWILIO_AUTH_TOKEN", FAKE.TWILIO_AUTH_TOKEN);
    g.restore();
  }
});

Deno.test("send_to_phone HTTP entry (consent false)", opts, async () => {
  const f = mockFetch(() => new Response("{}"), false);
  try {
    const res = await handler(
      new Request("http://x/", { method: "POST", body: JSON.stringify({ phone: PHONE, plan_text: "x", consent: false }) }),
    );
    eq(res.status, 200);
    eq((await res.json()).reason, "consent_required");
    eq((await handler(new Request("http://x/", { method: "GET" }))).status, 405);
  } finally {
    f.restore();
  }
});
