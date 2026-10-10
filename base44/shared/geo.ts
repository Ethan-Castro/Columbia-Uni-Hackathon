import { HttpError } from "./http.ts";
// Where is "near"? Turns a zip, borough, or neighborhood into zips to search.
//
//   resolveNear("11368")          -> { zip: "11368", borough: "Queens", neighborhood: "Corona", zips: [11368, 11373, ...] }
//   resolveNear("Corona, Queens") -> same
//   resolveNear("El Bronx")       -> { borough: "Bronx", zips: [] }
//
// Ranking idea (see nearRank): same zip > adjacent zips > same borough > rest.
// Zip lists are approximate and only meant for ranking, not for mail.

import { normalize } from "./text.ts";

export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] as const;
export type Borough = typeof BOROUGHS[number];

/** Normalized spellings (English, Spanish, common variants) -> borough. */
const BOROUGH_ALIASES: Record<string, Borough> = {
  "manhattan": "Manhattan", "manhatan": "Manhattan", "new york county": "Manhattan", "nueva york manhattan": "Manhattan",
  "brooklyn": "Brooklyn", "brooklin": "Brooklyn", "bklyn": "Brooklyn", "bk": "Brooklyn", "kings": "Brooklyn",
  "kings county": "Brooklyn",
  "queens": "Queens", "quins": "Queens", "queens county": "Queens",
  "bronx": "Bronx", "the bronx": "Bronx", "el bronx": "Bronx", "bronx county": "Bronx", "brox": "Bronx",
  "staten island": "Staten Island", "staten": "Staten Island", "isla de staten": "Staten Island",
  "isla staten": "Staten Island", "richmond county": "Staten Island", "si": "Staten Island",
};

/** Words that mean "all of NYC". */
const CITYWIDE = ["nyc", "new york city", "new york", "nueva york", "ciudad de nueva york", "ny"];

/** Neighborhood (display name) -> its zips, first is the main one. */
export const NEIGHBORHOOD_ZIPS: Record<string, string[]> = {
  // Queens (demo area first)
  "Corona": ["11368"],
  "North Corona": ["11368", "11369"],
  "Elmhurst": ["11373"],
  "Jackson Heights": ["11372"],
  "East Elmhurst": ["11369", "11370"],
  "Woodside": ["11377"],
  "Flushing": ["11354", "11355", "11358"],
  "Jamaica": ["11432", "11433", "11434", "11435", "11436"],
  "Astoria": ["11102", "11103", "11105", "11106"],
  "Long Island City": ["11101", "11109"],
  "Sunnyside": ["11104"],
  "Ridgewood": ["11385"],
  "Maspeth": ["11378"],
  "Middle Village": ["11379"],
  "Rego Park": ["11374"],
  "Forest Hills": ["11375"],
  "Kew Gardens": ["11415"],
  "Richmond Hill": ["11418", "11419"],
  "Woodhaven": ["11421"],
  "Ozone Park": ["11416", "11417"],
  "Far Rockaway": ["11691"],
  "Kew Gardens Hills": ["11367"],
  // Brooklyn
  "Bushwick": ["11221", "11237"],
  "Sunset Park": ["11220", "11232"],
  "Williamsburg": ["11211", "11206", "11249"],
  "Bay Ridge": ["11209"],
  "Bensonhurst": ["11214"],
  "Brighton Beach": ["11235"],
  "Crown Heights": ["11213", "11225", "11216"],
  "Flatbush": ["11226"],
  "East New York": ["11207", "11208"],
  "Borough Park": ["11219"],
  "Red Hook": ["11231"],
  // Manhattan
  "Washington Heights": ["10032", "10033", "10040"],
  "Inwood": ["10034"],
  "Harlem": ["10027", "10026", "10030", "10037", "10039"],
  "East Harlem": ["10029", "10035"],
  "Lower East Side": ["10002"],
  "Chinatown": ["10013"],
  "Hamilton Heights": ["10031"],
  // Bronx
  "Mott Haven": ["10454", "10451"],
  "Kingsbridge": ["10463", "10468"],
  "Highbridge": ["10452"],
  "Fordham": ["10458"],
  "Hunts Point": ["10474"],
  "Soundview": ["10472", "10473"],
  "Concourse": ["10451", "10456"],
  "Morris Heights": ["10453"],
  "Tremont": ["10457"],
  "Parkchester": ["10462"],
  // Staten Island
  "Port Richmond": ["10302"],
  "St. George": ["10301"],
  "Stapleton": ["10304"],
  "Mariners Harbor": ["10303"],
};

