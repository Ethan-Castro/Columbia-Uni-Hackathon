// Turn a Tool into its own HTTP function (JSON in, JSON out):
//
//   // functions/find_resources/entry.ts
//   import { toolFunction } from "../../shared/tools/wrap.ts";
//   import { findResources } from "../../shared/tools/find_resources.ts";
//   export default toolFunction(findResources);
//
// OPTIONS -> 204 (CORS), POST only, body must be a JSON object. The body's
// `channel` (mcp|whatsapp|voice|web) is used for RequestLog; default "web".
// The caller picks the channel, so the insights channel mix is self-reported
// (fine for a demo labeled "Test traffic"; a WhatsApp/voice bridge should set
// it behind a shared secret before real use).
//
// Logging: a successful tool call writes its own row. A call the tool rejects
// as bad input (HTTP 400: unknown need, missing near...) writes one row here
// via logFailedCall, so requests we could not understand still show up as
// unmet demand. ping and server errors (5xx) are not logged.

import { CORS_HEADERS, errorResponse, HttpError, json, readJson } from "../http.ts";
import { logRequest } from "../logRequest.ts";
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
      let result: unknown;
      try {
        result = await tool.run(req, input, { channel });
      } catch (err) {
        logFailedCall(req, input, channel, err);
        throw err;
      }
      return json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * One anonymous RequestLog row for a tool call rejected as bad input (status
 * 400): needs [], results_found 0, unmet true. Only a 5-digit zip and a
 * language code survive toLogRow's whitelist; nothing else from the input.
 */
export function logFailedCall(req: Request, input: Record<string, unknown>, channel: Channel, err: unknown): void {
  if ((err as { status?: unknown } | null)?.status !== 400) return;
  void logRequest(req, {
    needs: [],
    zip: typeof input.near === "string" ? input.near.trim() : "",
    language: input.language ?? "es",
    channel,
    results_found: 0,
    unmet: true,
  });
}
