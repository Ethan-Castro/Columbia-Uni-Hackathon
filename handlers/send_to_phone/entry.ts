// POST /functions/send_to_phone -> JSON. Logic lives in shared/tools/send_to_phone.ts.
import { toolFunction } from "../../shared/tools/wrap.ts";
import { sendToPhone } from "../../shared/tools/send_to_phone.ts";

export default toolFunction(sendToPhone);
