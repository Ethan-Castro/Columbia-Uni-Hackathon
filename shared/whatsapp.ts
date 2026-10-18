// Two-way WhatsApp: a person texts the Twilio sandbox, we answer from the graph.
//
//   const reply = await answerMessage(req, "necesito comida en Corona");
//
// One LLM call (4 s cap) reads the message into { intent, needs, near, name,
// language }; a keyword parser covers it if the model is slow or off. Then the
// same tools as the MCP server run with channel "whatsapp" (they write the
// anonymous RequestLog row), and the answer is formatted for a phone: short,
// places + hours + phone, under 1,500 characters.
//
// Privacy: the sender's number and the message text are never logged or
// stored. Sentences that state an immigration status are dropped before the
// text reaches the LLM. Information and referrals only.

import { haversineKm, resolveNear, ZIP_CENTROIDS } from "./geo.ts";
import { clearSession, getSession, saveSession } from "./wa-session.ts";
import { langOf } from "./i18n.ts";
import type { Lang } from "./i18n.ts";
import { llmJson } from "./rank.ts";
import { statesStatus } from "./redact.ts";
import { NEEDS } from "./schema.ts";
import type { Need } from "./schema.ts";
import { normalize } from "./text.ts";
import { checkProvider } from "./tools/check_provider.ts";
import { findResources } from "./tools/find_resources.ts";
import { parseNeed } from "./tools/input.ts";
import { makePlan } from "./tools/make_plan.ts";
import { recordFeedback } from "./tools/report_feedback.ts";
import { summarize } from "./ui/result.ts";

export const MAX_REPLY_CHARS = 1500;
const PARSE_TIMEOUT_MS = 4000;

type Intent = "find" | "plan" | "check_provider" | "help";

export interface Understood {
  intent: Intent;
  needs: Need[];
  near: string;
  name: string;
  language: Lang;
}

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    help:
      "Hola 👋 Soy el Navegador de NYC. Es gratis, y nunca le preguntamos por sus papeles.\n\n" +
      "¿Qué necesita? Responda con un número:\n" +
      "1 Comida\n2 Doctor o clínica\n3 Abogado o ayuda legal\n4 Identificación (IDNYC)\n5 Escuela\n" +
      "6 Dinero o banco\n7 Vivienda o renta\n8 Trabajo\n9 Beneficios (SNAP, Medicaid)\n\n" +
      "O escríbalo con sus palabras, por ejemplo: necesito comida en Corona.",
    need_near: "¿En qué barrio o código postal está? Por ejemplo: Corona o 11368. También puede mandar su ubicación 📍.",
    need_what: "¿Qué necesita? Responda con un número: 1 Comida, 2 Doctor, 3 Abogado, 4 Identificación, 5 Escuela, 6 Dinero, 7 Vivienda, 8 Trabajo, 9 Beneficios.",
    stopped: "Listo. No le escribiremos más. No guardamos su número. Si algún día necesita ayuda, escriba HOLA.",
    voice_failed: "No pude escuchar el audio. ¿Me lo puede escribir? Por ejemplo: comida en Corona.",
    found: "Cerca de {near}:",
    none: "No encontré lugares para eso cerca de {near}. Pruebe con otro barrio o llame al 311.",
    hours: "Horario",
    phone: "Tel.",
    call_ahead: "Llame antes para confirmar.",
    more: "Para un plan con varios pasos, escriba todo lo que necesita.",
    footer: "Info y referidos, no asesoría legal.",
    feedback: "¿Le sirvió? Responda SI o NO. ¿Algo está mal? Responda MAL y el código, por ejemplo MAL {code}.",
    code: "código",
    need_code: "Para avisarnos qué está mal, responda MAL y el código de 4 letras que aparece junto al lugar, por ejemplo MAL K7Q2.",
    error: "Lo siento, ahora no pude buscar. Intente de nuevo en un minuto o llame al 311.",
  },
  en: {
    help:
      "Hi 👋 I'm the NYC Navigator. It's free, and we never ask about immigration status.\n\n" +
      "What do you need? Reply with a number:\n" +
      "1 Food\n2 Doctor or clinic\n3 Lawyer or legal help\n4 ID (IDNYC)\n5 School\n" +
      "6 Money or bank\n7 Housing or rent\n8 Work\n9 Benefits (SNAP, Medicaid)\n\n" +
      "Or say it in your own words, e.g. I need food in Corona.",
    need_near: "Which neighborhood or zip code are you in? For example: Corona or 11368. You can also send your location 📍.",
    need_what: "What do you need? Reply with a number: 1 Food, 2 Doctor, 3 Lawyer, 4 ID, 5 School, 6 Money, 7 Housing, 8 Work, 9 Benefits.",
    stopped: "Done. We won't message you again, and we don't keep your number. If you ever need help, text HI.",
    voice_failed: "I couldn't hear the audio. Can you type it? For example: food in Corona.",
    found: "Near {near}:",
    none: "I couldn't find places for that near {near}. Try another neighborhood or call 311.",
    hours: "Hours",
    phone: "Phone",
    call_ahead: "Call ahead to confirm.",
    more: "For a step-by-step plan, text everything you need.",
    footer: "Info and referrals, not legal advice.",
    feedback: "Did it help? Reply YES or NO. Something wrong? Reply WRONG and the code, e.g. WRONG {code}.",
    code: "code",
    need_code: "To tell us what is wrong, reply WRONG and the 4-letter code shown next to the place, e.g. WRONG K7Q2.",
    error: "Sorry, I couldn't search right now. Try again in a minute or call 311.",
  },
};

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/** Drop sentences that state a status; keep the rest (needs, place, notario name). */
export function withoutStatus(text: string): string {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim() && !statesStatus(s)).join(" ").trim();
}

