// POST /functions/report_feedback -> { ok, message }. Logic lives in shared/tools/report_feedback.ts.
// Body: { place_id? | code?, helpful?, issue?, need?, language?, channel? } (no names, phones or free text)
import { toolFunction } from "../../shared/tools/wrap.ts";
import { reportFeedback } from "../../shared/tools/report_feedback.ts";

export default toolFunction(reportFeedback);
