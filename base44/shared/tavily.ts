// Tavily web search + page extraction, with fetch only (no SDK, no deps).
//
//   const hits = await tavilySearch("food pantry Corona Queens", { maxResults: 3 });
//   const pages = await tavilyExtract(hits.map((h) => h.url));
//
// Both calls have a timeout and throw TavilyError (message safe to show
// admins). Needs the TAVILY_API_KEY secret, read inside each call.
//
// PORTING: nothing changes in Base44. Add TAVILY_API_KEY under the app's
// secrets; Deno.env.get reads it there too.

import { getSecret } from "./secrets.ts";

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

export class TavilyError extends Error {
  readonly expose = true; // message is safe to show callers (see errorResponse)
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "TavilyError";
  }
}

export interface SearchHit {
  url: string;
  title: string;
  /** Short snippet Tavily picked from the page. */
  content: string;
  score: number;
}

export interface ExtractedPage {
  url: string;
  raw_content: string;
}

export interface ExtractResult {
  pages: ExtractedPage[];
  failed: string[]; // urls Tavily could not read
}

function apiKey(): string {
  const key = getSecret("TAVILY_API_KEY");
  if (!key) throw new TavilyError("TAVILY_API_KEY is not set. Add it to .env (or Base44 secrets).", 503);
  return key;
}

/** POST JSON to Tavily with a hard timeout. Never logs the key or the body. */
async function post(url: string, body: Record<string, unknown>, timeoutMs: number, what: string): Promise<Record<string, unknown>> {
  const key = apiKey();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new TavilyError(timedOut ? `Tavily ${what} timed out after ${timeoutMs / 1000}s` : `Tavily ${what} failed to connect`, 504);
  }
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !data) {
    const detail = data?.detail as { error?: string } | string | undefined;
    const msg = typeof detail === "string" ? detail : detail?.error ?? `HTTP ${res.status}`;
    // 401/403 = bad key, 429/432/433 = rate or plan limits.
    throw new TavilyError(`Tavily ${what} error: ${String(msg).slice(0, 200)}`, res.status === 401 || res.status === 403 ? 503 : 502);
  }
  return data;
}

/** Web search. Basic depth, no raw page content (extract does that). */
export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; timeoutMs?: number } = {},
): Promise<SearchHit[]> {
  const maxResults = Math.min(10, Math.max(1, Math.floor(opts.maxResults ?? 5)));
  const data = await post(SEARCH_URL, {
    query,
    search_depth: "basic",
    max_results: maxResults,
    include_raw_content: false,
    include_answer: false,
    include_images: false,
  }, opts.timeoutMs ?? 15_000, "search");
  const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
  return results
    .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url as string))
    .slice(0, maxResults)
    .map((r) => ({
      url: r.url as string,
      title: typeof r.title === "string" ? r.title : "",
      content: typeof r.content === "string" ? r.content : "",
      score: typeof r.score === "number" ? r.score : 0,
    }));
}

/** Page text (markdown) for up to 20 urls. Failed urls are listed, not thrown. */
export async function tavilyExtract(urls: string[], opts: { timeoutMs?: number } = {}): Promise<ExtractResult> {
  const list = [...new Set(urls)].slice(0, 20);
  if (!list.length) return { pages: [], failed: [] };
  const data = await post(EXTRACT_URL, {
    urls: list,
    extract_depth: "basic",
    format: "markdown",
    include_images: false,
  }, opts.timeoutMs ?? 30_000, "extract");
  const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
  const pages = results
    .filter((r) => typeof r.url === "string" && typeof r.raw_content === "string" && (r.raw_content as string).trim())
    .map((r) => ({ url: r.url as string, raw_content: r.raw_content as string }));
  const got = new Set(pages.map((p) => p.url));
  return { pages, failed: list.filter((u) => !got.has(u)) };
}
