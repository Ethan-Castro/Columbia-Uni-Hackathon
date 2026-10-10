// Wrapper for the web app's functions (list_places, submit_resource,
// review_queue, insights). Same contract as shared/tools/wrap.ts:
// OPTIONS -> 204 (CORS), POST only, body must be a JSON object, errors go
// through errorResponse.
//
//   export default webFunction(async (req, body) => ({ ok: true }));
//
// CORS also allows the x-admin-token header the admin pages send.
// PORTING: in Base44 the frontend calls base44.functions.invoke(name, body),
// so CORS and x-admin-token stop mattering (see shared/auth.ts).

import { CORS_HEADERS, errorResponse, HttpError, json, readJson } from "../http.ts";

export type Body = Record<string, unknown>;

export const WEB_CORS_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "access-control-allow-headers": `${CORS_HEADERS["access-control-allow-headers"]}, x-admin-token`,
};

export function webFunction(
  handler: (req: Request, body: Body) => Promise<unknown>,
): (req: Request) => Promise<Response> {
  return async function (req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: WEB_CORS_HEADERS });
    try {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed. POST a JSON object.");
      const body = await readJson<unknown>(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "Request body must be a JSON object");
      }
      return json(await handler(req, body as Body), 200, WEB_CORS_HEADERS);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
