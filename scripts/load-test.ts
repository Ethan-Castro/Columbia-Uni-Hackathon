// Load test the live hot path (find_resources, make_plan, MCP tools/call) and report latency and errors.
//
//   set -a && . ./.env && set +a && deno run -A scripts/load-test.ts
//   flags: --base https://inmigracion-nyc.com (default) | http://localhost:8787
//          --requests 200   --concurrency 10,25   --mix find=6,plan=2,mcp=2
//
// Every request carries x-load-test: $ADMIN_TOKEN, so the server writes no RequestLog row
// (shared/logRequest.ts isLoadTest) and the insights page stays real demand only. Each
// concurrency level runs one after the other; the summary says where 429/503 start.
// Be kind to a shared backend: start small, and do not run it during a demo.

const argv = Deno.args;
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = opt("--base", "https://inmigracion-nyc.com").replace(/\/$/, "");
const REQUESTS = Number(opt("--requests", "200"));
const LEVELS = opt("--concurrency", "10,25").split(",").map(Number).filter((n) => n > 0);
const MIX = Object.fromEntries(opt("--mix", "find=6,plan=2,mcp=2").split(",").map((kv) => {
  const [k, v] = kv.split("=");
  return [k, Number(v)];
})) as Record<string, number>;
const TOKEN = Deno.env.get("ADMIN_TOKEN");
if (!TOKEN) throw new Error("ADMIN_TOKEN missing: run with `set -a && . ./.env && set +a` first");

const NEEDS = ["food", "legal", "health", "benefits", "money", "school", "id", "housing"];
const NEARS = ["11368", "Corona", "Bushwick", "10032", "Sunset Park", "the Bronx", "11373", "Jackson Heights", "10453", "Staten Island"];
const pick = <T>(xs: T[], i: number) => xs[i % xs.length];

function request(i: number): { kind: string; url: string; body: unknown } {
  const total = Object.values(MIX).reduce((a, b) => a + b, 0);
  let r = (i * 7919) % total;
  const kind = Object.keys(MIX).find((k) => (r -= MIX[k]) < 0) ?? "find";
  const need = pick(NEEDS, i), near = pick(NEARS, i * 3 + 1);
  if (kind === "plan") {
    return { kind, url: `${BASE}/functions/make_plan`, body: { needs: [need, pick(NEEDS, i + 3)], near, language: i % 3 ? "es" : "en" } };
  }
  if (kind === "mcp") {
    return {
      kind,
      url: `${BASE}/functions/mcp`,
      body: { jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "find_resources", arguments: { need, near } } },
    };
  }
  return { kind, url: `${BASE}/functions/find_resources`, body: { need, near, language: i % 3 ? "es" : "en" } };
}

interface Result {
  kind: string;
  ms: number;
  status: number;
}

async function one(i: number): Promise<Result> {
  const { kind, url, body } = request(i);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-load-test": TOKEN! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    await res.arrayBuffer();
    return { kind, ms: performance.now() - t0, status: res.status };
  } catch {
    return { kind, ms: performance.now() - t0, status: 0 };
  }
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

const summary: Record<string, unknown>[] = [];
for (const level of LEVELS) {
  const results: Result[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: level }, async () => {
    for (let i; (i = next++) < REQUESTS;) results.push(await one(i));
  }));
  const secs = (performance.now() - t0) / 1000;
  const ok = results.filter((r) => r.status === 200);
  const codes: Record<string, number> = {};
  for (const r of results) if (r.status !== 200) codes[r.status || "network"] = (codes[r.status || "network"] ?? 0) + 1;
  const byKind = Object.fromEntries(Object.keys(MIX).map((k) => {
    const ms = results.filter((r) => r.kind === k && r.status === 200).map((r) => r.ms);
    return [k, { n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) }];
  }));
  const row = {
    concurrency: level,
    requests: results.length,
    ok: ok.length,
    errors: codes,
    rps: Math.round((results.length / secs) * 10) / 10,
    p50_ms: pct(ok.map((r) => r.ms), 50),
    p95_ms: pct(ok.map((r) => r.ms), 95),
    p99_ms: pct(ok.map((r) => r.ms), 99),
    by_kind: byKind,
  };
  summary.push(row);
  console.log(JSON.stringify(row));
  if (ok.length < results.length * 0.5) {
    console.log("More than half failed at this level; stopping before going higher.");
    break;
  }
}
console.log("\nconcurrency | ok/total | rps | p50 | p95 | errors");
for (const r of summary) {
  console.log(`${r.concurrency} | ${r.ok}/${r.requests} | ${r.rps} | ${r.p50_ms} ms | ${r.p95_ms} ms | ${JSON.stringify(r.errors)}`);
}
