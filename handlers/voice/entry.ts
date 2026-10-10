// POST /functions/voice -> the closest place to call for what the person said.
// Body: { text, lat, lng, language? }. Logic lives in shared/voice.ts.
import { webFunction } from "../../shared/web/handler.ts";
import { voiceQuery } from "../../shared/voice.ts";

export default webFunction(voiceQuery);
