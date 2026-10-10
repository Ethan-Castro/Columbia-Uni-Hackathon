// Tool registry used by the MCP server. Add each tool here once.
import type { Tool } from "./types.ts";
import { ping } from "./ping.ts";
import { findResources } from "./find_resources.ts";
import { makePlan } from "./make_plan.ts";
import { checkProvider } from "./check_provider.ts";
import { sendToPhone } from "./send_to_phone.ts";

export const TOOLS: Tool[] = [findResources, makePlan, checkProvider, sendToPhone, ping];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}
