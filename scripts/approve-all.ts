// Approve every pending Submission on the live app (a person decided they are all OK).
//
//   set -a && . ./.env && set +a && deno run -A scripts/approve-all.ts
//
// Calls review_queue with ADMIN_TOKEN, 12 at a time, retrying "Database is busy".

const URL_Q = "https://inmigracion-nyc.com/functions/review_queue";
const token = Deno.env.get("ADMIN_TOKEN");
if (!token) throw new Error("ADMIN_TOKEN missing: run with `set -a && . ./.env && set +a` first");
const H = { "content-type": "application/json", "x-admin-token": token };

async function call(body: unknown) {
  const r = await fetch(URL_Q, { method: "POST", headers: H, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

let ok = 0, fail = 0;
for (let round = 0; round < 10; round++) {
  const list = await call({ action: "list", status: "pending" });
  const subs = (list.body.submissions ?? []) as { id: string }[];
  if (!subs.length) break;
  const queue = [...subs];
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let s; (s = queue.shift());) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await call({ action: "approve", id: s.id });
        if (r.ok || r.status === 409) { ok++; break; }
        if (attempt === 3) { fail++; console.error(r.status, JSON.stringify(r.body).slice(0, 120)); }
        await new Promise((z) => setTimeout(z, 1500 * (attempt + 1)));
      }
    }
  }));
  console.log(`round ${round}: approved ${ok}, failed ${fail}`);
}
console.log("counts:", JSON.stringify((await call({ action: "list", status: "pending" })).body.counts));
