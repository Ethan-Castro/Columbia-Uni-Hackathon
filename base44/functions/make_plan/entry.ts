// POST /functions/make_plan -> JSON. Logic lives in shared/tools/make_plan.ts.
import { toolFunction } from "../../shared/tools/wrap.ts";
import { makePlan } from "../../shared/tools/make_plan.ts";

export default toolFunction(makePlan);
