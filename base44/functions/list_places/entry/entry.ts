// POST /functions/list_places -> public directory (see shared/web/directory.ts).
// Body: { need?, borough?, language?, q?, ui_language? }
import { webFunction } from "../../shared/web/handler.ts";
import { listPlaces } from "../../shared/web/directory.ts";

export default webFunction(listPlaces);
