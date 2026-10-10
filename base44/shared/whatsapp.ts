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

import { resolveNear } from "./geo.ts";
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
      "Hola, soy NYC Navigator. Le ayudo a encontrar servicios para inmigrantes en Nueva York.\n\n" +
      "Escríbame qué necesita y su código postal o barrio, en un solo mensaje. Por ejemplo:\n" +
      "• comida en Corona\n• acabo de llegar con mis hijos a 11368, necesito comida, médico e identificación\n" +
      "• ¿es legítimo el notario Juan Pérez en Queens?\n\n" +
      "Nunca le preguntamos por su estatus migratorio.",
    need_near: "¿En qué código postal o barrio está? Escríbame lo que necesita y el lugar en un solo mensaje, por ejemplo: comida en 11368.",
    need_what: "¿Qué necesita? Por ejemplo: comida, ayuda legal, salud, identificación, escuela o dinero. Escríbalo junto con su código postal o barrio.",
    found: "Cerca de {near}:",
    none: "No encontré lugares para eso cerca de {near}. Pruebe con otro barrio o llame al 311.",
    hours: "Horario",
    phone: "Tel.",
    call_ahead: "Llame antes para confirmar.",
    more: "Para un plan con varios pasos, escriba todo lo que necesita.",
    footer: "Info y referidos, no asesoría legal.",
    error: "Lo siento, ahora no pude buscar. Intente de nuevo en un minuto o llame al 311.",
  },
  en: {
    help:
      "Hi, I'm NYC Navigator. I help immigrant New Yorkers find services.\n\n" +
      "Text me what you need and your zip code or neighborhood, in one message. For example:\n" +
      "• food in Corona\n• just arrived with my kids in 11368, need food, a doctor and an ID\n" +
      "• is the notario Juan Perez in Queens legit?\n\n" +
      "We never ask about immigration status.",
    need_near: "Which zip code or neighborhood are you in? Send what you need and where in one message, e.g. food in 11368.",
    need_what: "What do you need? For example: food, legal help, health care, ID, school or money. Send it with your zip code or neighborhood.",
    found: "Near {near}:",
    none: "I couldn't find places for that near {near}. Try another neighborhood or call 311.",
    hours: "Hours",
    phone: "Phone",
    call_ahead: "Call ahead to confirm.",
    more: "For a step-by-step plan, text everything you need.",
    footer: "Info and referrals, not legal advice.",
    error: "Sorry, I couldn't search right now. Try again in a minute or call 311.",
  },
};

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/** Drop sentences that state a status; keep the rest (needs, place, notario name). */
export function withoutStatus(text: string): string {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim() && !statesStatus(s)).join(" ").trim();
}

const EN_WORDS = /\b(i|my|need|help|food|where|near|the|is|legit|just|arrived|kids|doctor|lawyer|hi|hello)\b/i;
const ES_WORDS = /\b(necesito|ayuda|comida|donde|dónde|cerca|mis|hijos|abogado|hola|el|la|es|para|llegu[eé]|acabo)\b/i;
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
    if (str(p.last_checked)) lines.push(`   ✓ ${str(p.last_checked)}`);
  });
  lines.push("", s.more);
  return lines.join("\n");
}

/** Run the right tool and format the answer for a phone. Never throws. */
export async function answerMessage(req: Request, rawText: string): Promise<string> {
  const text = withoutStatus(String(rawText ?? "").slice(0, 1000));
  const fallbackLang: Lang = parseKeywords(text || "hola").language;
  if (!text) return TEXT[fallbackLang].help;
  let u: Understood;
  try {
    u = await understand(req, text);
  } catch {
    u = parseKeywords(text);
  }
  const l = langOf(u.language);
  const s = TEXT[l];
  const ctx = { channel: "whatsapp" as const };
  try {
    if (u.intent === "help") return s.help;
    if (u.intent === "check_provider") {
      if (!u.name) return s.help;
      const data = await checkProvider.run(req, { name: u.name, near: u.near, language: l }, ctx);
      return capReply(summarize("check_provider", data, l));
    }
    if (!u.needs.length) return s.need_what;
    if (!u.near) return s.need_near;
    if (u.intent === "plan" && u.needs.length > 1) {
      const data = await makePlan.run(req, { needs: u.needs, near: u.near, language: l }, ctx) as Data;
      return capReply(`${str(data.plan_text)}\n\n${s.footer}`);
    }
    const data = await findResources.run(req, { need: u.needs[0], near: u.near, language: l }, ctx) as Data;
    return capReply(`${formatPlaces(data, l)}\n\n${s.footer}`);
  } catch (err) {
    console.error("whatsapp: tool failed:", err instanceof Error ? err.name : "unknown");
    return s.error;
  }
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