/** Extra spellings -> neighborhood display name. Matched after normalize(). */
const NEIGHBORHOOD_ALIASES: Record<string, string> = {
  "jackson hts": "Jackson Heights",
  "lic": "Long Island City",
  "el barrio": "East Harlem",
  "spanish harlem": "East Harlem",
  "harlem hispano": "East Harlem",
  "alto manhattan": "Washington Heights",
  "the heights": "Washington Heights",
  "wash heights": "Washington Heights",
  "saint george": "St. George",
  "st george": "St. George",
  "boro park": "Borough Park",
  "sunset": "Sunset Park",
};

/**
 * Adjacent zips for the demo area (Corona/Elmhurst/Jackson Heights and
 * neighbors). Symmetric enough for ranking; other zips widen by distance
 * (ZIP_CENTROIDS) or by borough.
 */
export const NEAR_ZIPS: Record<string, string[]> = {
  "11368": ["11373", "11372", "11369", "11355", "11377", "11367", "11374", "11370"],
  "11373": ["11368", "11372", "11377", "11374", "11378", "11379"],
  "11372": ["11368", "11373", "11369", "11370", "11377"],
  "11369": ["11368", "11370", "11372", "11371"],
  "11370": ["11369", "11372", "11105", "11368"],
  "11377": ["11372", "11373", "11104", "11378", "11101", "11368"],
  "11355": ["11368", "11354", "11358", "11367", "11365"],
  "11354": ["11355", "11368", "11358", "11356"],
  "11367": ["11368", "11355", "11365", "11374", "11375"],
  "11374": ["11373", "11375", "11368", "11379", "11367"],
  "11375": ["11374", "11367", "11415", "11379"],
  "11378": ["11373", "11377", "11379", "11385"],
  "11379": ["11373", "11374", "11378", "11385"],
  "11385": ["11378", "11379", "11237", "11221"],
  "11104": ["11377", "11101", "11106"],
  "11101": ["11104", "11106", "11377", "11109"],
};

/** Approximate zip centroids [lat, lng] for the demo area. */
export const ZIP_CENTROIDS: Record<string, [number, number]> = {
  "11368": [40.7498, -73.8624],
  "11373": [40.7389, -73.8786],
  "11372": [40.7516, -73.8836],
  "11369": [40.7633, -73.8728],
  "11370": [40.7651, -73.8913],
  "11371": [40.7731, -73.8730],
  "11377": [40.7451, -73.9054],
  "11355": [40.7515, -73.8209],
  "11354": [40.7684, -73.8274],
  "11358": [40.7606, -73.7966],
  "11367": [40.7303, -73.8274],
  "11365": [40.7394, -73.7944],
  "11374": [40.7262, -73.8617],
  "11375": [40.7210, -73.8460],
  "11378": [40.7245, -73.9097],
  "11379": [40.7166, -73.8800],
  "11385": [40.7034, -73.8962],
  "11104": [40.7447, -73.9200],
  "11101": [40.7475, -73.9394],
  "11105": [40.7790, -73.9065],
  "11106": [40.7622, -73.9310],
  "11103": [40.7626, -73.9133],
  "11102": [40.7709, -73.9262],
  "11415": [40.7079, -73.8288],
};

