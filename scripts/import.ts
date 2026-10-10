// Validates Felix's programs.csv, places.csv and links.csv against the shared
// CSV contract and loads them into data/Program.json, Place.json, Link.json.
//
//   deno task import                 # CSVs from data/ (or $DATA_DIR) into data/ (or $DATA_DIR)
//   deno task import path/to/csvs    # CSVs from another folder
//   deno task import --dry-run       # validate and report only, write nothing but the report
//   flags: --keep-sample  keep the fictional sample records (source_url https://example.org/sample/...)
//          --replace      the CSV is the whole truth: drop existing records that are not in it
//          --report=PATH  where to write the JSON report (default <data dir>/import-report.json)
//
// Bad rows are reported (file, line, id, every reason) and skipped; the import
// never crashes on bad data. Exit code 1 only when a file is unreadable, its
// header is unusable, or no CSV was found. See scripts/README.md "Data handoff".
//
// Writes use the same <Entity>.json.lock protocol and atomic rename as
// shared/db.ts, so this can run while the dev server is up. Records keep the
// shape db.ts produces: CSV fields + id + created_date + updated_date.
// Local-only script: it is not copied to Base44 (see README "Porting").

import { parseCsv } from "./csv.ts";
import {
  DATE_PATTERN,
  ID_PATTERNS,
  LINK_COLUMNS,
  LINK_TYPES,
  NEEDS,
  ORG_TYPES,
  PLACE_COLUMNS,
  PROGRAM_COLUMNS,
  TRUST,
} from "../shared/schema.ts";
import { BOROUGHS, normalizeBorough, zipToBorough } from "../shared/geo.ts";
import { opensEvenings, opensWeekends } from "../shared/hours.ts";
import { normalize, ratio } from "../shared/text.ts";
import { parseNeed } from "../shared/tools/input.ts";

// ---------- types ----------

export type FileKind = "programs" | "places" | "links";
type Row = Record<string, unknown>;

export interface Issue {
  file: string; // programs.csv
  line: number; // 1-based physical line (0 = whole file / header)
  id?: string;
  level: "error" | "warning";
  field?: string;
  code: string; // short, groupable: bad_enum, missing, bad_date, ...
  message: string;
}

export interface FileReport {
  file: string;
  present: boolean;
  fatal?: string; // unreadable or unusable header: nothing from this file was used
  header: { missing: string[]; extra: string[] };
  rows_read: number;
  valid: number;
  new: number;
  updated: number;
  unchanged: number;
  skipped: number; // bad rows + rows superseded by a later duplicate
  removed: number; // existing records dropped (sample, --replace, dangling links)
  errors: number;
  warnings: number;
}

export interface ImportOptions {
  srcDir: string; // where the CSVs are
  outDir: string; // where Program.json / Place.json / Link.json live
  dryRun?: boolean;
  keepSample?: boolean;
  replace?: boolean;
  reportPath?: string | null; // null = do not write a report
  now?: Date;
}

export interface ImportReport {
  generated_at: string;
  src_dir: string;
  out_dir: string;
  dry_run: boolean;
  keep_sample: boolean;
  replace: boolean;
  exit_code: 0 | 1;
  files: Record<FileKind, FileReport>;
  totals: { Program: number; Place: number; Link: number };
  removed: { entity: string; id: string; reason: string }[];
  top_reasons: { reason: string; count: number }[];
  issues: Issue[];
  notes: string[];
}

// ---------- constants ----------

export const SAMPLE_URL_PREFIX = "https://example.org/sample/";
const FILE_NAMES: Record<FileKind, string> = { programs: "programs.csv", places: "places.csv", links: "links.csv" };
const ENTITY: Record<FileKind, "Program" | "Place" | "Link"> = { programs: "Program", places: "Place", links: "Link" };
const COLUMNS: Record<FileKind, readonly string[]> = {
  programs: PROGRAM_COLUMNS,
  places: PLACE_COLUMNS,
  links: LINK_COLUMNS,
};
/** Without these columns a file cannot be used at all. */
const KEY_COLUMNS: Record<FileKind, string[]> = {
  programs: ["id"],
  places: ["id"],
  links: ["from_id", "to_id", "type"],
};

/** Rough NYC bounding box (all five boroughs plus a margin). */
const NYC_BOUNDS = { latMin: 40.45, latMax: 40.95, lngMin: -74.30, lngMax: -73.65 };

/** Language names people type instead of codes -> ISO 639 code. */
const LANGUAGE_NAMES: Record<string, string> = {
  spanish: "es", espanol: "es", castellano: "es", english: "en", ingles: "en",
  chinese: "zh", mandarin: "zh", chino: "zh", cantonese: "yue", french: "fr", frances: "fr",
  "haitian creole": "ht", kreyol: "ht", creole: "ht", quechua: "qu", kiche: "quc", "k iche": "quc",
  bengali: "bn", bangla: "bn", arabic: "ar", russian: "ru", korean: "ko", portuguese: "pt", portugues: "pt",
  mixteco: "mix", mixtec: "mix", nahuatl: "nah", garifuna: "cab", polish: "pl", urdu: "ur", hindi: "hi",
  tagalog: "tl", nepali: "ne", tibetan: "bo", wolof: "wo", fulani: "ff", italian: "it", japanese: "ja",
};

const BOOL_LOOSE: Record<string, boolean> = {
  true: true, false: false, yes: true, no: false, y: true, n: false, "1": true, "0": false,
  si: true, "sí": true, t: true, f: false,
};

// ---------- small helpers ----------

