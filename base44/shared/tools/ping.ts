// ping: connectivity check for MCP clients.
import type { Tool } from "./types.ts";

export const ping: Tool = {
  definition: {
    name: "ping",
    description: "Connectivity check. Returns pong and the server time. Use only when asked to test the connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  run() {
    return Promise.resolve({ pong: true, server: "nyc-navigator", time: new Date().toISOString() });
  },
};
