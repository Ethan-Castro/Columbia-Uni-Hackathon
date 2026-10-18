// Push voice-agent/prompt.es.md and the line's settings to the ElevenLabs agent. See README.md.
//
//   set -a && . ./.env && set +a && deno run -A voice-agent/apply.ts            # dry run: shows what changes
//   set -a && . ./.env && set +a && deno run -A voice-agent/apply.ts --apply    # PATCH the agent

const KEY = Deno.env.get("ELEVENLABS_API_KEY"), AGENT = Deno.env.get("ELEVENLABS_AGENT_ID");
if (!KEY || !AGENT) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing: run with `set -a && . ./.env && set +a`");
const APPLY = Deno.args.includes("--apply");
const prompt = await Deno.readTextFile(new URL("./prompt.es.md", import.meta.url));
const API = `https://api.elevenlabs.io/v1/convai/agents/${AGENT}`;

const FIRST_ES =
  "Hola, gracias por llamar al Navegador de Nueva York. Esta llamada es gratis y no le voy a preguntar por sus papeles. ¿Qué necesita hoy? Por ejemplo: comida, un doctor o un abogado.";
const FIRST_EN =
  "Hi, thanks for calling the New York Navigator. This call is free, and I won't ask about your immigration status. What do you need today? For example: food, a doctor, or a lawyer.";

const body = {
  conversation_config: {
    agent: { first_message: FIRST_ES, language: "es", prompt: { prompt } },
    // Nervous callers pause: wait longer before taking the turn back, and speak a little slower.
    turn: { turn_timeout: 10 },
    tts: { speed: 0.95 },
    language_presets: { en: { overrides: { agent: { first_message: FIRST_EN, language: "en" } } } },
  },
  // Same promise as the rest of the app: no recordings, transcripts gone after a day. Past calls untouched.
  platform_settings: {
    privacy: { record_voice: false, retention_days: 1, delete_audio: true, delete_transcript_and_pii: true, apply_to_existing_conversations: false },
  },
};

const now = await (await fetch(API, { headers: { "xi-api-key": KEY } })).json();
const c0 = now.conversation_config ?? {};
console.log("now   first_message:", c0.agent?.first_message);
console.log("now   prompt chars:", c0.agent?.prompt?.prompt?.length, "| turn_timeout:", c0.turn?.turn_timeout, "| speed:", c0.tts?.speed);
console.log("now   privacy:", JSON.stringify(now.platform_settings?.privacy ?? {}).slice(0, 200));
console.log("new   first_message:", FIRST_ES);
console.log("new   prompt chars:", prompt.length, "| turn_timeout: 10 | speed: 0.95 | + English preset");
console.log("new   privacy:", JSON.stringify(body.platform_settings.privacy));

if (!APPLY) {
  console.log("\nDry run. Pass --apply to PATCH the agent.");
  Deno.exit(0);
}
const r = await fetch(API, { method: "PATCH", headers: { "xi-api-key": KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
const d = await r.json();
if (!r.ok) {
  console.error(r.status, JSON.stringify(d).slice(0, 800));
  Deno.exit(1);
}
const c = d.conversation_config;
console.log("\napplied. first_message:", c.agent.first_message);
console.log("languages:", ["es", ...Object.keys(c.language_presets ?? {})].join(", "), "| privacy:", JSON.stringify(d.platform_settings.privacy).slice(0, 200));
