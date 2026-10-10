// LLM calls, shaped like Base44's Core.InvokeLLM:
//   invokeLLM(req, { prompt, response_json_schema?, add_context_from_internet?, file_urls? })
//   -> string, or a parsed object when response_json_schema is given.
//
// PORTING: in Base44, replace the body of invokeLLM with one line:
//
//   return await createClientFromRequest(req).asServiceRole.integrations.Core.InvokeLLM(params);
//
// `req` is unused locally but required, so call sites stay the same after the port.
// There is deliberately no `model` param: Base44 only accepts its own preset
// ids and picks a good one when it is omitted. Locally set OPENROUTER_MODEL.
//
// Locally this calls OpenRouter's OpenAI-compatible chat completions API with
// fetch (no SDK, no deps). Default model is fast for live demos; override with
// OPENROUTER_MODEL (any id from https://openrouter.ai/models).

import { getSecret, requireSecret } from "./secrets.ts";

export interface InvokeLLMParams {
  prompt: string;
  response_json_schema?: Record<string, unknown>;
  /** Base44 only (web grounding). Ignored locally. */
  add_context_from_internet?: boolean;
  /** Base44 only (uploaded files). Ignored locally. */
  file_urls?: string[];
  /** Local only: abort the HTTP call (llmJson passes a timeout). The Base44 override drops it. */
  signal?: AbortSignal;
}

const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

export class LLMError extends Error {
  readonly expose = true; // message is safe to show callers
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "LLMError";
  }
}

/** Strict structured outputs want closed objects; add additionalProperties:false where unset. */
function closeObjects(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) out[k] = closeObjects(v);
  if (out.type === "object" && !("additionalProperties" in out)) out.additionalProperties = false;
  return out;
}

/** Pull a JSON object out of model text (tolerates ```json fences or stray prose). */
function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try next */ }
  }
  return null;
}

export function invokeLLM(
  req: Request,
  params: InvokeLLMParams & { response_json_schema: Record<string, unknown> },
): Promise<Record<string, unknown>>;
export function invokeLLM(req: Request, params: InvokeLLMParams): Promise<string>;
export async function invokeLLM(_req: Request, params: InvokeLLMParams): Promise<string | Record<string, unknown>> {
  if (!params?.prompt) throw new LLMError("invokeLLM: prompt is required", 400);

  let apiKey: string;
  try {
    apiKey = requireSecret("OPENROUTER_API_KEY");
  } catch {
    throw new LLMError("OPENROUTER_API_KEY is not set. Add it to .env (see .env.example).", 503);
  }

  const body: Record<string, unknown> = {
    model: getSecret("OPENROUTER_MODEL") || DEFAULT_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: params.prompt }],
    // Hidden reasoning tokens made each call 5-8s (most of the answer); off, a call takes ~2s.
    reasoning: { enabled: false },
  };
  if (params.response_json_schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema: closeObjects(params.response_json_schema) },
    };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-title": "nyc-navigator",
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !data || data.error) {
    const msg = (data?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new LLMError(`OpenRouter error: ${msg}`, res.status >= 500 || res.ok ? 502 : res.status);
  }

  const choice = (data.choices as Array<{ message?: { content?: unknown; refusal?: unknown } }> | undefined)?.[0];
  if (choice?.message?.refusal) throw new LLMError("The model declined this request.", 422);
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
    ? content.map((p) => (p as { text?: string })?.text ?? "").join("")
    : "";

  if (!params.response_json_schema) return text;
  const parsed = parseJson(text);
  if (!parsed) throw new LLMError("Model did not return valid JSON for response_json_schema", 502);
  return parsed;
}
