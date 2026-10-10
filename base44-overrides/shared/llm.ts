// Base44 version of shared/llm.ts (copied over it by scripts/base44-sync.ts).
// Same exports (InvokeLLMParams, LLMError, invokeLLM). The repo-root file is
// copied next to this one as llm.local.ts.
//
// Which model answers:
//   - OPENROUTER_API_KEY set as a Base44 secret -> the repo-root OpenRouter call
//     (measured ~2s per call with reasoning off; what we demo with).
//   - otherwise -> Base44's built-in Core.InvokeLLM integration (no key needed,
//     uses the app's integration credits; latency not measured yet).
// The local-only `signal` is dropped for InvokeLLM (it takes no AbortSignal);
// the caller's timeout (rank.llmJson Promise.race) still caps the wait.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.53";
import { getSecret } from "./secrets.ts";
import { invokeLLM as openRouterLLM, LLMError } from "./llm.local.ts";
import type { InvokeLLMParams } from "./llm.local.ts";

export * from "./llm.local.ts";

export function invokeLLM(
  req: Request,
  params: InvokeLLMParams & { response_json_schema: Record<string, unknown> },
): Promise<Record<string, unknown>>;
export function invokeLLM(req: Request, params: InvokeLLMParams): Promise<string>;
export async function invokeLLM(req: Request, params: InvokeLLMParams): Promise<string | Record<string, unknown>> {
  if (getSecret("OPENROUTER_API_KEY")) return await openRouterLLM(req, params);
  if (!params?.prompt) throw new LLMError("invokeLLM: prompt is required", 400);

  const { signal: _signal, ...rest } = params;
  let out: unknown;
  try {
    out = await createClientFromRequest(req).asServiceRole.integrations.Core.InvokeLLM(rest);
  } catch (err) {
    const status = (err as { status?: unknown })?.status;
    console.error("invokeLLM: Base44 InvokeLLM failed", typeof status === "number" ? status : err instanceof Error ? err.name : "");
    throw new LLMError("The AI service is unavailable right now.", typeof status === "number" && status >= 400 ? status : 502);
  }
  if (!params.response_json_schema) return typeof out === "string" ? out : JSON.stringify(out ?? "");
  if (out && typeof out === "object" && !Array.isArray(out)) return out as Record<string, unknown>;
  if (typeof out === "string") {
    try {
      const v = JSON.parse(out.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* fall through */ }
  }
  throw new LLMError("Model did not return valid JSON for response_json_schema", 502);
}
