// GET or POST /functions/health -> record counts per entity.
import { getDb } from "../../shared/db.ts";
import { ENTITY_NAMES } from "../../shared/schema.ts";
import { errorResponse, json } from "../../shared/http.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const db = getDb(req);
    const counts: Record<string, number> = {};
    for (const name of ENTITY_NAMES) {
      counts[name] = await db[name].count();
    }
    return json({ ok: true, counts, time: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
