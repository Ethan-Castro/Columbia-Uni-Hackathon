// GET or POST /functions/health -> { ok, counts, time }.
// Public: counts of the public catalog (Program, Place, Link), the same data
// list_places already shows. Admins (x-admin-token / Base44 admin) also get
// Submission and RequestLog counts, which are not public.
import { isAdmin } from "../../shared/auth.ts";
import { getDb } from "../../shared/db.ts";
import { ENTITY_NAMES } from "../../shared/schema.ts";
import { errorResponse, json } from "../../shared/http.ts";

const PUBLIC_ENTITIES = new Set<string>(["Program", "Place", "Link"]);

export default async function (req: Request): Promise<Response> {
  try {
    const db = getDb(req);
    const admin = await isAdmin(req);
    const counts: Record<string, number> = {};
    for (const name of ENTITY_NAMES) {
      if (admin || PUBLIC_ENTITIES.has(name)) counts[name] = await db[name].count();
    }
    return json({ ok: true, counts, time: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
