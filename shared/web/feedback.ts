// Admin side of Feedback: open "this is wrong" reports grouped by place, and
// resolving them after a person re-checks the place. Called through
// functions/review_queue ({ action: "feedback" } / { action: "resolve_feedback" }).
//
// Resolving closes every open report for the place. With `confirmed: true` the
// person also re-checked the facts, so the place's last_checked becomes today;
// with `edits` the place's fields are corrected in the same step (same rules as
// approving a submission: shared/web/submissions.ts cleanFields).

import { getDb } from "../db.ts";
import { HttpError } from "../http.ts";
import { nyClock } from "../hours.ts";
import { clearCatalogCache } from "../rank.ts";
import type { Feedback, Place } from "../schema.ts";
import { cleanFields } from "./submissions.ts";
import type { Body } from "./handler.ts";

export interface ReportGroup {
  place_id: string;
  name: string;
  address: string;
  phone: string;
  hours: string;
  source_url: string;
  last_checked: string;
  issues: Record<string, number>;
  total: number;
  first_at: string;
  last_at: string;
}

export async function listReports(req: Request): Promise<{ reports: ReportGroup[]; open: number }> {
  const db = getDb(req);
  const rows = await db.Feedback.filter({ status: "open" }, "-created_date", 1000);
  const groups = new Map<string, ReportGroup>();
  for (const f of rows) {
    if (!f.place_id || !f.issue) continue;
    const g = groups.get(f.place_id) ?? {
      place_id: f.place_id, name: "", address: "", phone: "", hours: "", source_url: "", last_checked: "",
      issues: {}, total: 0, first_at: f.created_at, last_at: f.created_at,
    };
    g.issues[f.issue] = (g.issues[f.issue] ?? 0) + 1;
    g.total++;
    if (f.created_at < g.first_at) g.first_at = f.created_at;
    if (f.created_at > g.last_at) g.last_at = f.created_at;
    groups.set(f.place_id, g);
  }
  for (const g of groups.values()) {
    try {
      const p = await db.Place.get(g.place_id);
      Object.assign(g, {
        name: p.name, address: p.address ?? "", phone: p.phone ?? "", hours: p.hours ?? "",
        source_url: p.source_url ?? "", last_checked: p.last_checked ?? "",
      });
    } catch {
      g.name = "(place no longer exists)";
    }
  }
  const reports = [...groups.values()].sort((a, b) => b.total - a.total || b.last_at.localeCompare(a.last_at));
  return { reports, open: rows.length };
}

export async function resolveReports(req: Request, body: Body) {
  const db = getDb(req);
  const placeId = typeof body.place_id === "string" ? body.place_id.trim() : "";
  if (!/^place-[a-z0-9-]+$/.test(placeId)) throw new HttpError(400, "place_id is required");
  const open = (await db.Feedback.filter({ place_id: placeId, status: "open" }, "-created_date", 1000)) as Feedback[];
  for (const f of open) await db.Feedback.update(f.id, { status: "resolved" });

  let place: Place | undefined;
  const edits = body.edits && typeof body.edits === "object" && !Array.isArray(body.edits)
    ? cleanFields(body.edits as Body, { partial: true })
    : {};
  if (body.confirmed === true || Object.keys(edits).length) {
    place = await db.Place.update(placeId, { ...edits, last_checked: nyClock().date } as Partial<Place>);
  }
  clearCatalogCache();
  return { ok: true, resolved: open.length, ...(place ? { place } : {}) };
}
