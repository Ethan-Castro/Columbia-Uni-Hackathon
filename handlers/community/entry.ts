// POST /functions/community -> community page posts (discussion only, never directory results).
// Body: { action: "list" } | { action: "post", kind, body, need?, zip?, parent_id?, website (honeypot) }
//       | { action: "hide", id } (admin: x-admin-token header)
import { webFunction } from "../../shared/web/handler.ts";
import { community } from "../../shared/web/community.ts";

export default webFunction(community);
