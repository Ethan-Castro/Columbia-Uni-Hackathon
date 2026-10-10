// Anonymous request logging for the insights dashboard.
// Keeps ONLY: needs, zip, language, channel, results_found, unmet, created_at.
// Never names, phones, addresses, or free text. Anything else passed in is dropped.
//
// PORTING: in Base44, wrap the write in waitUntil so it never delays the answer:
//
//   import { waitUntil } from "base44:runtime";
//   waitUntil(logRequest(req, input));   // at the call site, or inside logRequest
//
// (On legacy v1/v2 backends without base44:runtime, keep this fire-and-forget form.)
// `req` is required: on Base44, getDb(req) needs the real incoming request.

import { getDb } from "./db.ts";
import { CHANNELS, NEEDS } from "./schema.ts";
import type { Channel, Need, RequestLog } from "./schema.ts";

export interface LogInput {
  needs?: unknown;
  zip?: unknown;
  language?: unknown;
  channel?: unknown;
  results_found?: unknown;
  unmet?: unknown;
}

/** Build the whitelisted row. Exported for tests. */
export function toLogRow(input: LogInput): Omit<RequestLog, "id"> {
  const rawNeeds = Array.isArray(input.needs) ? input.needs : input.needs ? [input.needs] : [];
  const needs = rawNeeds.filter((n): n is Need => (NEEDS as readonly unknown[]).includes(n));
  // zip: 5 digits only, so a stray address or phone can never be stored.
  const zip = typeof input.zip === "string" && /^\d{5}$/.test(input.zip.trim()) ? input.zip.trim() : "";
  // language: a short code like "es", "en", "qu", "es-MX".
  const language = typeof input.language === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.language)
    ? input.language
    : "";
  const channel = (CHANNELS as readonly unknown[]).includes(input.channel) ? input.channel as Channel : "web";
  const n = Number(input.results_found);
  const results_found = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return {
    needs,
    zip,
    language,
    channel,
    results_found,
    unmet: input.unmet === true,
    created_at: new Date().toISOString(),
  };
}

/**
 * Write one RequestLog row. Never throws or rejects, even if getDb(req) throws
 * synchronously (as createClientFromRequest does on Base44 without app headers).
 * Returns the promise so callers may await it in tests; tools should call it
 * without awaiting (fire-and-forget).
 */
export async function logRequest(req: Request, input: LogInput): Promise<void> {
  try {
    await getDb(req).RequestLog.create(toLogRow(input ?? {}));
  } catch (err) {
    console.error("logRequest: write failed:", err instanceof Error ? err.name : "unknown");
  }
}
