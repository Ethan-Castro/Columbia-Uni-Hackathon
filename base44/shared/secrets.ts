// Secrets. Read with Deno.env.get INSIDE each call (never at module top level).
// This works locally (dev.ts loads .env into Deno.env) and on both Base44
// runtimes: the current one maps Deno.env.get to its secrets binding, and
// legacy v1/v2 backends only support Deno.env.get. Never log secret values.
// This file only uses Deno.env so it runs unchanged on Base44; the dev-only
// .env loader lives in dev.ts.

export function getSecret(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value === "" ? undefined : value;
}

export function requireSecret(name: string): string {
  const value = getSecret(name);
  if (value === undefined) throw new Error(`Missing secret ${name}`);
  return value;
}
