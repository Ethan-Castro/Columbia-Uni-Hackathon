// POST /functions/scout  (admin only: header x-admin-token)
//   { "query": "food pantry Corona Queens", "max_results": 5, "dry_run": false }
// -> { query, searched, extracted, drafted, skipped_duplicates, submissions: [{ id, name, source_url }], ... }
//
// Searches the web (Tavily), reads the top pages, drafts Place-shaped records
// with ONE LLM call, and saves new ones as Submission { status: "pending",
// trust: "unverified" } for the admin review queue. Never writes to Place.
// dry_run: true returns the drafts and writes nothing. Logic: shared/scout.ts.
//
// Also accepts { "args": { ... } }, the body shape Base44 automations send
// (function_args arrive as body.args).
//
// NIGHTLY AUTOMATION (Base44): functions/scout/function.jsonc defines 4 cron
// automations, one query each, staggered 10 min apart from 07:00 UTC
// (3:00 AM New York in summer). Format checked against
// https://docs.base44.com/developers/backend/resources/backend-functions/automations
//   { "name": "scout", "entry": "entry.ts", "automations": [ {
//       "type": "scheduled", "name": "scout_food_pantry_corona",
//       "function_args": { "query": "food pantry Corona Queens", "max_results": 5 },
//       "schedule_mode": "recurring", "schedule_type": "cron", "cron_expression": "0 7 * * *" }, ... ] }
// Queries: food pantry Corona Queens; free immigration legal help Queens;
// WIC clinic Queens; IDNYC enrollment Queens.
// Notes from the docs: one run may last at most 3 min; minimum interval 5 min;
// each run costs 1 integration credit; needs Builder plan or higher; deploy
// fails with HTTP 409 if the app has Workflows enabled (then recreate the
// schedule as a Workflow and delete the "automations" block).
//
// AUTH: an admin (x-admin-token, or a Base44 admin user after the port), OR a
// scheduled run carrying the SCOUT_TOKEN secret. Base44 automations cannot set
// headers, so the token travels in the body: function_args.scout_token (arrives
// as body.args.scout_token), body.scout_token, or header x-scout-token.
// Compared in constant time. With SCOUT_TOKEN unset, only admins can run Scout.
// To turn the nightly runs on in Base44: `base44 secrets set SCOUT_TOKEN=...`,
// put the same value in each schedule's function_args.scout_token in the Base44
// dashboard (never commit it into function.jsonc), then set is_active true.
// This app uses Base44 Workflows, which reject legacy "automations" (HTTP 409),
// so scripts/base44-sync.ts strips them; recreate the 4 schedules as Workflows
// that POST the same body. See PORTING.md.
//
// Submission.jsonc has the optional "notes" and "needs" fields Scout writes.
// Add TAVILY_API_KEY to Base44 secrets.

import { requireAdmin, timingSafeEqual } from "../../shared/auth.ts";
import { getSecret } from "../../shared/secrets.ts";
import { CORS_HEADERS, errorResponse, HttpError, json, readJson } from "../../shared/http.ts";
import { runScout } from "../../shared/scout.ts";

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed. POST a JSON object.");
    const body = await readJson<unknown>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Request body must be a JSON object");
    }
    const b = body as Record<string, unknown>;
    const { scout_token: _t, ...input } = b.args && typeof b.args === "object" && !Array.isArray(b.args)
      ? b.args as Record<string, unknown>
      : b;
    if (!hasScoutToken(req, b)) await requireAdmin(req);
    return json(await runScout(req, input));
  } catch (err) {
    return errorResponse(err);
  }
}

/** True when the request carries the SCOUT_TOKEN secret (scheduled runs). False when the secret is unset. */
function hasScoutToken(req: Request, body: Record<string, unknown>): boolean {
  const expected = getSecret("SCOUT_TOKEN");
  if (!expected) return false;
  const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {};
  const given = [args.scout_token, body.scout_token, req.headers.get("x-scout-token")]
    .find((v) => typeof v === "string" && v) as string | undefined;
  return Boolean(given && timingSafeEqual(given, expected));
}
