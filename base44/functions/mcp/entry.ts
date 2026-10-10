// Stateless MCP server over Streamable HTTP (JSON-RPC 2.0 over POST, no auth).
// Add the URL of this function as a custom connector in Claude or as a custom
// MCP server (plugin) in ChatGPT. Both render the same MCP Apps widget
// (shared/ui/card.ts) for find_resources, make_plan and check_provider.
//
//   POST  JSON-RPC request        -> 200 application/json response
//   POST  notification (no id)    -> 202, empty body
//   POST  modern-era (2026+) call -> 400 -32600, so dual-era clients fall back to initialize
//   GET / DELETE / others         -> 405 (no SSE stream, no sessions)

import { CORS_HEADERS, json } from "../../shared/http.ts";
import { findTool, listedTools } from "../../shared/tools/index.ts";
import { logFailedCall } from "../../shared/tools/wrap.ts";
import { CARD_HTML, CARD_META, CARD_MIME, CARD_RESOURCE, CARD_URI } from "../../shared/ui/card.ts";
import { fromChatGPT, toolResult } from "../../shared/ui/result.ts";

const SERVER_INFO = { name: "nyc-navigator", title: "Navegador NYC", version: "1.1.0" };
/** Initialize-era protocol revisions we speak. Unknown requested versions get the latest. */
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = SUPPORTED[0];
// Hosts show the first ~512 characters, so the critical rules come first.
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

/**
 * A request from a modern-era (2026-07-28+) client that skipped initialize. A plain
 * 400 / -32600 makes a dual-era client fall back to initialize; initialize itself
 * is never rejected. Legacy clients send a supported MCP-Protocol-Version header.
 */
function isModernProbe(req: Request, msg: RpcMessage): boolean {
  if (msg?.method === "initialize") return false;
  const header = req.headers.get("mcp-protocol-version") ?? "";
  const meta = msg?.params?._meta as Record<string, unknown> | undefined;
  return (/^\d{4}-\d{2}-\d{2}$/.test(header) && header > DEFAULT_PROTOCOL) ||
    !!(meta && typeof meta === "object" && "io.modelcontextprotocol/protocolVersion" in meta);
}

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
      const requested = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: typeof requested === "string" && SUPPORTED.includes(requested) ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "logging/setLevel":
      return rpcResult(id, {});
    case "prompts/list": // some clients ask even though we declare no prompts
      return rpcResult(id, { prompts: [] });
    case "resources/list":
      return rpcResult(id, { resources: [CARD_RESOURCE] });
    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: [] });
    case "resources/read":
      if (params.uri !== CARD_URI) return rpcError(id, -32002, "Resource not found");
      return rpcResult(id, { contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: CARD_HTML, _meta: CARD_META }] });
    case "tools/list":
      return rpcResult(id, { tools: listedTools() });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = findTool(name);
      if (!tool) return rpcResult(id, textResult(`Unknown tool: ${name || "(missing name)"}`, true));
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown>
        : {};
      try {
        const data = await tool.run(req, args, { channel: "mcp" });
        // ChatGPT's model reads structuredContent, so it does not need the JSON copy in content.
        return rpcResult(id, toolResult(name, data, { compactJson: !fromChatGPT(params) }));
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

  if (!Array.isArray(body) && isModernProbe(req, body as RpcMessage)) {
    const id = (body as RpcMessage)?.id ?? null;
    return json(rpcError(id, -32600, `This server speaks MCP ${DEFAULT_PROTOCOL} and earlier; send initialize`), 400);
  }

  const reply = await handle(req, body as RpcMessage);
  if (reply === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(reply);
}
