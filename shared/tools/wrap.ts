// Turn a Tool into its own HTTP function (JSON in, JSON out):
//
//   // functions/find_resources/entry.ts
//   import { toolFunction } from "../../shared/tools/wrap.ts";
//   import { findResources } from "../../shared/tools/find_resources.ts";
//   export default toolFunction(findResources);
//
// OPTIONS -> 204 (CORS), POST only, body must be a JSON object. The body's
// `channel` (mcp|whatsapp|voice|web) is used for RequestLog; default "web".

import { CORS_HEADERS, errorResponse, HttpError, json, readJson } from "../http.ts";
import { CHANNELS } from "../schema.ts";
import type { Channel } from "../schema.ts";
import type { Tool } from "./types.ts";

export function toolFunction(tool: Tool): (req: Request) => Promise<Response> {
  return async function (req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed. POST a JSON object.");
      const body = await readJson<unknown>(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "Request body must be a JSON object");
      }
      const input = body as Record<string, unknown>;
      const channel: Channel = (CHANNELS as readonly unknown[]).includes(input.channel)
        ? input.channel as Channel
        : "web";
      const result = await tool.run(req, input, { channel });
      return json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