/** Suggest the closest enum value for a typo ("panty" -> "pantry"). */
function suggest(value: string, allowed: readonly string[]): string {
  let best = "", score = 0;
  for (const a of allowed) {
    const r = ratio(value, a);
    if (r > score) [best, score] = [a, r];
  }
  return score >= 0.7 ? ` (did you mean "${best}"?)` : "";
}

/** "Pairs With", "DOJ-roster" -> "pairs_with", "doj_roster". */
function enumKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isRealDate(s: string): boolean {
  if (!DATE_PATTERN.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Name + address key for duplicate detection ("104-10 Roosevelt Avenue" == "104-10 roosevelt ave"). */
function placeKey(name: unknown, address: unknown): string {
  const abbrev: Record<string, string> = {
    avenue: "ave", av: "ave", street: "st", boulevard: "blvd", road: "rd", place: "pl", drive: "dr",
    parkway: "pkwy", floor: "fl", suite: "ste", north: "n", south: "s", east: "e", west: "w",
  };
  const addr = normalize(address, { dropSuffixes: false }).split(" ").map((w) => abbrev[w] ?? w).join(" ");
  return `${normalize(name)}|${addr}`;
}

const CONTRACT_FIELDS: Record<FileKind, readonly string[]> = COLUMNS;

function sameContent(kind: FileKind, a: Row, b: Row): boolean {
  return CONTRACT_FIELDS[kind].every((f) => f === "id" || JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

export function isSample(row: Row): boolean {
  return typeof row.source_url === "string" && row.source_url.startsWith(SAMPLE_URL_PREFIX);
}

// ---------- row validation ----------

/** Collects errors/warnings for one row and parses typed values. */
class RowCheck {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  id?: string;
  constructor(
    private file: string,
    private line: number,
    private values: Record<string, string>,
    private today: string,
  ) {}

  private push(level: "error" | "warning", field: string | undefined, code: string, message: string) {
    (level === "error" ? this.errors : this.warnings).push({
      file: this.file, line: this.line, id: this.id, level, field, code, message,
    });
  }
  error(field: string | undefined, code: string, message: string) {
    this.push("error", field, code, message);
  }
  warn(field: string | undefined, code: string, message: string) {
    this.push("warning", field, code, message);
  }

  raw(col: string): string {
    return (this.values[col] ?? "").trim();
  }

  str(col: string, required = false): string {
    const v = this.raw(col);
    if (!v && required) this.error(col, "missing", `${col} is required`);
    return v;
  }

  idField(col: string, kind: "program" | "place"): string {
    const v = this.raw(col);
    const prefix = kind === "program" ? "prog" : "place";
    if (!v) {
      this.error(col, "missing", `${col} is required`);
      return "";
    }
    if (ID_PATTERNS[kind].test(v)) return v;
    const lower = v.toLowerCase();
    if (ID_PATTERNS[kind].test(lower)) {
      this.warn(col, "id_case", `${col} "${v}" lowercased to "${lower}"`);
      return lower;
    }
    this.error(col, "bad_id", `${col} "${v}" must look like ${prefix}-<slug> (lowercase letters, digits and single hyphens)`);
    return "";
  }

  list(col: string): string[] {
    const items = this.raw(col).split("|").map((s) => s.trim()).filter(Boolean);
    return [...new Set(items)];
  }

  /** Blank -> `fallback` with a warning when given (the entity default), else an error. */
  enumOne<T extends string>(col: string, allowed: readonly T[], fallback?: T): T | "" {
    const v = this.raw(col);
    if (!v) {
      if (fallback) {
        this.warn(col, "blank_default", `${col} is blank; set to ${fallback}`);
        return fallback;
      }
      this.error(col, "missing", `${col} is required (one of ${allowed.join(", ")})`);
      return "";
    }
    const k = enumKey(v) as T;
    if (allowed.includes(k)) return k;
    this.error(col, "bad_enum", `${col} "${v}" is not one of ${allowed.join(", ")}${suggest(k, allowed)}`);
    return "";
  }

  /** `hint` may map a synonym to a valid value, only to suggest it ("comida" -> food). */
  enumList<T extends string>(col: string, allowed: readonly T[], required = true, hint?: (s: string) => string | undefined): T[] {
    const items = this.list(col);
    if (!items.length) {
      if (required) this.error(col, "missing", `${col} is required (pipe-separated: ${allowed.join("|")})`);
      return [];
    }
    const out: T[] = [];
    for (const item of items) {
      const k = enumKey(item) as T;
      if (allowed.includes(k)) {
        if (!out.includes(k)) out.push(k);
      } else {
        const h = hint?.(item);
        const tip = h ? ` (did you mean "${h}"?)` : suggest(k, allowed);
        this.error(col, "bad_enum", `${col} item "${item}" is not one of ${allowed.join(", ")}${tip}`);
      }
    }
    return out;
  }

  /** true/false; loose spellings are accepted with a warning; blank -> derived. */
  bool(col: string, derive: () => boolean | null): boolean {
    const v = this.raw(col);
    if (v === "true") return true;
    if (v === "false") return false;
    if (!v) {
      const d = derive();
      this.warn(col, "blank_boolean", `${col} is blank; set to ${d === true} ${d === null ? "(hours unclear)" : "from hours"}`);
      return d === true;
    }
    const loose = BOOL_LOOSE[v.toLowerCase()];
    if (loose !== undefined) {
      this.warn(col, "loose_boolean", `${col} "${v}" read as ${loose}; please write true or false`);
      return loose;
    }
    this.error(col, "bad_boolean", `${col} "${v}" must be true or false`);
    return false;
  }

  date(col: string): string {
    const v = this.raw(col);
    if (!v) {
      this.error(col, "missing", `${col} is required (YYYY-MM-DD)`);
      return "";
    }
    let d = v;
    if (!DATE_PATTERN.test(v)) {
      const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // Excel/Sheets M/D/YYYY
      const iso = v.match(/^(\d{4}-\d{2}-\d{2})[T ]/); // datetime
      if (us) d = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      else if (iso) d = iso[1];
      else {
        this.error(col, "bad_date", `${col} "${v}" must be YYYY-MM-DD`);
        return "";
      }
      if (isRealDate(d)) this.warn(col, "date_format", `${col} "${v}" read as ${d}; please write YYYY-MM-DD`);
    }
    if (!isRealDate(d)) {
      this.error(col, "bad_date", `${col} "${v}" is not a real date`);
      return "";
    }
    if (d > this.today) this.warn(col, "future_date", `${col} ${d} is in the future`);
    else if (d < String(Number(this.today.slice(0, 4)) - 2) + this.today.slice(4)) {
      this.warn(col, "stale_date", `${col} ${d} is more than 2 years old`);
    }
    return d;
  }

  url(col: string): string {
    const v = this.raw(col);
    if (!v) {
      this.error(col, "missing", `${col} is required (http or https URL)`);
      return "";
    }
    try {
      const u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      if (/\s/.test(v)) throw new Error();
    } catch {
      this.error(col, "bad_url", `${col} "${v}" must be an http(s) URL`);
      return "";
    }
    if (v.startsWith(SAMPLE_URL_PREFIX)) {
      this.warn(col, "sample_url", `${col} is a sample URL; this record will be treated as sample data`);
    }
    return v;
  }

  zip(col: string): string {
    const v = this.raw(col);
    if (!v) {
      this.error(col, "missing", `${col} is required (5 digits)`);
      return "";
    }
    if (/^\d{5}$/.test(v)) return v;
    const plus4 = v.match(/^(\d{5})-\d{4}$/);
    if (plus4) {
      this.warn(col, "zip_plus4", `${col} "${v}" shortened to ${plus4[1]}`);
      return plus4[1];
    }
    this.error(col, "bad_zip", `${col} "${v}" must be 5 digits`);
    return "";
  }

  /** lat/lng in NYC; blank -> null (warning); swapped pair is fixed (warning). */
  coords(): { lat: number | null; lng: number | null } {
    const a = this.raw("lat"), b = this.raw("lng");
    if (!a || !b) {
      this.warn(a || b ? (a ? "lng" : "lat") : "lat", "blank_coords", "lat/lng blank; stored as null (distance sorting will skip this place)");
      return { lat: null, lng: null };
    }
    let lat = Number(a), lng = Number(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (!Number.isFinite(lat)) this.error("lat", "bad_number", `lat "${a}" is not a number`);
      if (!Number.isFinite(lng)) this.error("lng", "bad_number", `lng "${b}" is not a number`);
      return { lat: null, lng: null };
    }
    const inNyc = (la: number, ln: number) =>
      la >= NYC_BOUNDS.latMin && la <= NYC_BOUNDS.latMax && ln >= NYC_BOUNDS.lngMin && ln <= NYC_BOUNDS.lngMax;
    if (!inNyc(lat, lng) && inNyc(lng, lat)) {
      this.warn("lat", "swapped_coords", `lat/lng look swapped (${a}, ${b}); swapped back`);
      [lat, lng] = [lng, lat];
    }
    if (!inNyc(lat, lng)) {
      this.error("lat", "out_of_nyc", `lat/lng (${a}, ${b}) is outside New York City`);
      return { lat: null, lng: null };
    }
    return { lat, lng };
  }

  borough(zip: string): string {
    const v = this.raw("borough");
    const fromZip = zipToBorough(zip);
    if (!v) {
      if (fromZip) {
        this.warn("borough", "borough_from_zip", `borough blank; set to ${fromZip} from zip ${zip}`);
        return fromZip;
      }
      this.error("borough", "missing", `borough is required (${BOROUGHS.join(", ")})`);
      return "";
    }
    const b = normalizeBorough(v);
    if (!b) {
      if (fromZip) {
        this.warn("borough", "borough_from_zip", `borough "${v}" not recognized; set to ${fromZip} from zip ${zip}`);
        return fromZip;
      }
      this.error("borough", "bad_borough", `borough "${v}" must be one of ${BOROUGHS.join(", ")}`);
      return "";
    }
    if (fromZip && fromZip !== b) {
      this.warn("borough", "borough_zip_mismatch", `borough ${b} does not match zip ${zip} (${fromZip}); kept ${b}`);
    }
    return b;
  }

  languages(): string[] {
    const out: string[] = [];
    for (const item of this.list("languages")) {
      let code = "";
      const m = item.match(/^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z0-9]{2,8}))?$/);
      const name = LANGUAGE_NAMES[normalize(item, { dropSuffixes: false })];
      if (name) {
        code = name;
        this.warn("languages", "language_name", `language "${item}" read as code "${code}"`);
      } else if (m) {
        code = m[1].toLowerCase() + (m[2] ? `-${m[2].toUpperCase()}` : "");
      } else {
        this.warn("languages", "bad_language", `language "${item}" is not a code like es, en, zh, quc; dropped`);
        continue;
      }
      if (!out.includes(code)) out.push(code);
    }
    if (!out.length) this.warn("languages", "no_languages", "languages is blank");
    return out;
  }
}

// ---------- per-file validators ----------

type Validator = (c: RowCheck) => Row;

function validateProgram(c: RowCheck): Row {
  c.id = c.raw("id") || undefined;
  c.id = c.idField("id", "program") || c.id;
  const r: Row = {
    id: c.id ?? "",
    name: c.str("name", true),
    needs: c.enumList("needs", NEEDS, true, parseNeed),
    who_can_use: c.str("who_can_use"),
    status_note: c.str("status_note"),
    bring: c.list("bring"),
    how_to_apply: c.str("how_to_apply"),
    summary_es: c.str("summary_es"),
    summary_en: c.str("summary_en"),
    source_url: c.url("source_url"),
    last_checked: c.date("last_checked"),
  };
  if (!r.summary_es && !r.summary_en) c.warn("summary_es", "no_summary", "summary_es and summary_en are both blank");
  else if (!r.summary_es) c.warn("summary_es", "no_summary", "summary_es is blank (Spanish is the default language)");
  if (!r.who_can_use) c.warn("who_can_use", "blank", "who_can_use is blank (results should say who a service is open to)");
  return r;
}

function validatePlace(c: RowCheck): Row {
  c.id = c.raw("id") || undefined;
  c.id = c.idField("id", "place") || c.id;
  const zip = c.zip("zip");
  const hours = c.str("hours");
  const { lat, lng } = c.coords();
  const r: Row = {
    id: c.id ?? "",
    name: c.str("name", true),
    org: c.str("org"),
    org_type: c.enumOne("org_type", ORG_TYPES, "other"),
    address: c.str("address"),
    borough: zip || c.raw("borough") ? c.borough(zip) : "",
    zip,
    lat,
    lng,
    hours,
    open_evenings: c.bool("open_evenings", () => (hours ? opensEvenings(hours) : null)),
    open_weekends: c.bool("open_weekends", () => (hours ? opensWeekends(hours) : null)),
    languages: c.languages(),
    phone: c.str("phone"),
    trust: c.enumOne("trust", TRUST, "unverified"),
    source_url: c.url("source_url"),
    last_checked: c.date("last_checked"),
  };
  if (!r.address) c.warn("address", "blank", "address is blank");
  if (!hours) c.warn("hours", "blank", "hours is blank");
  if (zip && !zipToBorough(zip)) c.warn("zip", "zip_outside_nyc", `zip ${zip} is not a NYC zip`);
  return r;
}

function validateLink(c: RowCheck): Row {
  const from = c.raw("from_id"), to = c.raw("to_id");
  c.id = from && to ? `${from}->${to}` : from || to || undefined;
  const endpoint = (col: string, v: string) => {
    if (!v) return c.error(col, "missing", `${col} is required`), "";
    const lower = v.toLowerCase();
    if (ID_PATTERNS.program.test(lower) || ID_PATTERNS.place.test(lower)) {
      if (lower !== v) c.warn(col, "id_case", `${col} "${v}" lowercased`);
      return lower;
    }
    c.error(col, "bad_id", `${col} "${v}" must be a prog-<slug> or place-<slug> id`);
    return "";
  };
  const r: Row = {
    from_id: endpoint("from_id", from),
    to_id: endpoint("to_id", to),
    type: c.enumOne("type", LINK_TYPES),
    reason: c.str("reason"),
  };
  if (r.from_id && r.from_id === r.to_id) c.error("to_id", "self_link", "a link cannot point to itself");
  if (r.type === "offers" && r.from_id && !(String(r.from_id).startsWith("place-") && String(r.to_id).startsWith("prog-"))) {
    c.warn("type", "link_direction", "offers usually goes from a place to a program (place-x offers prog-y)");
  }
  if (!r.reason) c.warn("reason", "blank", "reason is blank");
  return r;
}

const VALIDATORS: Record<FileKind, Validator> = { programs: validateProgram, places: validatePlace, links: validateLink };

// ---------- file reading ----------

interface ParsedFile {
  report: FileReport;
  rows: { line: number; row: Row }[]; // valid rows, after duplicate handling
  issues: Issue[];
}

function emptyReport(kind: FileKind): FileReport {
  return {
    file: FILE_NAMES[kind], present: false, header: { missing: [], extra: [] },
    rows_read: 0, valid: 0, new: 0, updated: 0, unchanged: 0, skipped: 0, removed: 0, errors: 0, warnings: 0,
  };
}

/** Find programs.csv etc. case-insensitively. */
async function findFile(dir: string, name: string): Promise<string | null> {
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.toLowerCase() === name) return `${dir.replace(/\/$/, "")}/${e.name}`;
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return null;
}

