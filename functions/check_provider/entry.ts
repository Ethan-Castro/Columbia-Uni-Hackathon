// POST /functions/check_provider -> JSON. Logic lives in shared/tools/check_provider.ts.
import { toolFunction } from "../../shared/tools/wrap.ts";
import { checkProvider } from "../../shared/tools/check_provider.ts";

export default toolFunction(checkProvider);
