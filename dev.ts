// Local dev server. Mimics Base44 function hosting:
//   POST|GET|... /functions/<name>[/sub/path]        -> handlers/<name>/entry.ts
//   POST|GET|... /api/apps/<appId>/functions/<name>  -> same (Base44's alternate path)
//   GET /                                            -> JSON list of functions
// Every method is passed through; each function decides what it accepts.
// Logs method, path, status and ms only. Never bodies or query strings.

import { CORS_HEADERS } from "./shared/http.ts";

type Handler = (req: Request) => Promise<Response> | Response;

const ROOT = new URL("./", import.meta.url);
const FUNCTIONS_DIR = new URL("./handlers/", ROOT);
// Flat function names only (health, mcp, findResources). Base44 also allows
// nested names like email/send; we don't use them.
const NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Tiny .env parser for local dev. Supports KEY=VALUE, comments, blank lines,
 * optional quotes and `export `. Existing environment variables win over the
 * file. Returns the names it set (never values).
 */
async function loadDotEnv(path: URL): Promise<string[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const set: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    let value = rest;
    const quoted = value.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
    if (quoted) value = quoted[2];
    else if (/^['"]/.test(value)) {
      console.warn(`.env: unterminated quote for ${key}, skipped`);
      continue;
    } else value = value.replace(/\s+#.*$/, "").trim();
    if (Deno.env.get(key) !== undefined) continue;
    if (value === "") continue;
    Deno.env.set(key, value);
    set.push(key);
  }
  return set;
}

const loadedKeys = await loadDotEnv(new URL(".env", ROOT));
if (loadedKeys.length) console.log(`Loaded ${loadedKeys.length} keys from .env: ${loadedKeys.join(", ")}`);

const handlers = new Map<string, Promise<Handler>>();

async function listFunctions(): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
      if (!entry.isDirectory || !NAME_RE.test(entry.name)) continue;
      try {
        await Deno.stat(new URL(`${entry.name}/entry.ts`, FUNCTIONS_DIR));
        names.push(entry.name);
      } catch { /* no entry.ts */ }
    }
  } catch { /* no functions dir */ }
  return names.sort();
}

async function loadHandler(name: string): Promise<Handler | null> {
  const file = new URL(`${name}/entry.ts`, FUNCTIONS_DIR);
  try {
    await Deno.stat(file);
  } catch {
    return null;
  }
  if (!handlers.has(name)) {
    const p = import(file.href).then((mod) => {
      if (typeof mod.default !== "function") {
        throw new Error(`handlers/${name}/entry.ts has no default export function`);
      }
      return mod.default as Handler;
    });
    p.catch(() => handlers.delete(name)); // retry next request after a fix
    handlers.set(name, p);
  }
  return await handlers.get(name)!;
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function notFound(message = "Not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

/** Extract the function name from /functions/<name>/... or /api/apps/<id>/functions/<name>/... */
function functionName(pathname: string): string | null | undefined {
  const m = pathname.match(/^\/(?:api\/apps\/[^/]+\/)?functions\/([^/]*)(?:\/.*)?$/);
  if (!m) return undefined; // not a function route
  return NAME_RE.test(m[1]) ? m[1] : null; // null = bad name
}

async function route(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
    const functions = await listFunctions();
    return Response.json({
      name: "Corona services map (local dev)",
      functions: functions.map((f) => ({ name: f, path: `/functions/${f}` })),
    });
  }

  const name = functionName(pathname);
  if (name === undefined) return notFound();
  if (name === null) return notFound("Unknown function");

  let handler: Handler | null;
  try {
    handler = await loadHandler(name);
  } catch (err) {
    console.error(`Failed to load function ${name}:`, err instanceof Error ? err.message : err);
    return Response.json({ error: `Function ${name} failed to load` }, { status: 500 });
  }
  if (!handler) return notFound("Unknown function");

  try {
    const res = await handler(req);
    if (res instanceof Response) return res;
    console.error(`Function ${name} did not return a Response`);
    return Response.json({ error: `Function ${name} did not return a Response` }, { status: 500 });
  } catch (err) {
    console.error(`Function ${name} threw:`, err instanceof Error ? err.name : typeof err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

const port = Number(Deno.env.get("PORT") || 8787);

Deno.serve({
  port,
  onListen: ({ hostname, port }) => {
    const host = hostname === "0.0.0.0" ? "localhost" : hostname;
    console.log(`Dev server on http://${host}:${port}  (functions in ./functions)`);
  },
}, async (req) => {
  const start = performance.now();
  const res = withCors(await route(req));
  const ms = (performance.now() - start).toFixed(1);
  console.log(`${req.method} ${new URL(req.url).pathname} ${res.status} ${ms}ms`);
  return res;
});
