// POST /functions/review_queue (admin: x-admin-token header).
// Body: { action: "list", status? } | { action: "approve", id, edits? } | { action: "reject", id }
import { webFunction } from "../../shared/web/handler.ts";
import { reviewQueue } from "../../shared/web/submissions.ts";

export default webFunction(reviewQueue);
