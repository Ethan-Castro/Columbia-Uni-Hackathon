// Short memory for a WhatsApp conversation, so a nervous person can answer one
// question at a time ("comida" ... "Corona") instead of putting everything in
// one message.
//
//   const key = await sessionKey(from);        // HMAC of the number: the number itself is never stored
//   const s = await getSession(req, key);      // { needs, near, language } or null (expired / none)
//   await saveSession(req, key, { needs: ["food"], near: "", language: "es" });
//   await clearSession(req, key);
//
// What is kept: the key (an HMAC-SHA256 of the number with a server secret, so it
// cannot be turned back into the number), the needs (fixed words), the place the
// person named (zip / neighborhood / borough label, never a street address), the
// language, and when it expires. Never the message text. Rows expire after
// SESSION_MINUTES, and every write deletes expired rows.

import { getDb } from "./db.ts";
import { getSecret } from "./secrets.ts";
import { NEEDS } from "./schema.ts";
import type { Need, WaSession } from "./schema.ts";

export const SESSION_MINUTES = 30;

export interface SessionState {
  needs: Need[];
  near: string;
  language: "es" | "en";
}

/** HMAC-SHA256(secret, number) as 32 hex chars. null when no secret is configured (then nothing is remembered). */
export async function sessionKey(from: string): Promise<string | null> {
  const secret = getSecret("WHATSAPP_SESSION_SECRET") ?? getSecret("TWILIO_AUTH_TOKEN");
  const number = String(from ?? "").replace(/^whatsapp:/, "").trim();
  if (!secret || !number) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`wa-session:${number}`)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (s: Partial<SessionState>): SessionState => ({
  needs: (Array.isArray(s.needs) ? s.needs : []).filter((n): n is Need => (NEEDS as readonly unknown[]).includes(n)).slice(0, NEEDS.length),
  near: typeof s.near === "string" ? s.near.replace(/[^\p{L}\p{N} ,.'()-]/gu, "").slice(0, 80) : "",
  language: s.language === "en" ? "en" : "es",
});

export async function getSession(req: Request, key: string | null): Promise<SessionState | null> {
  if (!key) return null;
  try {
    const rows = await getDb(req).WaSession.filter({ key }, "-created_date", 1);
    const row = rows[0];
    if (!row || Date.parse(row.expires_at) < Date.now()) return null;
    return clean(row);
  } catch {
    return null; // memory is a convenience: never block an answer
  }
}

export async function saveSession(req: Request, key: string | null, state: Partial<SessionState>): Promise<void> {
  if (!key) return;
  const db = getDb(req);
  const row: Omit<WaSession, "id"> = { key, ...clean(state), expires_at: new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString() };
  try {
    const existing = await db.WaSession.filter({ key }, "-created_date", 5);
    if (existing[0]) await db.WaSession.update(existing[0].id, row);
    else await db.WaSession.create(row);
    for (const extra of existing.slice(1)) await db.WaSession.delete(extra.id);
    await sweepExpired(req);
  } catch (err) {
    console.error("wa-session: save failed:", err instanceof Error ? err.name : "unknown");
  }
}

export async function clearSession(req: Request, key: string | null): Promise<void> {
  if (!key) return;
  try {
    const db = getDb(req);
    for (const row of await db.WaSession.filter({ key }, "-created_date", 5)) await db.WaSession.delete(row.id);
  } catch {
    // nothing to clear
  }
}

/** Delete a few expired rows per write, so the table never holds more than the last half hour. */
async function sweepExpired(req: Request): Promise<void> {
  const db = getDb(req);
  const now = Date.now();
  const old = (await db.WaSession.list("created_date", 20)).filter((r) => Date.parse(r.expires_at) < now);
  for (const r of old) await db.WaSession.delete(r.id);
}
