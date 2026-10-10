// Approve every pending Submission on the live app (a person decided they are all OK).
//
//   set -a && . ./.env && set +a && deno run -A scripts/approve-all.ts
//
// Calls review_queue with ADMIN_TOKEN, 3 at a time (Base44 rate-limits and its DB
// says "busy" under load), backing off on 429/503. A draft with no zip gets the
// zip from its address; with none there it is skipped and left pending.

const URL_Q = "https://inmigracion-nyc.com/functions/review_queue";
const token = Deno.env.get("ADMIN_TOKEN");
if (!token) throw new Error("ADMIN_TOKEN missing: run with `set -a && . ./.env && set +a` first");
const H = { "content-type": "application/json", "x-admin-token": token };
const CONCURRENCY = 3;
const sleep = (ms: number) => new Promise((z) => setTimeout(z, ms));

async function call(body: unknown) {
  const r = await fetch(URL_Q, { method: "POST", headers: H, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

type Sub = { id: string; zip?: string; address?: string; name?: string };
const zipOf = (s: Sub) => (s.zip && /^\d{5}$/.test(s.zip) ? null : (s.address ?? "").match(/\b(1[01]\d{3})\b/)?.[1]);

let ok = 0, fail = 0;
const skipped = new Set<string>();
for (let round = 0; round < 15; round++) {
  const list = await call({ action: "list", status: "pending" });
  const subs = ((list.body.submissions ?? []) as Sub[]).filter((s) => !skipped.has(s.id));
  if (!subs.length) break;
  const queue = [...subs];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let s; (s = queue.shift());) {
      const zip = zipOf(s);
      const req = zip ? { action: "approve", id: s.id, edits: { zip } } : { action: "approve", id: s.id };
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await call(req);
        if (r.ok || r.status === 409) { ok++; break; }
        if (r.status === 400) { skipped.add(s.id); break; } // e.g. no zip anywhere: leave for a person
        if (attempt === 5) { fail++; console.error(r.status, JSON.stringify(r.body).slice(0, 100)); break; }
        await sleep((r.status === 429 ? 8000 : 2000) * (attempt + 1));
      }
    }
  }));
  console.log(`round ${round}: approved ${ok}, skipped (no zip) ${skipped.size}, failed ${fail}`);
}
console.log("counts:", JSON.stringify((await call({ action: "list", status: "pending" })).body.counts));
