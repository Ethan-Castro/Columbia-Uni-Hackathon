// Stateless MCP server over Streamable HTTP (JSON-RPC 2.0 over POST, no auth).
// Add the URL of this function as a custom connector in Claude or ChatGPT.
//
//   POST  JSON-RPC request        -> 200 application/json response
//   POST  notification (no id)    -> 202, empty body
//   GET / DELETE / others         -> 405 (no SSE stream, no sessions)

import { CORS_HEADERS, json } from "../../shared/http.ts";
import { findTool, TOOLS } from "../../shared/tools/index.ts";
import { logFailedCall } from "../../shared/tools/wrap.ts";

const SERVER_INFO = { name: "nyc-navigator", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const INSTRUCTIONS =
  "Navigator for immigrant New Yorkers: food, legal help, health, benefits, money, school, ID, housing, work, transit. " +
  "Information and referrals only, never legal advice. Never ask about immigration status. " +
  "Answer in the person's language (Spanish by default) and always show each result's source and last-checked date. " +
  "Ask permission before sending anything to a phone.";

type Id = string | number | null;
interface RpcMessage {
  jsonrpc?: string;
  id?: Id;
  method?: unknown;
  params?: Record<string, unknown>;
}

const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function textResult(data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handle(req: Request, msg: RpcMessage): Promise<unknown | null> {
  const isRequest = msg && typeof msg === "object" && "id" in msg && msg.id !== undefined;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isRequest ? rpcError(msg.id ?? null, -32600, "Invalid Request") : null;
  }
  if (!isRequest) return null; // notifications (notifications/initialized, cancelled, ...) get no reply
  const id = msg.id as Id;
  const params = msg.params ?? {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL;
      return rpcResult(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS.map((t) => t.definition) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = findTool(name);
      if (!tool) return rpcResult(id, textResult(`Unknown tool: ${name || "(missing name)"}`, true));
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown>
        : {};
      try {
        const data = await tool.run(req, args, { channel: "mcp" });
        return rpcResult(id, textResult(data));
      } catch (err) {
        logFailedCall(req, args, "mcp", err); // bad input (400) still counts as unmet demand
        const e = err as { expose?: boolean; message?: string };
        const message = e?.expose && e.message ? e.message : "The tool failed. Please try again.";
        if (!e?.expose) console.error(`tools/call ${name} failed:`, err instanceof Error ? err.name : typeof err);
        return rpcResult(id, textResult(message, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return json(rpcError(null, -32000, "Method not allowed. POST JSON-RPC to this endpoint."), 405, {
      allow: "POST, OPTIONS",
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(body)) { // tolerate JSON-RPC batches from older clients
    const out = (await Promise.all(body.map((m) => handle(req, m as RpcMessage)))).filter((r) => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  const reply = await handle(req, body as RpcMessage);
  if (reply === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(reply);
}