const EN_WORDS = /\b(i|my|need|help|food|where|near|the|is|legit|just|arrived|kids|doctor|lawyer|hi|hello)\b/i;
const ES_WORDS = /\b(necesito|ayuda|comida|donde|dónde|cerca|mis|hijos|abogado|hola|el|la|es|para|llegu[eé]|acabo|y|un|una|quiero|busco|m[eé]dico|cl[ií]nica|tambi[eé]n|otro|otra)\b/i;
/** Clearly English, enough to switch a Spanish conversation ("y un doctor" stays Spanish). */
const STRONG_EN = /\b(i|i'm|my|need|please|where|the|and|hello|hi|thanks)\b/i;
const CHECK_WORDS = /\b(notari[oa]s?|legit\w*|leg[ií]tim\w*|verdad|real|fraud\w*|estafa|scam|revis\w*|check|verify|verific\w*|consultor\w*|consultant)\b/i;
const PLAN_WORDS = /\b(acabo de llegar|reci[eé]n llegad\w*|just arrived|new here|plan|pasos|steps|qu[eé] hago primero|what do i do first)\b/i;
const GREETING = /^(hola|hello|hi|hey|buenas|buenos d[ií]as|buenas tardes|ayuda|help|menu|men[uú]|info|start)\W*$/i;

/** Keyword parse (no LLM). */
export function parseKeywords(text: string): Understood {
  const language: Lang = EN_WORDS.test(text) && !ES_WORDS.test(text) ? "en" : "es";
  if (GREETING.test(text.trim())) return { intent: "help", needs: [], near: "", name: "", language };
  const words = normalize(text, { dropSuffixes: false }).split(/\s+/);
  const needs: Need[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const w of [words[i] + " " + (words[i + 1] ?? ""), words[i]]) {
      const n = parseNeed(w);
      if (n && !needs.includes(n)) needs.push(n);
    }
  }
  const near = resolveNear(text);
  const nearText = near.matched ? near.label : "";
  if (CHECK_WORDS.test(text)) {
    // Name: text in quotes, or capitalized words after "notario"/"llamado"/"called".
    const quoted = text.match(/["“']([^"”']{3,80})["”']/)?.[1];
    const after = text.match(/(?:notari[oa]|llamad[oa]|called|named|agencia|oficina)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.&'-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.&'-]*){0,4})/)?.[1];
    return { intent: "check_provider", needs: ["legal"], near: nearText, name: (quoted ?? after ?? "").trim(), language };
  }
  return { intent: needs.length > 1 || PLAN_WORDS.test(text) ? "plan" : "find", needs, near: nearText, name: "", language };
}

const PARSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["find", "plan", "check_provider", "help"] },
    needs: { type: "array", items: { type: "string", enum: [...NEEDS] } },
    near: { type: "string" },
    name: { type: "string" },
    language: { type: "string", enum: ["es", "en"] },
  },
  required: ["intent", "needs", "near", "name", "language"],
};

