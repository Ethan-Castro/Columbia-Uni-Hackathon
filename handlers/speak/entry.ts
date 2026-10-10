// POST /functions/speak { text } -> audio/mpeg from ElevenLabs (the voice app's voice).
// Secrets: ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL (optional).
// Without the key it answers 503 and the app falls back to the phone's built-in voice.
import { CORS_HEADERS, errorResponse, HttpError, readJson } from "../../shared/http.ts";
import { getSecret } from "../../shared/secrets.ts";
import { speak } from "../../shared/voice.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST { text }");
    const key = getSecret("ELEVENLABS_API_KEY");
    if (!key) throw new HttpError(503, "ElevenLabs is not configured");
    const body = await readJson<Record<string, unknown>>(req);
    return await speak(
      String(body?.text ?? ""),
      key,
      getSecret("ELEVENLABS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM",
      getSecret("ELEVENLABS_MODEL") || "eleven_flash_v2_5",
    );
  } catch (err) {
    return errorResponse(err);
  }
}
