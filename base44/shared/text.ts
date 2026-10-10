// Text helpers: normalization and fuzzy name matching (no deps).
//
//   normalize("The Catholic Charities, Inc.")  -> "catholic charities"
//   similarity("Catholic Charities", "Catholic Charities Community Services") ~ 0.8
//   similarity("Jose Perez Notario", "Queens Immigrant Legal Clinic")       ~ 0.1
//
// similarity = 0.65 * token-set ratio + 0.35 * character-trigram Jaccard.
// The token part is forgiving when one name is a subset of the other and
// ignores generic words; the trigram part rewards real character overlap.

/** Words dropped by normalize(): legal suffixes, articles, and our "(sample)" tag. */
const DROP_WORDS = new Set([
  "the", "inc", "incorporated", "llc", "llp", "pllc", "pc", "corp", "corporation", "co", "ltd", "esq",
  "el", "la", "los", "las", "sample",
]);

/**
 * Generic words that should not make two names "match" on their own
 * ("Legal Services" vs "Family Services"). They weigh 1/4 in tokenSetRatio.
 */
const GENERIC_WORDS = new Set([
  "of", "and", "for", "de", "del", "y", "en", "nyc", "new", "york", "ny", "queens", "brooklyn", "bronx",
  "manhattan", "center", "centro", "services", "service", "servicios", "community", "comunidad", "legal",
  "law", "office", "oficina", "group", "project", "proyecto", "program", "programa", "inc", "help", "ayuda",
  "immigrant", "immigrants", "immigration", "inmigrante", "inmigrantes", "inmigracion", "family", "familia",
  "clinic", "clinica", "association", "asociacion", "society", "organization",
]);

/** Remove diacritics: "Clínica Médica" -> "Clinica Medica". */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Lowercase, strip accents and punctuation, collapse spaces, and (by default)
 * drop org suffixes and articles (inc, llc, corp, the, el, la, ...).
 */
export function normalize(s: unknown, opts: { dropSuffixes?: boolean } = {}): string {
  if (typeof s !== "string") return "";
  const words = stripAccents(s.toLowerCase())
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "") // "St. Mary's" -> "st marys"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const keep = opts.dropSuffixes === false ? words : words.filter((w) => !DROP_WORDS.has(w));
  return keep.join(" ");
}

/** Normalized words, de-duplicated, in order. */
export function tokens(s: unknown): string[] {
  return [...new Set(normalize(s).split(" ").filter(Boolean))];
}

/** Levenshtein-based ratio in 0..1 ((lenA+lenB-dist)/(lenA+lenB)), like fuzzywuzzy's ratio. */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  const total = a.length + b.length;
  return (total - prev[b.length]) / total;
}

/**
 * Token-set ratio: weighted overlap of the two word sets, forgiving word order,
 * typos (words match when ratio >= 0.8) and extra words on one side.
 * Generic words ("services", "legal", "center") weigh 1/4, so two names never
 * match on generic words alone. 0.7 * coverage of the shorter name +
 * 0.3 * coverage of the longer one.
 */
export function tokenSetRatio(a: unknown, b: unknown): number {
  let ta = tokens(a);
  let tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const weight = (w: string) => (GENERIC_WORDS.has(w) ? 0.25 : 1);
  const total = (ws: string[]) => ws.reduce((s, w) => s + weight(w), 0);
  if (total(ta) > total(tb)) [ta, tb] = [tb, ta]; // ta = shorter name
  const unused = new Set(tb);
  let matched = 0;
  for (const w of ta) {
    let best = "";
    let bestScore = 0;
    for (const u of unused) {
      const r = u === w ? 1 : ratio(w, u);
      if (r > bestScore) [best, bestScore] = [u, r];
    }
    if (bestScore >= 0.8) {
      unused.delete(best);
      matched += bestScore * Math.min(weight(w), weight(best));
    }
  }
  return 0.7 * (matched / total(ta)) + 0.3 * (matched / total(tb));
}

/** Character trigrams of the normalized string (padded so short words count). */
export function trigrams(s: unknown): Set<string> {
  const out = new Set<string>();
  for (const word of tokens(s)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Jaccard overlap of character trigrams, 0..1. */
export function trigramJaccard(a: unknown, b: unknown): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Fuzzy similarity of two names, 0..1. About 0.6+ is a likely match. */
export function similarity(a: unknown, b: unknown): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const score = 0.65 * tokenSetRatio(na, nb) + 0.35 * trigramJaccard(na, nb);
  return Math.round(score * 1000) / 1000;
}

/** Suggested threshold for "this is probably the same organization". */
export const MATCH_THRESHOLD = 0.6;

/**
 * Best fuzzy match of `query` among `items`. `keys` returns the strings to
 * compare for an item (name, org, ...); the best key wins. Returns null when
 * nothing reaches `threshold`.
 */
export function bestMatch<T>(
  query: string,
  items: readonly T[],
  keys: (item: T) => Array<string | undefined | null>,
  threshold = MATCH_THRESHOLD,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    for (const k of keys(item)) {
      if (!k) continue;
      const score = similarity(query, k);
      if (!best || score > best.score) best = { item, score };
    }
  }
  return best && best.score >= threshold ? best : null;
}
