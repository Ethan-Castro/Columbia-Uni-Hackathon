// send_to_phone: send a plan to the person's WhatsApp, only with consent.
//
// Steps: consent must be exactly `true` (else nothing is sent and Twilio is not
// called) -> phone must be E.164 or a US 10-digit number -> status details are
// stripped (shared/redact.ts) -> short header + body + "not legal advice"
// footer, capped at 1500 chars -> Twilio WhatsApp Sandbox (shared/twilio.ts).
//
// The phone number is never logged, stored, or returned (only "•••• ••61").
// RequestLog: channel "whatsapp", no needs, no zip, results_found 1 if sent.

import { langOf, t } from "../i18n.ts";
import type { Lang } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import { redactStatus } from "../redact.ts";
import { sendWhatsApp, SANDBOX_CODES, TwilioError } from "../twilio.ts";
import { getLanguage, getString } from "./input.ts";
import type { Tool } from "./types.ts";

export const MAX_MESSAGE_CHARS = 1500;

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    header: "NYC Navigator: su plan (lugares, horarios y qué llevar)",
    footer: "Info y referidos, no asesoría legal.",
    empty_plan: "No hay nada que enviar: el plan está vacío. Comparta primero los lugares, horarios y qué llevar.",
    not_configured: "El envío por WhatsApp no está disponible ahora. Puede copiar el plan desde aquí.",
    sandbox:
      " Para recibir mensajes de prueba, primero tiene que unirse a nuestro WhatsApp de prueba: envíe por WhatsApp el mensaje \"join\" con la palabra clave al número de prueba, y vuelva a intentarlo.",
    delivery_note:
      "Twilio aceptó el mensaje. En la prueba (sandbox) solo llega si la persona ya se unió al WhatsApp de prueba.",
  },
  en: {
    header: "NYC Navigator: your plan (places, hours, what to bring)",
    footer: "Info and referrals, not legal advice.",
    empty_plan: "There is nothing to send: the plan is empty. Share the places, hours, and what to bring first.",
    not_configured: "WhatsApp sending is not available right now. You can copy the plan from here.",
    sandbox:
      " To get test messages, first join our test WhatsApp: send the \"join\" message with the keyword to the sandbox number on WhatsApp, then try again.",
    delivery_note:
      "Twilio accepted the message. In the sandbox it only arrives if the person has already joined the test WhatsApp.",
  },
};

/** "+1 (718) 555-0101", "718-555-0101", "0052 55 1234 5678", "whatsapp:+52..." -> E.164, or null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let s = String(raw).trim().replace(/^whatsapp:/i, "").replace(/[\s().\- ]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^[2-9]\d{9}$/.test(s)) return "+1" + s; // US 10-digit
  if (/^1[2-9]\d{9}$/.test(s)) return "+" + s; // US with leading 1
  return null;
}

/** Only the last 2 digits: "•••• ••61". */
export function maskPhone(e164: string): string {
  return `•••• ••${e164.slice(-2)}`;
}

/** Remove the recipient's own number from text, in any common formatting. */
function scrubPhone(text: string, e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return text;
  const pattern = new RegExp(`(\\+?\\d{0,3}[\\s().-]*)?${digits.split("").join("[\\s().-]*")}`, "g");
  return text.replace(pattern, "•••");
}

/** Header + body + footer, never longer than MAX_MESSAGE_CHARS. */
export function composeMessage(body: string, lang: Lang): string {
  const { header, footer } = TEXT[lang];
  const room = MAX_MESSAGE_CHARS - header.length - footer.length - 4; // two "\n\n"
  let text = body;
  if (text.length > room) {
    const cut = text.slice(0, room - 1);
    const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
    text = (at > room * 0.6 ? cut.slice(0, at) : cut).trimEnd() + "…";
  }
  return `${header}\n\n${text}\n\n${footer}`;
}

export const sendToPhone: Tool = {
  definition: {
    name: "send_to_phone",
    description:
      "Send the plan to the person's phone by WhatsApp (mandar al teléfono, enviar por WhatsApp, mándamelo, " +
      "text me): the places, hours, and what to bring. ALWAYS ask the person for permission first (\"¿Quiere que " +
      "se lo envíe por WhatsApp?\") and set consent=true only after an explicit yes; otherwise nothing is sent. " +
      "Never put immigration status details in plan_text; anything about status, visas, asylum, court dates, or " +
      "an intake summary is removed before sending. The phone number is never stored or logged.",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Phone number with country code, e.g. '+17185550101'. US 10-digit numbers are accepted.",
        },
        plan_text: {
          type: "string",
          description: "What to send: places, addresses, hours, and what to bring. No immigration status details.",
        },
        consent: {
          type: "boolean",
          description: "true ONLY if the person explicitly said yes to receiving this WhatsApp message.",
        },
        language: {
          type: "string",
          description: "Language code for the fixed text, e.g. 'es' (default) or 'en'.",
          default: "es",
        },
      },
      required: ["phone", "plan_text", "consent"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },

  async run(req, input, _ctx) {
    const language = getLanguage(input);
    const lang = langOf(language);

    const finish = <T extends { sent: boolean }>(result: T): T & { language: string } => {
      // One anonymous row per call. Never the phone number or the text.
      void logRequest(req, {
        needs: [],
        zip: "",
        language,
        channel: "whatsapp",
        results_found: result.sent ? 1 : 0,
        unmet: false,
      });
      return { ...result, language };
    };

    // 1. Consent: strictly the boolean true. No phone parsing, no Twilio call otherwise.
    if (input.consent !== true) {
      return finish({ sent: false, reason: "consent_required", message: t(lang, "consent_required") });
    }

    // 2. Phone.
    const phone = normalizePhone(input.phone);
    if (!phone) return finish({ sent: false, reason: "phone_invalid", message: t(lang, "phone_invalid") });
    const to = maskPhone(phone);

    // 3. Text: strip status details, then the recipient's own number, then cap.
    const { text: clean, removed } = redactStatus(getString(input, "plan_text", { max: 20_000 }));
    const body = scrubPhone(clean, phone).trim();
    if (!body) {
      return finish({ sent: false, reason: "empty_plan", to, removed_status_items: removed, message: TEXT[lang].empty_plan });
    }
    const message = composeMessage(body, lang);

    // 4. Send.
    try {
      const { sid, status } = await sendWhatsApp(phone, message);
      return finish({
        sent: true,
        to,
        sid,
        status,
        removed_status_items: removed,
        chars: message.length,
        text_sent: message,
        message: t(lang, "sent_ok"),
        delivery_note: TEXT[lang].delivery_note,
      });
    } catch (err) {
      const code = err instanceof TwilioError ? err.code : undefined;
      const notConfigured = err instanceof TwilioError && err.status === 503;
      return finish({
        sent: false,
        reason: notConfigured ? "not_configured" : "send_failed",
        to,
        ...(code !== undefined ? { error_code: code } : {}),
        // TwilioError messages never contain the phone; anything else stays generic.
        detail: err instanceof TwilioError ? err.message : "Unexpected error while sending",
        removed_status_items: removed,
        message: notConfigured
          ? TEXT[lang].not_configured
          : t(lang, "send_failed") + (code !== undefined && SANDBOX_CODES.has(code) ? TEXT[lang].sandbox : ""),
      });
    }
  },
};
