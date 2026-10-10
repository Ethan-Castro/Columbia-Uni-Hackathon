// POST /functions/transcribe { audio: base64, mime, language? } -> { text } via ElevenLabs Scribe.
// For the voice app on phones without on-device speech recognition. Audio and text are never stored.
// 503 when ELEVENLABS_API_KEY is not set.
import { HttpError } from "../../shared/http.ts";
import { getSecret } from "../../shared/secrets.ts";
import { transcribe } from "../../shared/voice.ts";
import { webFunction } from "../../shared/web/handler.ts";

export default webFunction(async (_req, body) => {
  const key = getSecret("ELEVENLABS_API_KEY");
  if (!key) throw new HttpError(503, "ElevenLabs is not configured");
  const text = await transcribe(String(body.audio ?? ""), String(body.mime ?? ""), key, String(body.language ?? ""));
  return { text };
});
