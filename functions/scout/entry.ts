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
// PORTING:
//  - requireAdmin becomes base44.auth.me() role === "admin" (shared/auth.ts).
//    A scheduled run has no signed-in admin, so in Base44 let a request with
//    body.args through only when it comes from the automation (check how the
//    platform marks automation calls; the docs do not say). Until confirmed,
//    run Scout from the admin page and leave is_active false.
//  - Submission.jsonc needs two optional fields Scout writes: "notes" (string)
//    and "needs" (array of need enums). Base44 may drop unknown fields.
//  - Add TAVILY_API_KEY to Base44 secrets.

import { requireAdmin } from "../../shared/auth.ts";
import { CORS_HEADERS, errorResponse, HttpError, json, readJson } from "../../shared/http.ts";
import { runScout } from "../../shared/scout.ts";

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed. POST a JSON object.");
    await requireAdmin(req);
    const body = await readJson<unknown>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Request body must be a JSON object");
    }
    const b = body as Record<string, unknown>;
    const input = b.args && typeof b.args === "object" && !Array.isArray(b.args)
      ? b.args as Record<string, unknown>
      : b;
    return json(await runScout(req, input));
  } catch (err) {
    return errorResponse(err);
  }
}