/** LLM parse with the keyword parse as fallback and sanity check. */
export async function understand(req: Request, text: string): Promise<Understood> {
  const kw = parseKeywords(text);
  if (kw.intent === "help") return kw;
  const prompt = [
    "You route WhatsApp messages for NYC Navigator, a directory of services for immigrant New Yorkers.",
    "Read the message and return JSON:",
    '- intent: "check_provider" if they ask whether a notario, consultant, agency, lawyer or office is legitimate or authorized; "plan" if they have several needs or just arrived; "find" for one kind of help; "help" if it is only a greeting or unclear.',
    `- needs: kinds of help, from ${NEEDS.join(", ")} (WIC/SNAP/pantry = food; clinic/doctor = health; IDNYC = id; remittances/bank = money; lawyer/papers = legal).`,
    '- near: the NYC zip code, neighborhood or borough they mention, exactly as written, or "".',
    '- name: for check_provider, the person or business name they ask about, or "".',
    '- language: "en" if written in English, otherwise "es".',
    "Never infer anything about immigration status.",
    `Message: ${JSON.stringify(text)}`,
  ].join("\n");
  const ai = await llmJson(req, prompt, PARSE_SCHEMA, PARSE_TIMEOUT_MS);
  if (!ai) return kw;
  const needs = (Array.isArray(ai.needs) ? ai.needs : []).filter((n): n is Need => (NEEDS as readonly unknown[]).includes(n));
  const intent = (["find", "plan", "check_provider", "help"] as const).find((i) => i === ai.intent) ?? kw.intent;
  const aiNear = typeof ai.near === "string" ? ai.near.trim().slice(0, 120) : "";
  return {
    intent,
    needs: needs.length ? needs : kw.needs,
    near: aiNear && resolveNear(aiNear).matched ? aiNear : kw.near,
    name: (typeof ai.name === "string" && ai.name.trim().slice(0, 120)) || kw.name,
    language: ai.language === "en" ? "en" : ai.language === "es" ? "es" : kw.language,
  };
}

/** Cap at MAX_REPLY_CHARS on a line or word boundary. */
export function capReply(text: string, max = MAX_REPLY_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd() + "…";
}

type Data = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function formatPlaces(d: Data, l: Lang): string {
  const s = TEXT[l];
  const results = (Array.isArray(d.results) ? d.results : []) as Data[];
  const near = str(d.near) || "NYC";
  if (!results.length) return fill(s.none, { near });
  const lines = [fill(s.found, { near })];
  results.slice(0, 3).forEach((p, i) => {
    lines.push("", `${i + 1}. ${str(p.name)}`);
    if (str(p.address)) lines.push(`   ${str(p.address)}`);
    lines.push(`   ${s.hours}: ${str(p.hours) || s.call_ahead}`);
    if (str(p.phone)) lines.push(`   ${s.phone} ${str(p.phone)}`);
    if (!str(p.phone) && str(p.call_hint)) lines.push(`   ${str(p.call_hint)}`);
    if (str(p.check_first)) lines.push(`   ⚠ ${str(p.check_first)}`);
    const checked = str(p.last_checked) ? `✓ ${str(p.last_checked)} · ` : "";
    lines.push(`   ${checked}${s.code} ${str(p.code)}`);
  });
  lines.push("", s.more, fill(s.feedback, { code: str(results[0].code) }));
  return lines.join("\n");
}

// "SI", "NO K7Q2", "MAL K7Q2", "CERRADO K7Q2": feedback about an earlier answer. Stateless: the
// 4-character code in our reply names the place, so we never keep who was sent what.
const FEEDBACK_RE = /^\s*(s[ií]|yes|no|mal|wrong|cerrado|closed)(?=$|[\s:.,!-])[\s:.,!-]*([A-Za-z0-9]{4})?\s*[.!]*\s*$/i;

