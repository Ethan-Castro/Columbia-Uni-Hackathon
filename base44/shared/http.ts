// Small HTTP helpers shared by every function.

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

export class HttpError extends Error {
  readonly expose = true; // message is safe to show callers (see errorResponse)
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** JSON response with CORS headers. */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, ...headers } });
}

/** Parse a JSON body. Throws HttpError(400) on empty or invalid JSON. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, "Could not read request body");
  }
  if (!text.trim()) throw new HttpError(400, "Request body must be JSON");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

/**
 * Turn any thrown error into a JSON response. Only our own errors
 * (HttpError, DbError, LLMError: `expose = true`) show their message; others,
 * such as Base44 SDK errors after the port, keep their status but get a
 * generic message so platform details never reach public callers.
 */
export function errorResponse(err: unknown): Response {
  const e = err as { status?: unknown; expose?: unknown } | null;
  const status = typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;
  if (e?.expose === true && err instanceof Error) return json({ error: err.message }, status);
  console.error("Unhandled error:", err instanceof Error ? err.name : typeof err, status);
  return json({ error: status < 500 ? "Request failed" : "Internal error" }, status);
}
