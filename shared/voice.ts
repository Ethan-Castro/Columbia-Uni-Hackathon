// Voice app ("/voz"): what the person said + where they are -> the one closest
// place that can help, with a phone number to call right away.
//
//   voiceQuery(req, { text: "necesito comida", lat: 40.75, lng: -73.86 })
//   -> { need, place: { name, phone, tel, distance_km, address }, say }
//
// The need comes from the same parser as WhatsApp (one LLM call, keyword
// fallback). Only places with a phone and coordinates count; a place a person
// verified by phone wins if it is within ~1 km of the closest one.
// Privacy: the text and the location are never stored. One anonymous
// RequestLog row (need, nearest zip, language, channel "voice").

import { haversineKm, ZIP_CENTROIDS } from "./geo.ts";
import type { Lang } from "./i18n.ts";
import { logRequest } from "./logRequest.ts";
import { loadCatalog, PLACE_ORG_NEEDS, placeNeeds } from "./rank.ts";
import { understand, withoutStatus } from "./whatsapp.ts";
import { HttpError } from "./http.ts";
import type { Body } from "./web/handler.ts";

const NYC = { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.65 };
const VERIFIED_BONUS_KM = 1;
/** A place whose own type serves the need (a pantry for food) beats one that only offers a program for it. */
const SECONDARY_PENALTY_KM = 1.5;

const SAY: Record<Lang, Record<string, string>> = {
  es: {
    found: "Encontré {name}, {dist}. Toque el botón verde para llamar.",
    found_close: "Encontré {name}, muy cerca de usted. Toque el botón verde para llamar.",
    what: "No le entendí bien. ¿Qué necesita? Por ejemplo: comida, un médico o un abogado.",
    none: "No encontré un lugar con teléfono cerca para eso. Llame al tres uno uno.",
    where: "Necesito saber dónde está. Permita la ubicación, o diga su barrio.",
  },
  en: {
    found: "I found {name}, {dist}. Tap the green button to call.",
    found_close: "I found {name}, very close to you. Tap the green button to call.",
    what: "Sorry, I didn't catch that. What do you need? For example: food, a doctor or a lawyer.",
    none: "I couldn't find a place with a phone nearby for that. Call three one one.",
    where: "I need to know where you are. Allow location, or say your neighborhood.",
  },
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

function telOf(phone: string): string {
  let d = phone.replace(/[^0-9+]/g, "");
  if (/^[0-9]{10}$/.test(d)) d = "+1" + d;
  else if (/^1[0-9]{10}$/.test(d)) d = "+" + d;
  return d.length >= 8 ? "tel:" + d : "";
}

function nearestZip(lat: number, lng: number): string {
  let best = "", bestKm = Infinity;
  for (const [zip, [zlat, zlng]] of Object.entries(ZIP_CENTROIDS)) {
    const km = haversineKm(lat, lng, zlat, zlng);
    if (km < bestKm) { bestKm = km; best = zip; }
  }
  return best;
}

/** Spoken place name: "PLS Check Cashers (38-10 Junction Blvd)" -> "Pls Check Cashers". */
function spokenName(name: string): string {
  const base = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return base === base.toUpperCase() ? base.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : base;
}

export async function voiceQuery(req: Request, body: Body) {
  const text = withoutStatus(String(body.text ?? "").slice(0, 500));
  const lat = Number(body.lat), lng = Number(body.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat > NYC.minLat && lat < NYC.maxLat && lng > NYC.minLng && lng < NYC.maxLng;
  const u = await understand(req, text || "hola");
  // The phone's language wins; otherwise the language the person spoke.
  const lang: Lang = body.language === "en" || body.language === "es" ? body.language : u.language === "en" ? "en" : "es";
  const say = SAY[lang];
  if (!text || !u.needs.length) return { ok: false, reason: "need", say: say.what };
  if (!hasLoc) return { ok: false, reason: "location", say: say.where };

  const need = u.needs[0];
  const cat = await loadCatalog(req);
  const scored = cat.places
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number" && telOf(p.phone ?? "") && placeNeeds(cat, p).has(need))
    .map((p) => {
      const km = haversineKm(lat, lng, p.lat as number, p.lng as number);
      const primary = (PLACE_ORG_NEEDS[p.org_type] ?? []).includes(need);
      return { p, km, score: km - (p.trust === "verified" ? VERIFIED_BONUS_KM : 0) + (primary ? 0 : SECONDARY_PENALTY_KM) };
    })
    .sort((a, b) => a.score - b.score);
  const zip = nearestZip(lat, lng);
  void logRequest(req, { needs: [need], zip, language: lang, channel: "voice", results_found: scored.length ? 1 : 0, unmet: !scored.length });
  if (!scored.length) return { ok: false, reason: "none", need, say: say.none };

  const { p, km } = scored[0];
  const name = spokenName(p.name);
  // How people say it in NYC: minutes on foot when walkable, else miles.
  const minutes = Math.max(2, Math.round((km * 1.25 / 5)* 60)); // street grid ~1.25x straight line, 5 km/h
  const miles = Math.max(1, Math.round(km * 1.25 / 1.609));
  const dist = minutes <= 25
    ? (lang === "es" ? `a unos ${minutes} minutos caminando` : `about a ${minutes} minute walk`)
    : (lang === "es" ? `a unas ${miles} ${miles === 1 ? "milla" : "millas"}` : `about ${miles} ${miles === 1 ? "mile" : "miles"} away`);
  return {
    ok: true,
    need,
    place: {
      id: p.id, name: p.name, phone: p.phone, tel: telOf(p.phone ?? ""), address: p.address ?? "",
      distance_km: Math.round(km * 10) / 10, trust: p.trust, last_checked: p.last_checked ?? "",
    },
    say: fill(km < 0.3 ? say.found_close : say.found, { name, dist }),
  };
}

/** ElevenLabs text-to-speech. 503 when ELEVENLABS_API_KEY is not set (the app then uses the phone's voice). */
export async function speak(text: string, apiKey: string, voiceId: string, modelId: string): Promise<Response> {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) throw new HttpError(400, "text is required");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: clean, model_id: modelId, voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(502, `ElevenLabs error ${res.status}`);
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

/** ElevenLabs speech-to-text (Scribe) for phones without on-device recognition. Audio is never stored. */
export async function transcribe(audioBase64: string, mime: string, apiKey: string, language: string): Promise<string> {
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > 2_000_000) throw new HttpError(400, "audio missing or too long");
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  if (language === "es" || language === "en") form.append("language_code", language === "es" ? "spa" : "eng");
  form.append("file", new Blob([bytes], { type: mime || "audio/mp4" }), "speech" + (mime.includes("webm") ? ".webm" : ".m4a"));
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(502, `ElevenLabs error ${res.status}`);
  const data = await res.json() as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim().slice(0, 500) : "";
}
