// Shapes returned by the backend functions (see shared/web/*.ts).

export const NEEDS = ["food", "legal", "health", "benefits", "money", "school", "id", "housing", "work", "transit"] as const;
export type Need = typeof NEEDS[number];

export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] as const;

export const ORG_TYPES = [
  "pantry", "clinic", "benefits_office", "idnyc", "school", "doj_pro_bono", "doj_roster",
  "consulate", "remittance", "check_casher", "other",
] as const;

/** Language codes offered in filters and the submit form (Corona-first). */
export const LANGUAGE_CODES = ["es", "en", "quc", "qu", "zh", "bn", "ne", "ar", "fr", "ht"] as const;

export interface DirectoryProgram {
  id: string;
  name: string;
  needs: Need[];
  summary: string;
  summary_es: string;
  summary_en: string;
  who_can_use: string;
  status_note: string;
  status_dependent: boolean;
  /** "Talk with a free legal provider before applying", in the UI language; "" when not needed. */
  status_advice: string;
  how_to_apply: string;
  source_url: string;
  last_checked: string;
}

export interface DirectoryPlace {
  id: string;
  name: string;
  org: string;
  org_type: string;
  address: string;
  borough: string;
  zip: string;
  hours: string;
  open_now: boolean | null;
  open_today: boolean | null;
  open_evenings: boolean;
  open_weekends: boolean;
  languages: string[];
  phone: string;
  needs: Need[];
  bring: string[];
  programs: DirectoryProgram[];
  trust: "official" | "verified" | "community" | "unverified" | string;
  trust_label: string;
  source_url: string;
  last_checked: string;
}

export interface ListPlacesResult {
  places: DirectoryPlace[];
  count: number;
  total: number;
  filters: { need: string | null; borough: string | null; language: string | null; q: string | null };
  ui_language: "es" | "en";
  disclaimer: string;
  sample_data: boolean;
  sample_data_note: string;
}

export interface SubmitInput {
  name: string;
  org?: string;
  org_type?: string;
  address: string;
  borough?: string;
  zip?: string;
  hours?: string;
  languages?: string[];
  phone?: string;
  needs?: string[];
  source_url?: string;
  notes?: string;
  website?: string; // honeypot, always empty for people
  ui_language?: string;
}

export interface SubmitResult {
  ok: boolean;
  status: "pending";
  message: string;
}

export interface Submission {
  id: string;
  name: string;
  org?: string;
  org_type?: string;
  address?: string;
  borough?: string;
  zip?: string;
  hours?: string;
  languages?: string[];
  phone?: string;
  needs?: string[];
  source_url?: string;
  notes?: string;
  trust?: string;
  status: "pending" | "approved" | "rejected";
  place_id?: string;
  reviewed_at?: string;
  created_date?: string;
}

export interface ReviewListResult {
  submissions: Submission[];
  counts: { pending: number; approved: number; rejected: number };
}

export type SubmissionEdits = Partial<Pick<Submission,
  "name" | "org" | "org_type" | "address" | "borough" | "zip" | "hours" | "phone" | "source_url">> & {
  languages?: string[];
};

export interface ReviewActionResult {
  ok: boolean;
  submission: Submission;
  place?: { id: string; name: string; trust: string };
}

export interface Count {
  key: string;
  count: number;
}

export interface Insights {
  test_traffic: true;
  total: number;
  unmet_total: number;
  results_found_total: number;
  first_at: string | null;
  last_at: string | null;
  by_need: Count[];
  unmet_by_need: Count[];
  unmet_by_zip: { zip: string; unmet: number; total: number }[];
  languages: Count[];
  channels: Count[];
  by_day: Count[];
}
