// Shared shape for every navigator tool. Each tool lives in shared/tools/<name>.ts
// and is used two ways: by its own function (functions/<name>/entry.ts, JSON in,
// JSON out) and by the MCP server (functions/mcp/entry.ts) through the registry.

import type { Channel } from "../schema.ts";

export interface ToolContext {
  /** Where the request came from; written to RequestLog. */
  channel: Channel;
}

export interface ToolDefinition {
  name: string;
  /** Plain words with trigger phrases in English and Spanish. This IS the prompt. */
  description: string;
  /** JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  /** Throw HttpError(400, ...) for bad input. Returns plain JSON data. */
  run(req: Request, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}
