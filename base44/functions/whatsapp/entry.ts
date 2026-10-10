// POST /functions/whatsapp: Twilio WhatsApp Sandbox webhook ("When a message comes in").
// Twilio sends form fields (Body, From, ...); we answer with TwiML in the same
// response. Logic lives in shared/whatsapp.ts.
//
// Security: requests must carry a valid X-Twilio-Signature for this URL, signed
// with TWILIO_AUTH_TOKEN. Behind a proxy the URL Twilio signed can differ from
// req.url, so set the WHATSAPP_WEBHOOK_URL secret to the exact URL pasted in
// the Twilio console. WHATSAPP_SKIP_SIGNATURE=true turns the check off (demo
// escape hatch only).
//
// Privacy: From (the phone number) and Body are never logged or stored.

import { getSecret } from "../../shared/secrets.ts";
import { answerMessage, safeEqual, twilioSignature, twiml } from "../../shared/whatsapp.ts";

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
  // Status callbacks and media-only messages carry no Body: acknowledge with an empty response.
  if (typeof params.Body !== "string" || !params.Body.trim()) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, { headers: XML });
  }
  const reply = await answerMessage(req, params.Body);
  return new Response(twiml(reply), { headers: XML });
}
