// POST /functions/submit_resource -> new pending Submission (public form).
// Body: { name, address, org?, org_type?, borough?, zip?, hours?, languages?, phone?,
//         needs?, source_url?, notes?, website (honeypot, must be empty), ui_language? }
import { webFunction } from "../../shared/web/handler.ts";
import { submitResource } from "../../shared/web/submissions.ts";

export default webFunction(submitResource);
