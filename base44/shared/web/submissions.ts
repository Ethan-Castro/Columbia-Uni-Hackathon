// Community submissions: public form -> pending Submission -> human review ->
// Place (trust "community"). Nothing goes live without an admin approving it.
//
//   submitResource(req, body)           // public, functions/submit_resource
//   reviewQueue(req, body)              // admin, functions/review_queue
//
// Submissions describe an organization, never the person sending it: we do
// not ask for or keep the submitter's name, phone or email.

import { getDb } from "../db.ts";
import { HttpError } from "../http.ts";
import { normalizeBorough, ZIP_CENTROIDS, zipToBorough } from "../geo.ts";
import { nyClock, placeOpenEvenings, placeOpenWeekends } from "../hours.ts";
import { langOf } from "../i18n.ts";
import { ORG_TYPES } from "../schema.ts";
import type { Need, OrgType, Place, Submission } from "../schema.ts";
import { stripAccents } from "../text.ts";
import { getNeeds } from "../tools/input.ts";
import { requireAdmin } from "../auth.ts";
import { languageCode } from "./directory.ts";
import type { Body } from "./handler.ts";

/** Fields a submission may carry beyond the Place columns (see open issues in web/README.md). */
export type SubmissionRow = Submission & {
  needs?: Need[];
  notes?: string;
  place_id?: string;
  reviewed_at?: string;
};

/** Cleaned, validated fields from the form or from admin edits. */
export interface CleanFields {
  name?: string;
  org?: string;
  org_type?: OrgType;
  address?: string;
  borough?: string;
  zip?: string;
  hours?: string;
  languages?: string[];
  phone?: string;
  needs?: Need[];
  source_url?: string;
  notes?: string;
  lat?: number;
  lng?: number;
  open_evenings?: boolean;
  open_weekends?: boolean;
}

const MAX_PENDING = 1000; // simple flood guard for the public form

const THANKS = {
  es: "¡Gracias! Una persona de nuestro equipo revisa cada recurso antes de publicarlo. Si lo aprobamos, aparecerá en el directorio como \"De la comunidad\".",
  en: "Thank you! A person on our team reviews every resource before it is published. If we approve it, it will show in the directory as \"Community\".",
};

// ---------- validation ----------

/** Trim, drop control characters, collapse spaces, cap length. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanUrl(v: unknown): string {
  const s = clean(v, 500);
  if (!s) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    return u.toString();
  } catch {
    throw new HttpError(400, "source_url must be a web address (https://...)");
  }
}

function cleanLanguages(v: unknown): string[] {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[|,;/]+/) : [];
  const out: string[] = [];
  for (const p of parts) {
    const code = languageCode(p);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, 12);
}

/**
 * Validate form fields or admin edits. `partial` (edits) only checks the keys
 * that are present; otherwise name and address are required.
 */