function decode(bytes: Uint8Array): { text: string; note?: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      note: "file is not UTF-8; read as Windows-1252 (please export as CSV UTF-8)",
    };
  }
}

async function readFile(kind: FileKind, srcDir: string, today: string): Promise<ParsedFile> {
  const report = emptyReport(kind);
  const issues: Issue[] = [];
  const file = FILE_NAMES[kind];
  const fatal = (message: string): ParsedFile => {
    report.fatal = message;
    issues.push({ file, line: 0, level: "error", code: "fatal", message });
    return { report, rows: [], issues };
  };

  const path = await findFile(srcDir, file);
  if (!path) return { report, rows: [], issues };
  report.present = true;

  let text: string;
  try {
    const d = decode(await Deno.readFile(path));
    text = d.text;
    if (d.note) issues.push({ file, line: 0, level: "warning", code: "encoding", message: d.note });
  } catch (err) {
    return fatal(`cannot read ${path}: ${err instanceof Error ? err.message : err}`);
  }

  // header first, so its width can be used to detect stray quotes
  const headerOnly = parseCsv(text.split(/\r\n|\n|\r/, 1)[0] ?? "");
  const headerRec = headerOnly.records[0];
  if (!headerRec) return fatal("file is empty (no header row)");
  const { records, problems } = parseCsv(text, headerRec.fields.length);
  const header = records[0]?.fields ?? [];

  // header: case-insensitive, whitespace-tolerant, any order
  const wanted = COLUMNS[kind];
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, "_");
    if (!k) return;
    if ((wanted as readonly string[]).includes(k)) {
      if (colIndex.has(k)) issues.push({ file, line: 1, level: "warning", code: "duplicate_column", field: k, message: `column ${k} appears twice; using the first` });
      else colIndex.set(k, i);
    } else report.header.extra.push(h.trim());
  });
  report.header.missing = wanted.filter((c) => !colIndex.has(c));
  for (const c of report.header.extra) {
    issues.push({ file, line: 1, level: "warning", code: "extra_column", field: c, message: `extra column "${c}" ignored (expected: ${wanted.join(", ")})` });
  }
  const missingKeys = KEY_COLUMNS[kind].filter((c) => !colIndex.has(c));
  if (missingKeys.length) {
    return fatal(`header is missing ${missingKeys.join(", ")} (found: ${header.map((h) => h.trim()).join(", ")}; expected: ${wanted.join(", ")})`);
  }
  for (const c of report.header.missing) {
    issues.push({ file, line: 1, level: "warning", code: "missing_column", field: c, message: `column ${c} is missing; treated as blank in every row` });
  }

  for (const p of problems) {
    report.rows_read++;
    report.skipped++;
    issues.push({ file, line: p.line, id: p.firstField || undefined, level: "error", code: "bad_quotes", message: p.message });
  }

  // rows
  const valid: { line: number; row: Row; key: string }[] = [];
  for (const rec of records.slice(1)) {
    report.rows_read++;
    const values: Record<string, string> = {};
    for (const [col, i] of colIndex) values[col] = rec.fields[i] ?? "";
    const check = new RowCheck(file, rec.line, values, today);
    check.id = (values.id ?? (kind === "links" ? `${values.from_id ?? ""}->${values.to_id ?? ""}` : "")).trim() || undefined;

    // Wrong number of values: every later column is shifted, so per-field
    // checks would only add noise. Report the count and skip the row.
    const extra = rec.fields.slice(header.length);
    if (extra.length && extra.some((v) => v.trim())) {
      check.error(undefined, "extra_values", `row has ${rec.fields.length} values but the header has ${header.length} (an unquoted comma? quote fields that contain commas)`);
    } else if (rec.fields.length < header.length) {
      check.error(undefined, "missing_values", `row has ${rec.fields.length} values but the header has ${header.length}`);
    }
    if (check.errors.length) {
      issues.push(...check.errors);
      report.skipped++;
      continue;
    }
    if (extra.length) check.warn(undefined, "trailing_commas", "row has trailing empty values; ignored");
    if (rec.looseQuote) check.warn(undefined, "loose_quote", "a quote character appears outside a properly quoted field; kept as text");
    const row = VALIDATORS[kind](check);

    issues.push(...check.errors, ...check.warnings);
    if (check.errors.length) {
      report.skipped++;
      continue;
    }
    const key = kind === "links" ? `${row.from_id}|${row.type}|${row.to_id}` : String(row.id);
    valid.push({ line: rec.line, row, key });
  }

  // duplicate ids (or link keys): the later row wins
  const byKey = new Map<string, { line: number; row: Row }>();
  for (const v of valid) {
    const prev = byKey.get(v.key);
    if (prev) {
      report.skipped++;
      issues.push({
        file, line: v.line, id: kind === "links" ? v.key.replaceAll("|", " ") : v.key, level: "warning", code: "duplicate_id",
        message: `duplicate ${kind === "links" ? "link" : "id"}: this row replaces the one on line ${prev.line}`,
      });
      byKey.delete(v.key); // re-insert so CSV order follows the winning row
    }
    byKey.set(v.key, { line: v.line, row: v.row });
  }
  let rows = [...byKey.values()].sort((a, b) => a.line - b.line);

  // places: same name + address under different ids -> keep the first
  if (kind === "places") {
    const seen = new Map<string, { line: number; id: string }>();
    rows = rows.filter(({ line, row }) => {
      if (!String(row.address ?? "").trim()) return true;
      const k = placeKey(row.name, row.address);
      const first = seen.get(k);
      if (!first) return seen.set(k, { line, id: String(row.id) }), true;
      report.skipped++;
      issues.push({
        file, line, id: String(row.id), level: "warning", code: "duplicate_place",
        message: `same name and address as ${first.id} (line ${first.line}); skipped as a duplicate`,
      });
      return false;
    });
  }

  report.valid = rows.length;
  return { report, rows, issues };
}

