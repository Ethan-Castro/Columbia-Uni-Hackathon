// Entity types and enums. Source of truth: the Shared CSV contract (README).
// Keep this file consistent with base44/entities/*.jsonc.
//
// CSV conventions: lists are pipe-separated in CSV (food|legal) and stored
// here as string arrays; booleans are true/false; lat/lng are numbers;
// last_checked is YYYY-MM-DD. ids are prog-<slug> and place-<slug>.

export const NEEDS = [
  "food",
  "legal",
  "health",
  "benefits",
  "money",
  "school",
  "id",
  "housing",
  "work",
  "transit",
] as const;
export type Need = typeof NEEDS[number];

export const TRUST = ["official", "verified", "community", "unverified"] as const;
export type Trust = typeof TRUST[number];

export const ORG_TYPES = [
  "doj_roster",
  "doj_pro_bono",
  "pantry",
  "consulate",
  "clinic",
  "benefits_office",
  "idnyc",
  "remittance",
  "check_casher",
  "school",
  "other",
] as const;
export type OrgType = typeof ORG_TYPES[number];

export const LINK_TYPES = ["offers", "unlocks", "pairs_with", "requires", "refers_to"] as const;
export type LinkType = typeof LINK_TYPES[number];

export const SUBMISSION_STATUS = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = typeof SUBMISSION_STATUS[number];

export const COMMUNITY_KINDS = ["question", "correction", "reply"] as const;
export type CommunityKind = typeof COMMUNITY_KINDS[number];

export const COMMUNITY_STATUS = ["published", "hidden"] as const;
export type CommunityStatus = typeof COMMUNITY_STATUS[number];

export const CHANNELS = ["mcp", "whatsapp", "voice", "web"] as const;
export type Channel = typeof CHANNELS[number];

export const ID_PATTERNS = {
  program: /^prog-[a-z0-9]+(?:-[a-z0-9]+)*$/,
  place: /^place-[a-z0-9]+(?:-[a-z0-9]+)*$/,
} as const;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Auto fields added by db.ts (and by Base44). Never set these by hand. */
export interface BuiltIn {
  id: string;
  created_date?: string;
  updated_date?: string;
}

// ---------- CSV contract entities ----------

export interface Program extends BuiltIn {
  id: string; // prog-<slug>
  name: string;
  needs: Need[];
  who_can_use: string;
  status_note: string;
  bring: string[];
  how_to_apply: string;
  summary_es: string;
  summary_en: string;
  source_url: string;
  last_checked: string; // YYYY-MM-DD
}

export interface Place extends BuiltIn {
  id: string; // place-<slug>
  name: string;
  org: string;
  org_type: OrgType;
  address: string;
  borough: string;
  zip: string;
  lat: number;
  lng: number;
  hours: string;
  open_evenings: boolean;
  open_weekends: boolean;
  languages: string[];
  phone: string;
  trust: Trust;
  source_url: string;
  last_checked: string; // YYYY-MM-DD
}

export interface Link extends BuiltIn {
  from_id: string;
  to_id: string;
  type: LinkType;
  reason: string;
}

// ---------- Extra entities ----------

/**
 * A community/Scout-submitted place. Never goes live until approved by a human.
 * Only name and status are required (matches Submission.jsonc); approving it
 * into a Place must fill in source_url and last_checked.
 */
export interface Submission extends Partial<Omit<Place, "id">>, BuiltIn {
  name: string;
  status: SubmissionStatus;
}

/** One row per request. NEVER names, phones, or free text. */
export interface RequestLog extends BuiltIn {
  needs: Need[];
  zip: string;
  language: string;
  channel: Channel;
  results_found: number;
  unmet: boolean;
  created_at: string; // ISO datetime
}

/**
 * A post on the community page: a local question, a resource correction, or a
 * reply. Discussion only: posts never become directory results (only an
 * approved Submission does). No names, phones or emails are stored.
 */
export interface CommunityPost extends BuiltIn {
  kind: CommunityKind;
  body: string;
  need?: Need;
  zip?: string;
  parent_id?: string; // replies: id of the post they answer ("demo-..." for the built-in examples)
  status: CommunityStatus;
}

export const REQUEST_LOG_FIELDS = [
  "needs",
  "zip",
  "language",
  "channel",
  "results_found",
  "unmet",
  "created_at",
] as const;

/**
 * Places carry no needs column in the contract; a place serves a need through
 * Link(offers) to a Program, or by its org_type. This is the org_type fallback.
 */
export const ORG_TYPE_NEEDS: Record<OrgType, Need[]> = {
  doj_roster: ["legal"],
  doj_pro_bono: ["legal"],
  pantry: ["food"],
  consulate: ["id", "legal"],
  clinic: ["health"],
  benefits_office: ["benefits", "food", "health"],
  idnyc: ["id"],
  remittance: ["money"],
  check_casher: ["money"],
  school: ["school"],
  other: [],
};

// ---------- CSV column lists (phase 3 import validates against these) ----------

export type FieldKind = "string" | "list" | "boolean" | "number" | "date";

export const PROGRAM_COLUMNS = [
  "id",
  "name",
  "needs",
  "who_can_use",
  "status_note",
  "bring",
  "how_to_apply",
  "summary_es",
  "summary_en",
  "source_url",
  "last_checked",
] as const;

export const PLACE_COLUMNS = [
  "id",
  "name",
  "org",
  "org_type",
  "address",
  "borough",
  "zip",
  "lat",
  "lng",
  "hours",
  "open_evenings",
  "open_weekends",
  "languages",
  "phone",
  "trust",
  "source_url",
  "last_checked",
] as const;

export const LINK_COLUMNS = ["from_id", "to_id", "type", "reason"] as const;

/** How each CSV column is parsed. Columns not listed are plain strings. */
export const PROGRAM_FIELD_KINDS: Partial<Record<typeof PROGRAM_COLUMNS[number], FieldKind>> = {
  needs: "list",
  bring: "list",
  last_checked: "date",
};

export const PLACE_FIELD_KINDS: Partial<Record<typeof PLACE_COLUMNS[number], FieldKind>> = {
  lat: "number",
  lng: "number",
  open_evenings: "boolean",
  open_weekends: "boolean",
  languages: "list",
  last_checked: "date",
};

/** Enum constraints per column (list columns: every item must be in the enum). */
export const PROGRAM_ENUMS = { needs: NEEDS } as const;
export const PLACE_ENUMS = { org_type: ORG_TYPES, trust: TRUST } as const;
export const LINK_ENUMS = { type: LINK_TYPES } as const;

export const ENTITY_NAMES = ["Program", "Place", "Link", "Submission", "RequestLog", "CommunityPost"] as const;
export type EntityName = typeof ENTITY_NAMES[number];

export interface EntityMap {
  Program: Program;
  Place: Place;
  Link: Link;
  Submission: Submission;
  RequestLog: RequestLog;
  CommunityPost: CommunityPost;
}
