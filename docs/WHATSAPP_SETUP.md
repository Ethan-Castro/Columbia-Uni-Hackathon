# WhatsApp: from the sandbox to our own number

The code is ready for a production WhatsApp sender. Today the app runs on Twilio's shared sandbox
(`TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`), where people must text "join <word>" first.
Switching is configuration only.

## What already works (sandbox and production)

- **One question at a time.** "comida" → "¿En qué barrio?" → "Corona" → answer. A 30-minute memory keeps only the need, the place name and the language, under an HMAC of the number with a server secret. The number itself and the message text are never stored (`shared/wa-session.ts`, entity `WaSession`).
- **Number menu:** 1 Comida, 2 Doctor, 3 Abogado, 4 Identificación, 5 Escuela, 6 Dinero, 7 Vivienda, 8 Trabajo, 9 Beneficios. "1 y 3" makes a plan.
- **Location pin 📍:** answers for the nearest zip.
- **Voice notes:** transcribed, then dropped (ElevenLabs Scribe today; swap in `shared/voice.ts` `transcribe`).
- **STOP, BAJA or ALTO:** clears the memory and confirms.
- **Feedback:** each place shows a 4-letter code. "SI", "NO" and "MAL K7Q2" record anonymous feedback.
- **Sending from ChatGPT, Claude or the phone line** (`send_to_phone`): free-form within 24 h of the person's last message. Outside that window it uses an approved template (below).

## Go-live checklist

1. **Meta Business Manager.** Verify the business (legal name, address, website https://inmigracion-nyc.com, a domain email). This usually takes a few days. A fiscal sponsor's legal entity works (see docs/SUSTAINABILITY.md).
2. **Pick the number.** A Twilio US number that is not already on WhatsApp. Our ElevenLabs voice number +1 743-330-7616 is a Twilio number. It can also be a WhatsApp sender if it can receive the SMS or voice verification code; otherwise buy a new local number (~$1.15/mo).
3. **Twilio Console → Messaging → Senders → WhatsApp senders → Create.** Connect the Meta account (Embedded Signup) and register the number.
   - Display name: **Navegador NYC**. It must match the business or brand on the website.
   - Profile description: "Información gratis sobre comida, salud, ayuda legal y más en Nueva York. No preguntamos por su estatus."
   - Profile website: https://inmigracion-nyc.com. Profile photo: `web/public/icon.png`.
4. **Webhook.** On the sender, set "A message comes in" to:
   `https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/whatsapp` (POST).
   Put the exact same URL in the Base44 secret `WHATSAPP_WEBHOOK_URL`, so the signature check matches.
5. **Template, for messages after 24 h.** Twilio Console → Messaging → Content Template Builder → new, type *Text*, category **Utility**, language Spanish:
   > Navegador NYC: la información que pidió.
   >
   > {{1}}
   >
   > Info y referidos, no asesoría legal. Responda BAJA para no recibir más.

   Submit it for WhatsApp approval. Then set the Base44 secret `TWILIO_WHATSAPP_TEMPLATE_SID=HX...`.
6. **Secrets (Base44).** Use the `KEY=VALUE` form: `base44 secrets set "TWILIO_WHATSAPP_FROM=whatsapp:+1XXXXXXXXXX"`
   - `TWILIO_WHATSAPP_FROM` is the new sender. Sandbox wording ("join ...") switches off on its own.
   - `TWILIO_WHATSAPP_TEMPLATE_SID` is the template from step 5.
   - `WHATSAPP_SESSION_SECRET` is a long random string (`openssl rand -hex 32`). It keys the 30-minute memory. If it is not set, the auth token is used.
   - `WHATSAPP_WEBHOOK_URL` is the URL from step 4.
7. **Test from a phone that never joined the sandbox:** "hola", then "1", then "Corona", then a location pin, then a voice note, then "MAL <code>", then "BAJA".
8. **Website.** Point the WhatsApp door's link at `https://wa.me/1XXXXXXXXXX?text=Hola` (`WA_LINK` in `web/src/pages/Home.tsx`) and deploy the site.

## Rules we keep (WhatsApp Business policy fits them)

- **We only answer people who write first.** We never send marketing or bulk messages. `send_to_phone` needs explicit consent each time.
- **No immigration status in any message.** `shared/redact.ts` strips it before sending.
- **No phone numbers or message text in logs or storage.** The memory row holds an HMAC, fixed words and a place label, and it expires after 30 minutes.

## Costs

See docs/SUSTAINABILITY.md. Replies inside a conversation the person started are free on Meta's side; Twilio charges about $0.005 per message.
