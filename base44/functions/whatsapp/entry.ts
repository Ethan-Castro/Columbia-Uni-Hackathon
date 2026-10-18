// POST /functions/whatsapp: Twilio WhatsApp webhook (sandbox or a production sender) ("When a message comes in").
// Twilio sends form fields (Body, From, ...); we answer with TwiML in the same
// response. Logic lives in shared/whatsapp.ts.
//
// Security: requests must carry a valid X-Twilio-Signature for this URL, signed
// with TWILIO_AUTH_TOKEN. Behind a proxy the URL Twilio signed can differ from
// req.url, so set the WHATSAPP_WEBHOOK_URL secret to the exact URL pasted in
// the Twilio console. WHATSAPP_SKIP_SIGNATURE=true turns the check off (demo
// escape hatch only).
//
// Privacy: From (the phone number) and Body are never logged or stored. From only
// becomes an HMAC key for the 30-minute conversation memory (shared/wa-session.ts).
// Also understood: a shared location pin (Latitude/Longitude) and a voice note
// (audio, transcribed and dropped; never stored).

import { getSecret } from "../../shared/secrets.ts";
import { transcribe } from "../../shared/voice.ts";
import { sessionKey } from "../../shared/wa-session.ts";
import { answerMessage, safeEqual, twilioSignature, twiml } from "../../shared/whatsapp.ts";

const MAX_AUDIO_BYTES = 5_000_000;

/** A voice note's words, or "" when there is none, it is too big, or transcription is off/fails. */
async function voiceNoteText(params: Record<string, string>): Promise<string | null> {
  const type = params.MediaContentType0 ?? "";
  const url = params.MediaUrl0 ?? "";
  if (!url || !type.startsWith("audio/")) return null;
  const key = getSecret("ELEVENLABS_API_KEY");
  const sid = getSecret("TWILIO_ACCOUNT_SID"), token = getSecret("TWILIO_AUTH_TOKEN");
  if (!key || !sid || !token || !/^https:\/\/api\.twilio\.com\//.test(url)) return "";
  try {
    const r = await fetch(url, { headers: { authorization: `Basic ${btoa(`${sid}:${token}`)}` }, signal: AbortSignal.timeout(8000) });
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || buf.byteLength > MAX_AUDIO_BYTES) return "";
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return (await transcribe(btoa(bin), type, key, "")).trim();
  } catch {
    return "";
  }
}

const XML = { "content-type": "text/xml; charset=utf-8" };

/** URLs Twilio may have signed: the configured one, the one we see, and the public host behind a proxy. */
function candidateUrls(req: Request): string[] {
  const out = new Set<string>();
  const configured = getSecret("WHATSAPP_WEBHOOK_URL");
  if (configured) out.add(configured);
  out.add(req.url);
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    u.host = host;
    u.protocol = "https:";
    out.add(u.toString());
  }
  return [...out];
}

async function signatureOk(req: Request, params: Record<string, string>): Promise<boolean> {
  if (getSecret("WHATSAPP_SKIP_SIGNATURE") === "true") return true;
  const token = getSecret("TWILIO_AUTH_TOKEN");
  const given = req.headers.get("x-twilio-signature");
  if (!token || !given) {
    console.error("whatsapp: no signature check possible:", token ? "token set" : "no token", given ? "signature sent" : "no signature");
    return false;
  }
  for (const url of candidateUrls(req)) {
    if (safeEqual(await twilioSignature(token, url, params), given)) return true;
  }
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return new Response("NYC Navigator WhatsApp webhook. Twilio POSTs here.", { headers: { "content-type": "text/plain" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let params: Record<string, string>;
  try {
    params = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!(await signatureOk(req, params))) {
    console.error("whatsapp: rejected request with a missing or invalid Twilio signature");
    return new Response("Forbidden", { status: 403 });
  }
  const lat = Number(params.Latitude), lng = Number(params.Longitude);
  const location = Number.isFinite(lat) && Number.isFinite(lng) && params.Latitude ? { lat, lng } : undefined;
  const heard = await voiceNoteText(params);
  const text = heard ?? (typeof params.Body === "string" ? params.Body : "");
  // Delivery status callbacks: acknowledge with an empty response.
  if (params.MessageStatus && !params.Body && !params.NumMedia && !location) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, { headers: XML });
  }
  if (heard === "") {
    const en = /^\s*(hi|hello|food|help)\b/i.test(params.Body ?? "");
    return new Response(twiml(en ? "I couldn't hear the audio. Can you type it? For example: food in Corona." : "No pude escuchar el audio. ¿Me lo puede escribir? Por ejemplo: comida en Corona."), { headers: XML });
  }
  const reply = await answerMessage(req, text, { sessionKey: await sessionKey(params.From ?? ""), location });
  return new Response(twiml(reply), { headers: XML });
}
