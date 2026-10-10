// Admin check for review-queue and insights functions.
//
// Locally: header x-admin-token must equal the ADMIN_TOKEN secret.
//
// PORTING: in Base44, replace the body with:
//
//   const user = await createClientFromRequest(req).auth.me();
//   if (user?.role !== "admin") throw new HttpError(401, "Admin only");
//
// It is async so call sites (`await requireAdmin(req)`) stay the same.

import { HttpError } from "./http.ts";
import { getSecret } from "./secrets.ts";

/** Compare two strings in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Throws HttpError(401) unless the request carries the admin token. */
export function requireAdmin(req: Request): Promise<void> {
  const expected = getSecret("ADMIN_TOKEN");
  if (!expected) return Promise.reject(new HttpError(503, "Admin access is not configured"));
  const given = req.headers.get("x-admin-token") ?? "";
  if (!given || !timingSafeEqual(given, expected)) return Promise.reject(new HttpError(401, "Admin only"));
  return Promise.resolve();
}

/** Same check as a boolean, for pages that show extra data to admins. */
export async function isAdmin(req: Request): Promise<boolean> {
  try {
    await requireAdmin(req);
    return true;
  } catch {
    return false;
  }
}