// ---------- storage (same protocol as shared/db.ts) ----------

function entityPath(outDir: string, entity: string): string {
  return `${outDir.replace(/\/$/, "")}/${entity}.json`;
}

async function readEntity(outDir: string, entity: string): Promise<Row[]> {
  try {
    const text = await Deno.readTextFile(entityPath(outDir, entity));
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error(`${entity}.json is not an array`);
    return parsed;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}

async function writeEntity(outDir: string, entity: string, rows: Row[]): Promise<void> {
  await Deno.mkdir(outDir, { recursive: true });
  const tmp = `${entityPath(outDir, entity)}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(rows, null, 2) + "\n");
  await Deno.rename(tmp, entityPath(outDir, entity));
}

async function withLocks<R>(outDir: string, entities: string[], fn: () => Promise<R>): Promise<R> {
  await Deno.mkdir(outDir, { recursive: true });
  const held: string[] = [];
  try {
    for (const entity of entities) { // fixed order, so no deadlock with each other
      const lock = `${entityPath(outDir, entity)}.lock`;
      for (let tries = 0;; tries++) {
        try {
          (await Deno.open(lock, { write: true, createNew: true })).close();
          held.push(lock);
          break;
        } catch (err) {
          if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
          const age = Date.now() - ((await Deno.stat(lock).catch(() => null))?.mtime?.getTime() ?? Date.now());
          if (age > 10_000) await Deno.remove(lock).catch(() => {});
          else if (tries > 500) throw new Error(`${entity}.json is locked`);
          else await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
        }
      }
    }
    return await fn();
  } finally {
    for (const lock of held) await Deno.remove(lock).catch(() => {});
  }
}

// ---------- merge ----------

interface MergeResult {
  rows: Row[];
  removed: { entity: string; id: string; reason: string }[];
}

/** Upsert Programs or Places by id. */
function mergeById(
  kind: "programs" | "places",
  existing: Row[],
  parsed: ParsedFile,
  opts: ImportOptions,
  nowIso: string,
): MergeResult {
  const entity = ENTITY[kind];
  const incoming = new Map(parsed.rows.map((r) => [String(r.row.id), r.row]));
  const removed: MergeResult["removed"] = [];
  const out: Row[] = [];
  for (const old of existing) {
    const id = String(old.id);
    const next = incoming.get(id);
    if (next) {
      incoming.delete(id);
      if (sameContent(kind, old, next)) {
        parsed.report.unchanged++;
        out.push(old);
      } else {
        parsed.report.updated++;
        out.push({ ...old, ...next, id, created_date: old.created_date ?? nowIso, updated_date: nowIso });
      }
    } else if (isSample(old) && !opts.keepSample) {
      removed.push({ entity, id, reason: "sample record (use --keep-sample to keep)" });
    } else if (opts.replace) {
      removed.push({ entity, id, reason: "not in CSV (--replace)" });
    } else {
      out.push(old); // preserved: e.g. a community-approved place
    }
  }
  for (const row of incoming.values()) {
    parsed.report.new++;
    out.push({ ...row, created_date: nowIso, updated_date: nowIso });
  }
  parsed.report.removed += removed.length;
  return { rows: out, removed };
}

function linkKey(r: Row): string {
  return `${r.from_id}|${r.type}|${r.to_id}`;
}

/** New link ids are readable and stable: link-<from>-<type>-<to>. */
function linkId(r: Row): string {
  return `link-${r.from_id}-${r.type}-${r.to_id}`;
}

function mergeLinks(
  existing: Row[],
  parsed: ParsedFile,
  opts: ImportOptions,
  nowIso: string,
  liveIds: Set<string>,
  sampleIds: Set<string>,
  removedIds: Set<string>,
): MergeResult {
  const removed: MergeResult["removed"] = [];
  const file = FILE_NAMES.links;

  // links.csv rows must point at records that exist after this import
  const incoming = new Map<string, Row>();
  for (const { line, row } of parsed.rows) {
    const bad: string[] = [];
    for (const col of ["from_id", "to_id"] as const) {
      const id = String(row[col]);
      if (!liveIds.has(id)) {
        bad.push(col);
        parsed.issues.push({
          file, line, id: `${row.from_id}->${row.to_id}`, level: "error", field: col, code: "dangling_link",
          message: removedIds.has(id)
            ? `${col} ${id} is a sample record that this import removes (add it to the CSV, or use --keep-sample)`
            : `${col} ${id} does not exist in programs or places`,
        });
      }
    }
    if (bad.length) {
      parsed.report.skipped++;
      parsed.report.valid--;
      continue;
    }
    incoming.set(linkKey(row), row);
  }

  const touched = parsed.rows.length > 0 && parsed.report.valid > 0;
  const out: Row[] = [];
  for (const old of existing) {
    const key = linkKey(old);
    const next = incoming.get(key);
    const id = String(old.id);
    if (next) {
      incoming.delete(key);
      if (sameContent("links", old, next)) {
        parsed.report.unchanged++;
        out.push(old);
      } else {
        parsed.report.updated++;
        out.push({ ...old, ...next, id, updated_date: nowIso });
      }
      continue;
    }
    const wasSample = sampleIds.has(String(old.from_id)) || sampleIds.has(String(old.to_id));
    if (touched && wasSample && !opts.keepSample) {
      removed.push({ entity: "Link", id, reason: "sample link (use --keep-sample to keep)" });
    } else if (touched && opts.replace) {
      removed.push({ entity: "Link", id, reason: "not in CSV (--replace)" });
    } else if (!liveIds.has(String(old.from_id)) || !liveIds.has(String(old.to_id))) {
      removed.push({ entity: "Link", id, reason: "points at a record that no longer exists" });
    } else {
      out.push(old);
    }
  }
  const ids = new Set(out.map((r) => String(r.id)));
  for (const row of incoming.values()) {
    parsed.report.new++;
    let id = linkId(row);
    for (let n = 2; ids.has(id); n++) id = `${linkId(row)}-${n}`;
    ids.add(id);
    out.push({ id, ...row, created_date: nowIso, updated_date: nowIso });
  }
  parsed.report.removed += removed.length;
  return { rows: out, removed };
}

// ---------- main entry ----------

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const notes: string[] = [];

  const files = {
    programs: await readFile("programs", opts.srcDir, today),
    places: await readFile("places", opts.srcDir, today),
    links: await readFile("links", opts.srcDir, today),
  };
  const kinds = Object.keys(files) as FileKind[];
  for (const k of kinds) {
    if (!files[k].report.present) notes.push(`${FILE_NAMES[k]} not found in ${opts.srcDir}; ${ENTITY[k]} left as is`);
  }
  const anyPresent = kinds.some((k) => files[k].report.present);
  const anyFatal = kinds.some((k) => files[k].report.fatal);

  // An entity is only touched when its file gave at least one valid row,
  // so a broken or empty file never wipes existing data.
  const use = (k: FileKind) => files[k].report.present && !files[k].report.fatal && files[k].rows.length > 0;
  for (const k of kinds) {
    if (files[k].report.present && !files[k].report.fatal && !files[k].rows.length) {
      notes.push(`${FILE_NAMES[k]} has no valid rows; ${ENTITY[k]} left as is`);
    }
  }

  const removed: ImportReport["removed"] = [];
  const touchedEntities = kinds.filter(use).map((k) => ENTITY[k]);
  // Links can be pruned when programs/places lose records, so lock all three.
  const lockSet = touchedEntities.length ? ["Link", "Place", "Program"] : [];

  const work = async () => {
    const existing = {
      Program: await readEntity(opts.outDir, "Program"),
      Place: await readEntity(opts.outDir, "Place"),
      Link: await readEntity(opts.outDir, "Link"),
    };
    const sampleIds = new Set([...existing.Program, ...existing.Place].filter(isSample).map((r) => String(r.id)));

    const programs = use("programs")
      ? mergeById("programs", existing.Program, files.programs, opts, nowIso)
      : { rows: existing.Program, removed: [] };
    const places = use("places")
      ? mergeById("places", existing.Place, files.places, opts, nowIso)
      : { rows: existing.Place, removed: [] };
    removed.push(...programs.removed, ...places.removed);

    const liveIds = new Set([...programs.rows, ...places.rows].map((r) => String(r.id)));
    const removedIds = new Set([...programs.removed, ...places.removed].map((r) => r.id));
    // Always run the link merge when anything changed, to prune dangling links.
    const links = use("links") || removedIds.size
      ? mergeLinks(existing.Link, files.links, opts, nowIso, liveIds, sampleIds, removedIds)
      : { rows: existing.Link, removed: [] };
    removed.push(...links.removed);
    if (!use("links") && links.removed.length) {
      notes.push(`removed ${links.removed.length} link(s) whose endpoints no longer exist`);
    }

    if (!opts.dryRun) {
      if (use("programs")) await writeEntity(opts.outDir, "Program", programs.rows);
      if (use("places")) await writeEntity(opts.outDir, "Place", places.rows);
      if (links.rows !== existing.Link) await writeEntity(opts.outDir, "Link", links.rows);
    }
    return { Program: programs.rows.length, Place: places.rows.length, Link: links.rows.length };
  };

  const totals = opts.dryRun || !lockSet.length ? await work() : await withLocks(opts.outDir, lockSet, work);

  // collect issues and counts
  const issues = kinds.flatMap((k) => files[k].issues);
  for (const k of kinds) {
    const r = files[k].report;
    r.errors = files[k].issues.filter((i) => i.level === "error").length;
    r.warnings = files[k].issues.filter((i) => i.level === "warning").length;
  }
  const reasonCounts = new Map<string, number>();
  for (const i of issues) {
    const reason = `${i.level} ${i.file} ${i.field ? i.field + ": " : ""}${i.code}`;
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const top_reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 15);

  if (!anyPresent) notes.push(`no programs.csv, places.csv or links.csv found in ${opts.srcDir}`);
  const sampleRemoved = removed.filter((r) => r.reason.startsWith("sample")).length;
  if (sampleRemoved) notes.push(`${opts.dryRun ? "would remove" : "removed"} ${sampleRemoved} sample record(s); use --keep-sample to keep them`);

  const report: ImportReport = {
    generated_at: nowIso,
    src_dir: opts.srcDir,
    out_dir: opts.outDir,
    dry_run: !!opts.dryRun,
    keep_sample: !!opts.keepSample,
    replace: !!opts.replace,
    exit_code: anyFatal || !anyPresent ? 1 : 0,
    files: { programs: files.programs.report, places: files.places.report, links: files.links.report },
    totals,
    removed,
    top_reasons,
    issues: issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    notes,
  };

  if (opts.reportPath !== null) {
    const path = opts.reportPath ?? `${opts.outDir.replace(/\/$/, "")}/import-report.json`;
    await Deno.mkdir(path.replace(/\/[^/]*$/, "") || ".", { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

// ---------- console output ----------

export function formatReport(r: ImportReport, reportPath?: string): string {
  const out: string[] = [];
  out.push(`Import ${r.src_dir} -> ${r.out_dir}${r.dry_run ? "  (DRY RUN: nothing written)" : ""}`);
  out.push("");
  const head = ["file", "read", "new", "updated", "unchanged", "skipped", "removed", "errors", "warnings"];
  const rows = Object.values(r.files).map((f) =>
    f.present
      ? [f.file, f.rows_read, f.new, f.updated, f.unchanged, f.skipped, f.removed, f.errors, f.warnings].map(String)
      : [f.file, "-", "-", "-", "-", "-", "-", "-", "(not found)"]
  );
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  out.push(fmt(head));
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((row) => out.push(fmt(row)));
  out.push("");
  out.push(`Totals after import: Program ${r.totals.Program}, Place ${r.totals.Place}, Link ${r.totals.Link}`);

  for (const f of Object.values(r.files)) {
    if (f.fatal) out.push(`\nFATAL ${f.file}: ${f.fatal}`);
    if (f.header.missing.length || f.header.extra.length) {
      out.push(`\n${f.file} header: ${f.header.missing.length ? `missing ${f.header.missing.join(", ")}` : ""}${f.header.missing.length && f.header.extra.length ? "; " : ""}${f.header.extra.length ? `extra ${f.header.extra.join(", ")}` : ""}`);
    }
  }

  // bad rows grouped by file+line with every reason
  const errorsByRow = new Map<string, Issue[]>();
  for (const i of r.issues.filter((i) => i.level === "error" && i.line > 0)) {
    const k = `${i.file}:${i.line}`;
    errorsByRow.set(k, [...(errorsByRow.get(k) ?? []), i]);
  }
  if (errorsByRow.size) {
    out.push(`\nSkipped rows (${errorsByRow.size}):`);
    for (const list of errorsByRow.values()) {
      const first = list[0];
      out.push(`  ${first.file} line ${first.line}${first.id ? ` [${first.id}]` : ""}:`);
      for (const i of list) out.push(`    - ${i.message}`);
    }
  }
  const warnings = r.issues.filter((i) => i.level === "warning");
  if (warnings.length) {
    const shown = warnings.slice(0, 25);
    out.push(`\nWarnings (${warnings.length}${warnings.length > shown.length ? `, first ${shown.length} shown` : ""}):`);
    for (const i of shown) out.push(`  ${i.file}${i.line ? ` line ${i.line}` : ""}${i.id ? ` [${i.id}]` : ""}: ${i.message}`);
  }
  if (r.removed.length) {
    out.push(`\n${r.dry_run ? "Would remove" : "Removed"} ${r.removed.length} existing record(s):`);
    const byReason = new Map<string, string[]>();
    for (const x of r.removed) byReason.set(`${x.entity}: ${x.reason}`, [...(byReason.get(`${x.entity}: ${x.reason}`) ?? []), x.id]);
    for (const [reason, ids] of byReason) out.push(`  ${ids.length} ${reason} (${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ", ..." : ""})`);
  }
  if (r.top_reasons.length) {
    out.push("\nTop reasons:");
    for (const t of r.top_reasons.slice(0, 10)) out.push(`  ${String(t.count).padStart(3)}x ${t.reason}`);
  }
  if (r.notes.length) {
    out.push("\nNotes:");
    for (const n of r.notes) out.push(`  - ${n}`);
  }
  if (reportPath) out.push(`\nFull report: ${reportPath}`);
  out.push(r.exit_code === 0 ? "\nOK" : "\nFAILED (see FATAL / notes above)");
  return out.join("\n");
}

// ---------- CLI ----------

/** Where Program.json etc. live: $DATA_DIR, else the repo's data/ (like shared/db.ts). */
export function defaultDataDir(): string {
  const override = Deno.env.get("DATA_DIR");
  if (override) return override.startsWith("/") ? override : `${Deno.cwd()}/${override}`;
  return decodeURIComponent(new URL("../data/", import.meta.url).pathname);
}

const HELP = `Usage: deno task import [csv-dir] [--dry-run] [--keep-sample] [--replace] [--report=PATH]

Reads programs.csv, places.csv, links.csv from csv-dir (default: the data dir)
and loads them into Program.json, Place.json, Link.json in $DATA_DIR or data/.

  --dry-run      validate and report only; data files are not changed
  --keep-sample  keep sample records (source_url ${SAMPLE_URL_PREFIX}...)
  --replace      drop existing records that are not in the CSV (default keeps them)
  --report=PATH  JSON report path (default <data dir>/import-report.json); --no-report to skip`;

if (import.meta.main) {
  const args = Deno.args;
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    Deno.exit(0);
  }
  const known = ["--dry-run", "--keep-sample", "--replace", "--no-report"];
  const unknown = args.filter((a) => a.startsWith("-") && !known.includes(a) && !a.startsWith("--report="));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(" ")}\n\n${HELP}`);
    Deno.exit(1);
  }
  const outDir = defaultDataDir();
  const positional = args.filter((a) => !a.startsWith("-"));
  const srcDir = positional[0] ? positional[0].replace(/\/$/, "") : outDir.replace(/\/$/, "");
  const reportArg = args.find((a) => a.startsWith("--report="))?.slice("--report=".length);
  const reportPath = args.includes("--no-report") ? null : reportArg ?? `${outDir.replace(/\/$/, "")}/import-report.json`;

  const started = performance.now();
  try {
    const report = await runImport({
      srcDir,
      outDir,
      dryRun: args.includes("--dry-run"),
      keepSample: args.includes("--keep-sample"),
      replace: args.includes("--replace"),
      reportPath,
    });
    console.log(formatReport(report, reportPath ?? undefined));
    console.log(`(${Math.round(performance.now() - started)} ms)`);
    Deno.exit(report.exit_code);
  } catch (err) {
    // Only unexpected failures (e.g. a data/*.json that is not valid JSON) land here.
    console.error(`Import failed: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
}