export function parseFeedback(text: string): { helpful?: boolean; issue?: "closed" | "other"; code: string; language: Lang } | null {
  const m = text.match(FEEDBACK_RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const language: Lang = ["yes", "wrong", "closed"].includes(word) ? "en" : "es";
  const code = (m[2] ?? "").toUpperCase();
  if (word === "mal" || word === "wrong") return { issue: "other", code, language };
  if (word === "cerrado" || word === "closed") return { issue: "closed", code, language };
  return { helpful: word !== "no", code, language };
}

/** Menu numbers from the help message ("1", "1 y 2", "3,4"). */
const MENU: Need[] = ["food", "health", "legal", "id", "school", "money", "housing", "work", "benefits"];
export function menuNeeds(text: string): Need[] | null {
  const t = text.trim();
  if (!/^[1-9](\s*(,|y|and|&|\s)\s*[1-9])*\s*$/i.test(t)) return null;
  return [...new Set((t.match(/[1-9]/g) ?? []).map((d) => MENU[Number(d) - 1]))];
}

const STOP_RE = /^\s*(stop|baja|alto|parar|cancelar|unsubscribe|no m[aá]s mensajes)\s*[.!]*\s*$/i;

export interface MessageContext {
  /** HMAC of the sender (shared/wa-session.ts sessionKey), for the 30-minute memory. Never the number. */
  sessionKey?: string | null;
  /** A shared WhatsApp location pin. */
  location?: { lat: number; lng: number };
}

/** Run the right tool and format the answer for a phone. Never throws. */
export async function answerMessage(req: Request, rawText: string, mc: MessageContext = {}): Promise<string> {
  const text = withoutStatus(String(rawText ?? "").slice(0, 1000));
  const key = mc.sessionKey ?? null;
  const session = await getSession(req, key);
  const fallbackLang: Lang = text ? parseKeywords(text).language : session?.language ?? "es";
  if (text && STOP_RE.test(text)) {
    await clearSession(req, key);
    return TEXT[fallbackLang].stopped;
  }
  const pinNear = mc.location ? nearestZipTo(mc.location.lat, mc.location.lng) : "";
  if (!text && !pinNear) return TEXT[fallbackLang].help;
  const fb = text ? parseFeedback(text) : null;
  if (fb) {
    if (fb.issue && !fb.code) return TEXT[fb.language].need_code;
    try {
      const res = await recordFeedback(req, { ...(fb.code ? { code: fb.code } : {}), helpful: fb.helpful, issue: fb.issue, language: fb.language }, "whatsapp");
      return res.message;
    } catch (err) {
      const e = err as { status?: unknown; message?: string } | null;
      if (e?.status === 404 && e.message) return e.message;
      if (fb.code) return TEXT[fb.language].need_code;
      return TEXT[fb.language].error;
    }
  }
  let u: Understood;
  const menu = text ? menuNeeds(text) : null;
  if (menu) u = { intent: menu.length > 1 ? "plan" : "find", needs: menu, near: "", name: "", language: session?.language ?? "es" };
  else if (!text) u = { intent: "find", needs: [], near: "", name: "", language: session?.language ?? "es" };
  else {
    try {
      u = await understand(req, text);
    } catch {
      u = parseKeywords(text);
    }
  }
  // One question at a time: what was said a moment ago fills in what this message leaves out.
  if (pinNear) u.near = pinNear;
  if (session) {
    if (!u.needs.length && (u.intent === "find" || u.intent === "plan" || u.intent === "help") && u.near) {
      u.needs = session.needs;
      u.intent = session.needs.length > 1 ? "plan" : "find";
    }
    if (!u.near && u.needs.length) u.near = session.near;
    if (!menu && text.length < 4 && u.intent === "help") u.language = session.language;
    // A follow-up keeps the conversation's language unless it is clearly the other one.
    if (text && u.language !== session.language && !(u.language === "en" && STRONG_EN.test(text))) u.language = session.language;
  }
  const l = langOf(u.language);
  const s = TEXT[l];
  const ctx = { channel: "whatsapp" as const };
  try {
    if (u.intent === "help" && !(u.near && session?.needs.length)) {
      await clearSession(req, key);
      return s.help;
    }
    if (u.intent === "check_provider") {
      if (!u.name) return s.help;
      const data = await checkProvider.run(req, { name: u.name, near: u.near, language: l }, ctx);
      return capReply(summarize("check_provider", data, l));
    }
    if (!u.needs.length) {
      if (u.near) await saveSession(req, key, { needs: [], near: u.near, language: l });
      return s.need_what;
    }
    if (!u.near) {
      await saveSession(req, key, { needs: u.needs, near: "", language: l });
      return s.need_near;
    }
    // Answered: keep the place (so "y un doctor?" works next), forget the needs.
    await saveSession(req, key, { needs: [], near: u.near, language: l });
    if (u.needs.length > 1) {
      const data = await makePlan.run(req, { needs: u.needs, near: u.near, language: l }, ctx) as Data;
      const first = ((Array.isArray(data.steps) ? data.steps : []) as Data[]).map((x) => x.place as Data | null).find((p) => p?.code);
      const ask = first ? `\n${fill(s.feedback, { code: str(first.code) })}` : "";
      return capReply(`${str(data.plan_text)}${ask}\n\n${s.footer}`);
    }
    const data = await findResources.run(req, { need: u.needs[0], near: u.near, language: l }, ctx) as Data;
    return capReply(`${formatPlaces(data, l)}\n\n${s.footer}`);
  } catch (err) {
    if ((err as { status?: unknown } | null)?.status === 400) {
      await saveSession(req, key, { needs: u.needs, near: "", language: l });
      return s.need_near;
    }
    console.error("whatsapp: tool failed:", err instanceof Error ? err.name : "unknown");
    return s.error;
  }
}

/** The zip whose center is closest to a shared location pin (NYC only). */
function nearestZipTo(lat: number, lng: number): string {
  if (!(lat > 40.4 && lat < 41.0 && lng > -74.3 && lng < -73.65)) return "";
  let best = "", bestKm = Infinity;
  for (const [zip, [zlat, zlng]] of Object.entries(ZIP_CENTROIDS)) {
    const km = haversineKm(lat, lng, zlat, zlng);
    if (km < bestKm) [best, bestKm] = [zip, km];
  }
  return best;
}

// ---------- Twilio webhook signature (X-Twilio-Signature) ----------

/** base64(HMAC-SHA1(authToken, url + each param name+value, sorted by name)). */
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Constant-time compare of two short strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** TwiML with one reply message (XML-escaped). */
export function twiml(message: string): string {
  const esc = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}
