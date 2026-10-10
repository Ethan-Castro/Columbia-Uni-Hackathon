// POST /functions/draft_resource -> a draft for the Submit form (nothing saved).
// Body: { url?, text?, ui_language? }. Logic lives in shared/web/draft.ts.
import { webFunction } from "../../shared/web/handler.ts";
import { draftResource } from "../../shared/web/draft.ts";

export default webFunction(draftResource);
