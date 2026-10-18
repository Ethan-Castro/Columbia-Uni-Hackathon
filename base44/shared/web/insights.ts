// Insights over RequestLog for the admin dashboard (functions/insights).
// RequestLog only ever holds needs, zip, language, channel, results_found,
// unmet and created_at, so nothing here can identify a person.
// Everything logged so far is demo/test traffic: test_traffic is always true.

import { requireAdmin } from "../auth.ts";
import { getDb } from "../db.ts";
import { NEIGHBORHOOD_ZIPS } from "../geo.ts";
import { graphNeeds } from "../graph.ts";
import { checkFirst, daysSince, loadCatalog, STALE_DAYS } from "../rank.ts";
import type { Catalog } from "../rank.ts";
import { CHANNELS, NEEDS } from "../schema.ts";
import type { Feedback, RequestLog } from "../schema.ts";
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
  /** Filled by insights(): supply vs demand per neighborhood and need, from the knowledge graph. */
  gaps?: Gap[];
  feedback?: FeedbackStats;
  freshness?: Freshness;
  graph?: { nodes: Record<string, number>; edges: Record<string, number> };
}

/** A neighborhood + need where people asked and we have little or nothing within its zips. */
export interface Gap {
  neighborhood: string;
  need: string;
  places: number; // places serving the need inside the neighborhood's zips
  requests: number; // RequestLog rows for that need from those zips
  unmet: number;
}

export interface FeedbackStats {
  helpful: number;
  not_helpful: number;
  reports_open: number;
  reports_resolved: number;
  by_issue: Count[];
  helpful_by_channel: Array<{ channel: string; helpful: number; not_helpful: number }>;
}

export interface Freshness {
  places: number;
  stale: number; // last_checked older than STALE_DAYS
  seasonal_hours: number;
  no_phone: number;
  no_hours: number;
  by_age: Count[]; // "0-30", "31-90", "91-180", "180+", "unknown" days since last_checked
  oldest: Array<{ id: string; name: string; last_checked: string }>;
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

/**
 * Supply vs demand: for each neighborhood and need, how many places the graph
 * says serve it inside the neighborhood's zips, against how many requests came
 * from there. Gaps first: asked for and nothing there, then thinnest coverage.
 */
export function coverageGaps(cat: Catalog, rows: RequestLog[], limit = 40): Gap[] {
  const zipToHood = new Map<string, string>();
  for (const [hood, zips] of Object.entries(NEIGHBORHOOD_ZIPS)) for (const z of zips) if (!zipToHood.has(z)) zipToHood.set(z, hood);
  const supply = new Map<string, number>();
  for (const p of cat.places) {
    const hood = zipToHood.get(String(p.zip ?? ""));
    if (!hood || cat.graph.people.has(p.id)) continue;
    for (const n of graphNeeds(cat.graph, p.id)) supply.set(`${hood}|${n}`, (supply.get(`${hood}|${n}`) ?? 0) + 1);
  }
  const demand = new Map<string, { requests: number; unmet: number }>();
  for (const r of rows) {
    const hood = zipToHood.get(String(r.zip ?? ""));
    if (!hood) continue;
    for (const n of Array.isArray(r.needs) ? r.needs : []) {
      const d = demand.get(`${hood}|${n}`) ?? { requests: 0, unmet: 0 };
      d.requests++;
      if (r.unmet) d.unmet++;
      demand.set(`${hood}|${n}`, d);
    }
  }
  const out: Gap[] = [];
  for (const hood of Object.keys(NEIGHBORHOOD_ZIPS)) {
    for (const need of NEEDS) {
      const places = supply.get(`${hood}|${need}`) ?? 0;
      const d = demand.get(`${hood}|${need}`) ?? { requests: 0, unmet: 0 };
      // Asked for and thin, or a core need with nothing at all in a neighborhood we cover.
      if ((d.requests && places < 3) || (!places && ["food", "legal", "health"].includes(need))) {
        out.push({ neighborhood: hood, need, places, requests: d.requests, unmet: d.unmet });
      }
    }
  }
  return out.sort((a, b) => b.requests - a.requests || a.places - b.places || b.unmet - a.unmet || a.neighborhood.localeCompare(b.neighborhood))
    .slice(0, limit);
}

export function feedbackStats(rows: Feedback[]): FeedbackStats {
  const byIssue = new Map<string, number>();
  const byChannel = new Map<string, { channel: string; helpful: number; not_helpful: number }>();
  let helpful = 0, notHelpful = 0, open = 0, resolved = 0;
  for (const f of rows) {
    if (f.issue) {
      byIssue.set(f.issue, (byIssue.get(f.issue) ?? 0) + 1);
      if (f.status === "open") open++;
      else resolved++;
    }
    if (typeof f.helpful === "boolean") {
      const c = byChannel.get(f.channel) ?? { channel: f.channel, helpful: 0, not_helpful: 0 };
      if (f.helpful) helpful++, c.helpful++;
      else notHelpful++, c.not_helpful++;
      byChannel.set(f.channel, c);
    }
  }
  return {
    helpful,
    not_helpful: notHelpful,
    reports_open: open,
    reports_resolved: resolved,
    by_issue: sorted(byIssue),
    helpful_by_channel: [...byChannel.values()],
  };
}

export function freshness(cat: Catalog, now = new Date()): Freshness {
  const places = cat.places.filter((p) => !cat.graph.people.has(p.id));
  const ages = new Map<string, number>([["0-30", 0], ["31-90", 0], ["91-180", 0], ["180+", 0], ["unknown", 0]]);
  let stale = 0, seasonal = 0, noPhone = 0, noHours = 0;
  for (const p of places) {
    const d = daysSince(p.last_checked, now);
    const bucket = d === null ? "unknown" : d <= 30 ? "0-30" : d <= 90 ? "31-90" : d <= 180 ? "91-180" : "180+";
    ages.set(bucket, (ages.get(bucket) ?? 0) + 1);
    if (d !== null && d > STALE_DAYS) stale++;
    else if (checkFirst(p, 0, "en", now)) seasonal++;
    if (!p.phone) noPhone++;
    if (!p.hours) noHours++;
  }
  const oldest = [...places].sort((a, b) => String(a.last_checked).localeCompare(String(b.last_checked))).slice(0, 10)
    .map((p) => ({ id: p.id, name: p.name, last_checked: p.last_checked ?? "" }));
  return {
    places: places.length,
    stale,
    seasonal_hours: seasonal,
    no_phone: noPhone,
    no_hours: noHours,
    by_age: [...ages].map(([key, count]) => ({ key, count })),
    oldest,
  };
}

export async function insights(req: Request, _body: Body): Promise<Insights> {
  await requireAdmin(req);
  const db = getDb(req);
  const [rows, feedback, cat] = await Promise.all([
    db.RequestLog.list("-created_at", 5000),
    db.Feedback.list("-created_date", 5000).catch(() => [] as Feedback[]),
    loadCatalog(req),
  ]);
  const nodes: Record<string, number> = {};
  for (const n of cat.graph.nodes.values()) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
  const edges: Record<string, number> = {};
  for (const e of cat.graph.edges) edges[e.source] = (edges[e.source] ?? 0) + 1;
  return {
    ...aggregate(rows),
    gaps: coverageGaps(cat, rows),
    feedback: feedbackStats(feedback),
    freshness: freshness(cat),
    graph: { nodes, edges },
  };
}
