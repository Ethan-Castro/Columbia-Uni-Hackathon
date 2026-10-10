// POST /functions/find_resources -> JSON. Logic lives in shared/tools/find_resources.ts.
import { toolFunction } from "../../shared/tools/wrap.ts";
import { findResources } from "../../shared/tools/find_resources.ts";

export default toolFunction(findResources);
