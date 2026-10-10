// Team WhatsApp test: build a Rosa plan with make_plan and send it with
// send_to_phone, through the MCP server, to phones that joined our Twilio
// WhatsApp sandbox. For teammates' own phones only.
//
//   deno task test-send                      # every phone that joined the sandbox
//   deno task test-send --to +13475550123    # one phone
//   deno task test-send --url https://.../functions/mcp --needs food,legal --near 11368
//
// Prints only the last 4 digits of any number.

const env = await loadEnv(new URL("../.env", import.meta.url));
const arg = (name: string, fallback = "") => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && Deno.args[i + 1] ? Deno.args[i + 1] : fallback;
};

const url = arg("url", "http://localhost:8787/functions/mcp");
const needs = arg("needs", "food,health,id").split(",").map((s) => s.trim()).filter(Boolean);
const near = arg("near", "Corona");
const mask = (p: string) => `…${p.slice(-4)}`;

let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? {};
  const text = result.content?.[0]?.text ?? JSON.stringify(body.error ?? body);
  if (result.isError || body.error) throw new Error(`${name} failed: ${text}`);
  return result.structuredContent ?? JSON.parse(text);
}

async function joinedPhones(): Promise<string[]> {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN;
  const sandbox = (env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886").replace("whatsapp:", "");
  const q = new URLSearchParams({ To: `whatsapp:${sandbox}`, PageSize: "100" });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q}`, {
    headers: { authorization: "Basic " + btoa(`${sid}:${token}`) },
  });
  const data = await res.json();
  const phones = new Set<string>();
  for (const m of data.messages ?? []) {
    if (/^join\s/i.test(m.body ?? "")) phones.add(String(m.from).replace("whatsapp:", ""));
  }
  return [...phones];
}

const to = arg("to");
const phones = to ? [to] : await joinedPhones();
if (!phones.length) {
  console.log("No phones have joined the sandbox yet.");
  Deno.exit(1);
}

const plan = await call("make_plan", { needs, near, language: "es" });
const planText = String(plan.plan_text ?? "");
console.log(`Plan for ${needs.join(", ")} near ${near}: ${planText.length} characters`);

for (const phone of phones) {
  try {
    const out = await call("send_to_phone", { phone, plan_text: planText, consent: true, language: "es" });
    console.log(`${mask(phone)}: sent=${out.sent} ${out.status ?? ""} ${out.message ?? ""}`.trim());
  } catch (err) {
    console.log(`${mask(phone)}: ${(err as Error).message.replaceAll(phone, mask(phone))}`);
  }
  await new Promise((r) => setTimeout(r, 3500)); // sandbox: one message every 3 seconds
}

async function loadEnv(path: URL): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const line of (await Deno.readTextFile(path)).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[2]) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch { /* no .env */ }
  return out;
}
