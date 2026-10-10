// Base44 version of shared/auth.ts (copied over it by scripts/base44-sync.ts).
// Everything else (timingSafeEqual, ...) comes unchanged from the repo-root file,
// copied next to this one as auth.local.ts.
//
// Admin = EITHER the x-admin-token header equals the ADMIN_TOKEN secret (our web
// admin page uses this) OR the caller is a signed-in Base44 user with role "admin".

import { createClientFromRequest } from "npm:@base44/sdk@0.8.53";
import { HttpError } from "./http.ts";
import { getSecret } from "./secrets.ts";
import { timingSafeEqual } from "./auth.local.ts";

export * from "./auth.local.ts";

function hasAdminToken(req: Request): boolean {
  const expected = getSecret("ADMIN_TOKEN");
  const given = req.headers.get("x-admin-token") ?? "";
  return Boolean(expected && given && timingSafeEqual(given, expected));
}

async function isBase44Admin(req: Request): Promise<boolean> {
  if (!req.headers.get("Authorization")) return false; // anonymous caller
  try {
    const user = await createClientFromRequest(req).auth.me();
    return (user as { role?: unknown } | null)?.role === "admin";
  } catch {
    return false;
  }
}

/** Throws HttpError(401) unless the caller is an admin (token or Base44 admin user). */
export async function requireAdmin(req: Request): Promise<void> {
  if (hasAdminToken(req)) return;
  if (await isBase44Admin(req)) return;
  if (!getSecret("ADMIN_TOKEN") && !req.headers.get("Authorization")) {
    throw new HttpError(503, "Admin access is not configured");
  }
  throw new HttpError(401, "Admin only");
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