export function cleanFields(body: Body, opts: { partial?: boolean } = {}): CleanFields {
  const has = (k: string) => body[k] !== undefined && body[k] !== null;
  const out: CleanFields = {};

  for (const [key, max] of [["name", 120], ["org", 120], ["address", 200], ["hours", 200], ["notes", 1000]] as const) {
    if (has(key)) out[key] = clean(body[key], max);
  }
  if (!opts.partial) {
    if (!out.name) throw new HttpError(400, "name is required");
    if (!out.address) throw new HttpError(400, "address is required");
  } else {
    if (has("name") && !out.name) throw new HttpError(400, "name cannot be empty");
  }

  if (has("org_type") && clean(body.org_type, 40)) {
    const v = clean(body.org_type, 40);
    if (!(ORG_TYPES as readonly string[]).includes(v)) throw new HttpError(400, `org_type must be one of: ${ORG_TYPES.join(", ")}`);
    out.org_type = v as OrgType;
  } else if (!opts.partial) out.org_type = "other";

  if (has("zip")) {
    const z = clean(body.zip, 10);
    if (z && !/^\d{5}$/.test(z)) throw new HttpError(400, "zip must be 5 digits");
    out.zip = z;
  }
  // No zip given: take it from the address ("..., Corona, NY 11368").
  if (!out.zip && out.address) out.zip = out.address.match(/\b(\d{5})\b(?!.*\b\d{5}\b)/)?.[1] ?? out.zip;

  if (has("borough") && clean(body.borough, 40)) {
    const b = normalizeBorough(clean(body.borough, 40));
    if (!b) throw new HttpError(400, "borough must be Manhattan, Brooklyn, Queens, Bronx or Staten Island");
    out.borough = b;
  } else if (out.zip && !opts.partial) out.borough = zipToBorough(out.zip) ?? "";

  if (has("phone")) {
    const p = clean(body.phone, 30);
    if (p && !/^[0-9+().\-\s]{7,30}$/.test(p)) throw new HttpError(400, "phone has invalid characters");
    out.phone = p;
  }
  if (has("languages")) out.languages = cleanLanguages(body.languages);
  if (has("needs")) out.needs = getNeeds(body, "needs");
  if (has("source_url")) out.source_url = cleanUrl(body.source_url);

  // Admin-only extras.
  if (opts.partial) {
    for (const k of ["lat", "lng"] as const) {
      if (has(k)) {
        const n = Number(body[k]);
        if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number`);
        out[k] = n;
      }
    }
    for (const k of ["open_evenings", "open_weekends"] as const) {
      if (typeof body[k] === "boolean") out[k] = body[k] as boolean;
    }
  }
  return out;
}

// ---------- public: submit ----------

export async function submitResource(req: Request, body: Body) {
  const lang = langOf(body.ui_language ?? body.language ?? "es");
  const thanks = { ok: true, status: "pending", message: THANKS[lang] };

  // Honeypot: real people never see the "website" field. Bots that fill it
  // get the same answer, and nothing is stored.
  if (clean(body.website, 200)) return thanks;

  const fields = cleanFields(body);
  const db = getDb(req);

  if ((await db.Submission.count({ status: "pending" })) >= MAX_PENDING) {
    throw new HttpError(503, "The review queue is full right now. Please try again later.");
  }
  // Double-click / resend: same name and address already pending -> no duplicate.
  const dup = await db.Submission.filter({ status: "pending", name: fields.name, address: fields.address }, undefined, 1);
  if (dup.length) return thanks;

  const row: Partial<SubmissionRow> = { ...fields, trust: "community", status: "pending" };
  await db.Submission.create(row);
  return thanks;
}

// ---------- admin: review queue ----------

/** "Clínica San José (sample)" -> "clinica-san-jose". */
export function slugify(name: string): string {
  return stripAccents(name.toLowerCase())
    .replace(/\(sample\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "community";
}

/** place-<slug>, with -2, -3 ... when taken. */
export function uniquePlaceId(name: string, taken: Set<string>): string {
  const base = `place-${slugify(name)}`;
  if (!taken.has(base)) return base;
  for (let i = 2;; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function getPending(req: Request, id: unknown): Promise<SubmissionRow> {
  const sid = clean(id, 64);
  if (!sid) throw new HttpError(400, "id is required");
  const sub = await getDb(req).Submission.get(sid) as SubmissionRow;
  if (sub.status !== "pending") throw new HttpError(409, `Submission is already ${sub.status}`);
  return sub;
}

export async function reviewQueue(req: Request, body: Body) {
  await requireAdmin(req);
  const db = getDb(req);
  const action = clean(body.action, 20) || "list";

  if (action === "list") {
    const status = clean(body.status, 20) || "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      throw new HttpError(400, "status must be pending, approved, rejected or all");
    }
    const query = status === "all" ? {} : { status };
    const [submissions, pending, approved, rejected] = await Promise.all([
      db.Submission.filter(query, "-created_date", 200),
      db.Submission.count({ status: "pending" }),
      db.Submission.count({ status: "approved" }),
      db.Submission.count({ status: "rejected" }),
    ]);
    return { submissions, counts: { pending, approved, rejected } };
  }

  if (action === "approve") {
    const sub = await getPending(req, body.id);
    const edits = body.edits && typeof body.edits === "object" && !Array.isArray(body.edits)
      ? cleanFields(body.edits as Body, { partial: true })
      : {};
    const m = { ...sub, ...edits } as SubmissionRow & CleanFields;
    if (!m.name) throw new HttpError(400, "name is required to publish");
    if (!m.zip || !/^\d{5}$/.test(m.zip)) throw new HttpError(400, "A 5-digit zip is required to publish. Add it in edits.");

    const taken = new Set((await db.Place.list("id", 5000, 0, ["id"])).map((p) => p.id));
    const id = uniquePlaceId(m.name, taken);
    const centroid = ZIP_CENTROIDS[m.zip];
    const hours = m.hours ?? "";
    const place: Partial<Place> & { needs?: Need[] } = {
      id,
      name: m.name,
      org: m.org ?? "",
      org_type: (m.org_type ?? "other") as OrgType,
      address: m.address ?? "",
      borough: normalizeBorough(m.borough) ?? zipToBorough(m.zip) ?? "",
      zip: m.zip,
      // Approximate location (zip center) when the submission has none.
      ...(typeof m.lat === "number" && typeof m.lng === "number"
        ? { lat: m.lat, lng: m.lng }
        : centroid
        ? { lat: centroid[0], lng: centroid[1] }
        : {}),
      hours,
      open_evenings: typeof m.open_evenings === "boolean" ? m.open_evenings : placeOpenEvenings({ hours }),
      open_weekends: typeof m.open_weekends === "boolean" ? m.open_weekends : placeOpenWeekends({ hours }),
      languages: m.languages ?? [],
      phone: m.phone ?? "",
      trust: "community",
      source_url: m.source_url || `community-submission:${sub.id}`,
      last_checked: nyClock().date,
      ...(m.needs?.length ? { needs: m.needs } : {}),
    };
    const created = await db.Place.create(place);
    const submission = await db.Submission.update(sub.id, {
      status: "approved",
      place_id: created.id,
      reviewed_at: new Date().toISOString(),
    } as Partial<SubmissionRow>);
    return { ok: true, place: created, submission };
  }

  if (action === "reject") {
    const sub = await getPending(req, body.id);
    const submission = await db.Submission.update(sub.id, {
      status: "rejected",
      reviewed_at: new Date().toISOString(),
    } as Partial<SubmissionRow>);
    return { ok: true, submission };
  }

  throw new HttpError(400, "action must be list, approve or reject");
}
