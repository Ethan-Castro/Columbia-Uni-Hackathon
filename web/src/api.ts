// The ONLY place the web app talks to the backend.
//
// Locally every call is POST /functions/<name> with a JSON body (Vite proxies
// /functions to the Deno dev server, see vite.config.ts).
//
// PORTING to Base44: replace the body of `call` with
//
//   import { base44 } from "@/api/base44Client";
//   return base44.functions.invoke(name, body).then((r) => r.data as T);
//
// and drop the admin token: Base44 functions check base44.auth.me() role
// "admin" instead (see shared/auth.ts), so the token helpers become no-ops.

import type {
  Insights,
  ListPlacesResult,
  ReviewActionResult,
  ReviewListResult,
  SubmissionEdits,
  SubmitInput,
  SubmitResult,
} from "./types.ts";

// Where functions live. Locally "/functions/" (Vite proxy). On Base44 the site is
// built with VITE_FUNCTIONS_BASE=/api/apps/<app id>/functions/ (same origin).
const FUNCTIONS_BASE: string = import.meta.env.VITE_FUNCTIONS_BASE || "/functions/";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------- admin token (sessionStorage: gone when the tab closes) ----------

const TOKEN_KEY = "nyc-nav-admin-token";
let memoryToken = ""; // fallback when sessionStorage is blocked

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: token lasts only for this page view */ }
  memoryToken = token;
}

// ---------- transport ----------

async function call<T>(name: string, body: object, opts: { admin?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.admin) headers["x-admin-token"] = getAdminToken();
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE}${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && typeof data.error === "string") ? data.error : `HTTP ${res.status}`);
  return data as T;
}

// ---------- public ----------

export function listPlaces(filters: { need?: string; borough?: string; language?: string; q?: string; ui_language?: string }) {
  const body = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return call<ListPlacesResult>("list_places", body);
}

export function submitResource(input: SubmitInput) {
  return call<SubmitResult>("submit_resource", input);
}

// ---------- admin ----------

export function listSubmissions(status: "pending" | "approved" | "rejected" = "pending") {
  return call<ReviewListResult>("review_queue", { action: "list", status }, { admin: true });
}

export function approveSubmission(id: string, edits: SubmissionEdits = {}) {
  return call<ReviewActionResult>("review_queue", { action: "approve", id, edits }, { admin: true });
}

export function rejectSubmission(id: string) {
  return call<ReviewActionResult>("review_queue", { action: "reject", id }, { admin: true });
}

export function getInsights() {
  return call<Insights>("insights", {}, { admin: true });
}

export function getHealth() {
  return call<{ ok: boolean; counts?: { Program?: number; Place?: number; Link?: number } }>("health", {});
}
