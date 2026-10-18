// NYC street address -> zip, borough, coordinates, with the City's free GeoSearch
// (NYC Planning Labs, Pelias over PAD; no key). Used when a person approves a
// submission that has an address but no zip, so it can be published with a real
// location instead of being skipped.
//
//   await geocodeNyc("86-07 Broadway, Queens")
//   -> { zip: "11373", borough: "Queens", lat: 40.7385, lng: -73.8768, label: "86-07 B'WAY, Elmhurst, NY, USA" }
//
// Never throws: null when the service is slow (4 s cap), down, or unsure.

import { normalizeBorough } from "./geo.ts";
import type { Borough } from "./geo.ts";

const URL_BASE = "https://geosearch.planninglabs.nyc/v2/search";
const MIN_CONFIDENCE = 0.6;

export interface Geocoded {
  zip: string;
  borough: Borough;
  lat: number;
  lng: number;
  label: string;
}

export async function geocodeNyc(address: string, borough?: string, ms = 4000): Promise<Geocoded | null> {
  const text = [address, borough].filter(Boolean).join(", ").trim();
  if (text.length < 5) return null;
  try {
    const r = await fetch(`${URL_BASE}?size=1&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const f = (await r.json())?.features?.[0];
    const p = f?.properties ?? {};
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    const b = normalizeBorough(p.borough);
    if (!/^\d{5}$/.test(String(p.postalcode ?? "")) || !b || typeof lat !== "number" || Number(p.confidence ?? 0) < MIN_CONFIDENCE) return null;
    // A borough the submission names must agree with the match.
    if (borough && normalizeBorough(borough) && normalizeBorough(borough) !== b) return null;
    return { zip: String(p.postalcode), borough: b, lat, lng, label: String(p.label ?? "") };
  } catch {
    return null;
  }
}
