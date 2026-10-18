// Send a WhatsApp message through Twilio's REST API (fetch only, no SDK).
//
//   const { sid, status } = await sendWhatsApp("+17185550101", "Hola ...");
//
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM. Two modes:
//   - Sandbox (from whatsapp:+14155238886): the recipient must first send "join <word>".
//   - Production sender (our own approved number): a free-form message works within 24 h
//     of the person writing to us. Outside that window WhatsApp only allows an approved
//     template, so when Twilio answers 63016 and TWILIO_WHATSAPP_TEMPLATE_SID is set (a
//     Content template whose body is "{{1}}"-style), the same text goes out as that template.
//     docs/WHATSAPP_SETUP.md has the template text to submit.
//
// Privacy: the phone number is never logged, and errors never echo it (Twilio's
// own error messages can contain the number, so we only pass on its code).
//
// PORTING: unchanged in Base44 (fetch + Deno.env.get secrets).

import { HttpError } from "./http.ts";
import { getSecret } from "./secrets.ts";

const TIMEOUT_MS = 10_000;
const E164 = /^\+[1-9]\d{7,14}$/;

/** HttpError that also carries Twilio's numeric error code, when there is one. */
export class TwilioError extends HttpError {
  constructor(status: number, message: string, public code?: number) {
    super(status, message);
    this.name = "TwilioError";
  }
}

/** Plain explanations for the Twilio error codes we expect in the sandbox. */
const KNOWN_CODES: Record<number, string> = {
  63015:
    "the recipient has not joined the WhatsApp Sandbox (they must first send the 'join' word to the sandbox number)",
  63016: "the message is outside the 24-hour window; the recipient must message the sandbox number again first",
  63007: "the WhatsApp sender (TWILIO_WHATSAPP_FROM) is not set up for this account",
  63003: "the recipient number cannot receive WhatsApp messages",
  21211: "the 'To' number is not a valid phone number",
  21608: "trial accounts can only message verified numbers",
  21614: "the 'To' number cannot receive this message",
  20003: "Twilio rejected the credentials (check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)",
};

/** Sandbox-related codes: tell the person to join the sandbox. */
export const SANDBOX_CODES = new Set([63015, 63016, 63003]);

export const SANDBOX_NUMBER = "+14155238886";

/** True while TWILIO_WHATSAPP_FROM is Twilio's shared sandbox number (answers mention "join"). */
export function isSandbox(): boolean {
  return (getSecret("TWILIO_WHATSAPP_FROM") ?? "").replace(/^whatsapp:/, "") === SANDBOX_NUMBER;
}

/** WhatsApp template variables are capped (1024 chars for the whole body): leave room for the template's own words. */
const TEMPLATE_VAR_MAX = 900;

export interface WhatsAppResult {
  sid: string;
  status: string;
}

/**
 * Send `body` to `to` (E.164, e.g. "+17185550101") on WhatsApp.
 * Throws TwilioError(503) when not configured, (400) for a bad number,
 * (502) when Twilio fails or does not answer within 10 s.
 */
export async function sendWhatsApp(to: string, body: string): Promise<WhatsAppResult> {
  if (!E164.test(to)) throw new TwilioError(400, "Invalid phone number (expected E.164, e.g. +17185550101)");
  const sid = getSecret("TWILIO_ACCOUNT_SID");
  const token = getSecret("TWILIO_AUTH_TOKEN");
  const fromRaw = getSecret("TWILIO_WHATSAPP_FROM");
  if (!sid || !token || !fromRaw) throw new TwilioError(503, "WhatsApp sending is not configured");
  const from = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${fromRaw}`;

  try {
    return await postMessage(sid, token, new URLSearchParams({ From: from, To: `whatsapp:${to}`, Body: body }));
  } catch (err) {
    const template = getSecret("TWILIO_WHATSAPP_TEMPLATE_SID");
    if (!(err instanceof TwilioError) || err.code !== 63016 || !template || isSandbox()) throw err;
    // Outside the 24-hour window: the approved template carries the same text.
    const text = body.length > TEMPLATE_VAR_MAX ? body.slice(0, TEMPLATE_VAR_MAX - 1).trimEnd() + "…" : body;
    return await postMessage(sid, token, new URLSearchParams({
      From: from,
      To: `whatsapp:${to}`,
      ContentSid: template,
      ContentVariables: JSON.stringify({ 1: text }),
    }));
  }
}

async function postMessage(sid: string, token: string, form: URLSearchParams): Promise<WhatsAppResult> {
  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new TwilioError(502, timedOut ? "Twilio did not answer within 10 seconds" : "Could not reach Twilio");
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON body: handled below
  }

  if (!res.ok) {
    const code = typeof data.code === "number" ? data.code : undefined;
    const why = code !== undefined && KNOWN_CODES[code] ? `: ${KNOWN_CODES[code]}` : "";
    throw new TwilioError(502, `Twilio error ${code ?? res.status}${why}`, code);
  }
  return { sid: String(data.sid ?? ""), status: String(data.status ?? "queued") };
}
