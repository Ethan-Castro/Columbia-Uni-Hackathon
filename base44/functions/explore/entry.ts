// POST /functions/explore -> JSON. Logic lives in shared/tools/explore.ts.
// Body: { place_id? | program?, near?, language? }
import { toolFunction } from "../../shared/tools/wrap.ts";
import { explore } from "../../shared/tools/explore.ts";

export default toolFunction(explore);
