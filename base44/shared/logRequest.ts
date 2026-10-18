// Base44 version of shared/logRequest.ts (copied over it by scripts/base44-sync.ts).
// toLogRow and LogInput come unchanged from the repo-root file, which the sync
// copies next to this one as logRequest.local.ts. Only logRequest differs: the
// write is handed to waitUntil, so a fire-and-forget `void logRequest(...)` is
// not cancelled when the function's response ends.

import { waitUntil } from "base44:runtime";
import { getDb } from "./db.ts";
import { isLoadTest, toLogRow } from "./logRequest.local.ts";
import type { LogInput } from "./logRequest.local.ts";

export * from "./logRequest.local.ts";

async function write(req: Request, input: LogInput): Promise<void> {
  try {
    if (isLoadTest(req)) return;
    await getDb(req).RequestLog.create(toLogRow(input ?? {}));
  } catch (err) {
    console.error("logRequest: write failed:", err instanceof Error ? err.name : "unknown");
  }
}

/** Write one RequestLog row. Never throws or rejects. Kept alive past the response. */
export function logRequest(req: Request, input: LogInput): Promise<void> {
  const p = write(req, input);
  try {
    waitUntil(p);
  } catch {
    // No Base44 host bridge (e.g. a plain Deno run): the promise still runs.
  }
  return p;
}
