// POST /functions/insights (admin: x-admin-token header) -> RequestLog aggregates.
// Body: {}
import { webFunction } from "../../shared/web/handler.ts";
import { insights } from "../../shared/web/insights.ts";

export default webFunction(insights);