/** Borough from a NYC zip by prefix (100-102 Manhattan, 103 SI, 104 Bronx, 112 Brooklyn, 110/111/113/114/116 Queens). */
export function zipToBorough(zip: string | undefined | null): Borough | undefined {
  if (!zip || !/^\d{5}$/.test(zip)) return undefined;
  const p = zip.slice(0, 3);
  if (p === "100" || p === "101" || p === "102") return "Manhattan";
  if (p === "103") return "Staten Island";
  if (p === "104") return "Bronx";
  if (p === "112") return "Brooklyn";
  if (["110", "111", "113", "114", "116"].includes(p)) return "Queens";
  return undefined;
}

/** "el bronx", "BROOKLYN", "Brooklin" -> canonical borough, else undefined. */
export function normalizeBorough(s: unknown): Borough | undefined {
  const n = normalize(s, { dropSuffixes: false });
  if (!n) return undefined;
  if (BOROUGH_ALIASES[n]) return BOROUGH_ALIASES[n];
  // longest alias contained as whole words ("bronx ny", "queens nueva york")
  for (const alias of Object.keys(BOROUGH_ALIASES).sort((a, b) => b.length - a.length)) {
    if (alias.length > 2 && ` ${n} `.includes(` ${alias} `)) return BOROUGH_ALIASES[alias];
  }
  return undefined;
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Zips adjacent to `zip`: NEAR_ZIPS plus any centroid within `km`. Excludes zip itself. */
export function adjacentZips(zip: string, km = 2.5): string[] {
  const out = new Set(NEAR_ZIPS[zip] ?? []);
  const c = ZIP_CENTROIDS[zip];
  if (c) {
    for (const [z, [lat, lng]] of Object.entries(ZIP_CENTROIDS)) {
      if (z !== zip && haversineKm(c[0], c[1], lat, lng) <= km) out.add(z);
    }
  }
  out.delete(zip);
  return [...out];
}

export interface NearResult {
  /** What was asked, trimmed. */
  input: string;
  /** True when we recognized a zip, neighborhood, borough, or "NYC". */
  matched: boolean;
  /** Main 5-digit zip (given, or the neighborhood's main zip). Safe to log. */
  zip?: string;
  borough?: Borough;
  /** Display name, e.g. "Jackson Heights". */
  neighborhood?: string;
  /** Zips that count as the same place (the zip, or all of the neighborhood's zips). */
  primaryZips: string[];
  /** All zips considered "near": primaryZips first, then adjacent ones. Empty for borough/citywide. */
  zips: string[];
  /** Human label: "Corona, Queens (11368)", "Bronx", "NYC". */
  label: string;
  /** Approximate center when known (demo-area zips). */
  lat?: number;
  lng?: number;
}

function sortedNeighborhoodKeys(): Array<[string, string]> {
  const pairs: Array<[string, string]> = Object.keys(NEIGHBORHOOD_ZIPS).map((name) => [normalize(name, { dropSuffixes: false }), name]);
  for (const [alias, name] of Object.entries(NEIGHBORHOOD_ALIASES)) pairs.push([alias, name]);
  return pairs.sort((a, b) => b[0].length - a[0].length); // "east elmhurst" before "elmhurst"
}
const NEIGHBORHOOD_KEYS = sortedNeighborhoodKeys();

/** Neighborhood display name for a zip (first neighborhood listing it as main zip, else any). */
export function zipToNeighborhood(zip: string): string | undefined {
  let any: string | undefined;
  for (const [name, zips] of Object.entries(NEIGHBORHOOD_ZIPS)) {
    if (zips[0] === zip) return name;
    if (!any && zips.includes(zip)) any = name;
  }
  return any;
}

/**
 * Resolve a free-form location: a 5-digit zip, a borough (English/Spanish),
 * a neighborhood, or combinations like "Corona, Queens" or "11368 Corona".
 * Case- and accent-insensitive. Never throws; check `matched`.
 */
export function resolveNear(near: unknown): NearResult {
  const input = typeof near === "string" ? near.trim().slice(0, 200) : "";
  const n = normalize(input, { dropSuffixes: false });
  const padded = ` ${n} `;

  const zipMatch = input.match(/\b(\d{5})(?:-\d{4})?\b/);
  let neighborhood: string | undefined;
  for (const [key, name] of NEIGHBORHOOD_KEYS) {
    if (padded.includes(` ${key} `)) {
      neighborhood = name;
      break;
    }
  }
  const boroughWord = normalizeBorough(n);

  const finish = (primaryZips: string[], borough: Borough | undefined, hood: string | undefined): NearResult => {
    const zip = primaryZips[0];
    const zips = [...primaryZips];
    for (const z of primaryZips) for (const a of adjacentZips(z)) if (!zips.includes(a)) zips.push(a);
    const c = zip ? ZIP_CENTROIDS[zip] : undefined;
    const place = [hood, borough].filter(Boolean).join(", ");
    const label = zip ? (place ? `${place} (${zip})` : zip) : place || input;
    return {
      input,
      matched: true,
      zip,
      borough,
      neighborhood: hood,
      primaryZips,
      zips,
      label,
      ...(c ? { lat: c[0], lng: c[1] } : {}),
    };
  };

  if (zipMatch) {
    const zip = zipMatch[1];
    return finish([zip], zipToBorough(zip) ?? boroughWord, neighborhood ?? zipToNeighborhood(zip));
  }
  if (neighborhood) {
    const zips = NEIGHBORHOOD_ZIPS[neighborhood];
    return finish(zips, zipToBorough(zips[0]) ?? boroughWord, neighborhood);
  }
  if (boroughWord) {
    return { input, matched: true, borough: boroughWord, primaryZips: [], zips: [], label: boroughWord };
  }
  if (CITYWIDE.includes(n)) {
    return { input, matched: true, primaryZips: [], zips: [], label: "NYC" };
  }
  return { input, matched: false, primaryZips: [], zips: [], label: input };
}

/**
 * How close a place is to the resolved location, for sorting (lower is closer):
 *   0 same zip (or one of the neighborhood's zips), 1 adjacent zip,
 *   2 same borough, 3 everywhere else (or unknown location).
 */
export function nearRank(place: { zip?: string; borough?: string }, near: NearResult): 0 | 1 | 2 | 3 {
  const zip = (place.zip ?? "").trim();
  if (zip && near.primaryZips.includes(zip)) return 0;
  if (zip && near.zips.includes(zip)) return 1;
  const borough = normalizeBorough(place.borough) ?? zipToBorough(zip);
  if (near.borough && borough === near.borough) return 2;
  return 3;
}

/** Distance in km from the resolved location to a place, when both have coordinates. */
export function distanceKm(place: { lat?: number; lng?: number }, near: NearResult): number | undefined {
  if (near.lat === undefined || near.lng === undefined) return undefined;
  if (typeof place.lat !== "number" || typeof place.lng !== "number") return undefined;
  return Math.round(haversineKm(near.lat, near.lng, place.lat, place.lng) * 10) / 10;
}

/**
 * Plans and nearby searches need a real place: a zip, neighborhood or borough.
 * "NYC" or an unknown word would rank places from all five boroughs, so instead
 * the tool fails with a message that tells the assistant to ask the person.
 */
export function requireSpecificNear(near: NearResult): void {
  if (near.zip || near.borough || near.neighborhood) return;
  const what = near.input ? `"${near.input}" is too broad or not a place we know.` : "No location was given.";
  throw new HttpError(
    400,
    `${what} Ask the person for their zip code, neighborhood or borough (for example 10032, Bushwick, the Bronx) ` +
      `and call again. Do not guess a location. / Pregunte su código postal, barrio o condado.`,
  );
}
