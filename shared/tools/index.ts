// Tool registry used by the MCP server. Add each tool here once.
//
// listedTools() is what tools/list returns: each tool's definition plus the
// host-facing extras kept here in one place (not in the tool files):
//   title + annotations   every tool (ChatGPT and the Claude directory require them;
//                         readOnlyHint:false makes ChatGPT confirm, destructiveHint:true makes Claude prompt)
//   outputSchema + _meta  the three UI tools: widget link (MCP Apps + ChatGPT alias) and
//                         the "invoking/invoked" status labels (Spanish, <= 64 chars)
import type { Tool } from "./types.ts";
import { ping } from "./ping.ts";
import { findResources } from "./find_resources.ts";
import { makePlan } from "./make_plan.ts";
import { checkProvider } from "./check_provider.ts";
import { sendToPhone } from "./send_to_phone.ts";
import { reportFeedback } from "./report_feedback.ts";
import { explore } from "./explore.ts";
import { CARD_URI } from "../ui/card.ts";
import { OUTPUT_SCHEMA, UI_KIND } from "../ui/result.ts";

export const TOOLS: Tool[] = [findResources, makePlan, checkProvider, explore, reportFeedback, sendToPhone, ping];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const LISTING: Record<
  string,
  { title: string; annotations: Record<string, boolean>; invoking?: string; invoked?: string }
> = {
  find_resources: {
    title: "Buscar ayuda gratis",
    annotations: READ_ONLY,
    invoking: "Buscando lugares cerca…",
    invoked: "Lugares encontrados",
  },
  make_plan: { title: "Hacer un plan", annotations: READ_ONLY, invoking: "Armando su plan…", invoked: "Plan listo" },
  check_provider: {
    title: "Verificar notario o consultor",
    annotations: READ_ONLY,
    invoking: "Revisando las listas del DOJ…",
    invoked: "Revisión lista",
  },
  explore: { title: "Ver conexiones", annotations: READ_ONLY, invoking: "Buscando conexiones…", invoked: "Conexiones" },
  // Writes one anonymous row; nothing leaves our system.
  report_feedback: {
    title: "Avisar si sirvió",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  // Sends a message that cannot be undone, to an outside number.
  send_to_phone: {
    title: "Enviar por WhatsApp",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    invoking: "Enviando por WhatsApp…",
    invoked: "Enviado",
  },
  ping: { title: "Probar conexión", annotations: READ_ONLY },
};

/** tools/list entries. */
export function listedTools(): Record<string, unknown>[] {
  return TOOLS.map(({ definition: def }) => {
    const extra = LISTING[def.name];
    if (!extra) return { ...def };
    const meta: Record<string, unknown> = {};
    if (UI_KIND[def.name]) {
      meta.ui = { resourceUri: CARD_URI };
      meta["ui/resourceUri"] = CARD_URI; // deprecated alias older hosts still read
      meta["openai/outputTemplate"] = CARD_URI;
    }
    if (extra.invoking) meta["openai/toolInvocation/invoking"] = extra.invoking;
    if (extra.invoked) meta["openai/toolInvocation/invoked"] = extra.invoked;
    return {
      ...def,
      title: extra.title,
      annotations: { ...def.annotations, title: extra.title, ...extra.annotations },
      ...(UI_KIND[def.name] ? { outputSchema: OUTPUT_SCHEMA } : {}),
      ...(Object.keys(meta).length ? { _meta: meta } : {}),
    };
  });
}
