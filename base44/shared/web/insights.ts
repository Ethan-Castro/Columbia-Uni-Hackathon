// Insights over RequestLog for the admin dashboard (functions/insights).
// RequestLog only ever holds needs, zip, language, channel, results_found,
// unmet and created_at, so nothing here can identify a person.
// Everything logged so far is demo/test traffic: test_traffic is always true.

import { requireAdmin } from "../auth.ts";
import { getDb } from "../db.ts";
import { CHANNELS, NEEDS } from "../schema.ts";
import type { RequestLog } from "../schema.ts";
import type { Body } from "./handler.ts";

export interface Count {
  key: string;
  count: number;
}

export interface ZipCount {
  zip: string; // "" when the request had no zip
  unmet: number;
  total: number;
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
  unmet_by_zip: ZipCount[];
  languages: Count[];
  channels: Count[];
  by_day: Count[];
}

function sorted(map: Map<string, number>): Count[] {
  return [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Pure aggregation, exported for tests. */
export function aggregate(rows: RequestLog[]): Insights {
  const byNeed = new Map<string, number>(NEEDS.map((n) => [n, 0]));
  const unmetByNeed = new Map<string, number>();
  const zips = new Map<string, ZipCount>();
  const languages = new Map<string, number>();
  const channels = new Map<string, number>(CHANNELS.map((c) => [c, 0]));
  const days = new Map<string, number>();
  let unmetTotal = 0, found = 0;
  let first: string | null = null, last: string | null = null;

  for (const r of rows) {
    const needs = Array.isArray(r.needs) ? r.needs : [];
    for (const n of needs) byNeed.set(n, (byNeed.get(n) ?? 0) + 1);
    if (r.unmet) {
      unmetTotal++;
      for (const n of needs) unmetByNeed.set(n, (unmetByNeed.get(n) ?? 0) + 1);
    }
    found += Number(r.results_found) || 0;

    const zip = typeof r.zip === "string" ? r.zip : "";
    const z = zips.get(zip) ?? { zip, unmet: 0, total: 0 };
    z.total++;
    if (r.unmet) z.unmet++;
    zips.set(zip, z);

    const lang = r.language || "unknown";
    languages.set(lang, (languages.get(lang) ?? 0) + 1);
    channels.set(r.channel || "web", (channels.get(r.channel || "web") ?? 0) + 1);

    const at = r.created_at || r.created_date || "";
    if (at) {
      if (!first || at < first) first = at;
      if (!last || at > last) last = at;
      const day = at.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
  }

  return {
    test_traffic: true,
    total: rows.length,
    unmet_total: unmetTotal,
    results_found_total: found,
    first_at: first,
    last_at: last,
    by_need: sorted(byNeed),
    unmet_by_need: sorted(unmetByNeed),
    // Zips with unmet requests first (most unmet), then the rest by volume.
    unmet_by_zip: [...zips.values()].sort((a, b) => b.unmet - a.unmet || b.total - a.total || a.zip.localeCompare(b.zip)),
    languages: sorted(languages),
    channels: sorted(channels),
    by_day: [...days].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function insights(req: Request, _body: Body): Promise<Insights> {
  await requireAdmin(req);
  const rows = await getDb(req).RequestLog.list("-created_at", 5000);
  return aggregate(rows);
}
