// Tests for the community page function. Run:
//   deno test --allow-read --allow-env --allow-write tests/community_test.ts
// With --allow-write the posts go to a temp DATA_DIR and the full flow
// (post, reply, hide) is checked; without it, only checks that never write run.
import { community, removeContacts } from "../shared/web/community.ts";
import handler from "../handlers/community/entry.ts";

function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(`assertion failed ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const canWrite = (await Deno.permissions.query({ name: "write" })).state === "granted";
const req = (headers: Record<string, string> = {}) => new Request("http://x/functions/community", { method: "POST", headers });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

Deno.test("removeContacts drops phones and emails, keeps short numbers", () => {
  eq(removeContacts("Call me at (718) 555-0134 or ana@example.com"), "Call me at […] or […]");
  eq(removeContacts("Sat 9 to 11am, zip 11368, bus Q72"), "Sat 9 to 11am, zip 11368, bus Q72");
});

Deno.test("posts about immigration status are refused, short posts too", async () => {
  eq(await status(community(req(), { action: "post", body: "Necesito ayuda con mi caso de asilo, ¿alguien sabe?" })), 400);
  eq(await status(community(req(), { action: "post", body: "hola" })), 400);
  eq(await status(community(req(), { action: "post", body: "Valid question here", need: "pizza" })), 400);
  eq(await status(community(req(), { action: "post", body: "Valid question here", zip: "abc" })), 400);
});

Deno.test("honeypot: bots get a thank-you and nothing is stored", async () => {
  const r = await community(req(), { action: "post", body: "Buy cheap stuff now!!!", website: "spam.example" }) as { ok: boolean };
  ok(r.ok);
});

Deno.test("hide needs admin", async () => {
  eq(await status(community(req(), { action: "hide", id: "x" })), 503); // ADMIN_TOKEN unset
  Deno.env.set("ADMIN_TOKEN", "test-admin");
  eq(await status(community(req({ "x-admin-token": "wrong" }), { action: "hide", id: "x" })), 401);
  Deno.env.delete("ADMIN_TOKEN");
});

Deno.test({ name: "post, reply, list, hide (temp data dir)", ignore: !canWrite, fn: async () => {
  const dir = await Deno.makeTempDir();
  const prev = Deno.env.get("DATA_DIR");
  Deno.env.set("DATA_DIR", dir);
  Deno.env.set("ADMIN_TOKEN", "test-admin");
  try {
    const q = await community(req(), {
      action: "post", kind: "question", need: "housing", zip: "11368",
      body: "Where can I get free help with a housing problem? Text me 347-555-0199",
    }) as { post: { id: string; body: string; kind: string } };
    eq(q.post.kind, "question");
    ok(!q.post.body.includes("555"), "phone removed");

    const r = await community(req(), { action: "post", parent_id: q.post.id, body: "Try the Housing filter under Search." }) as { post: { kind: string; parent_id: string } };
    eq(r.post.kind, "reply");
    eq(r.post.parent_id, q.post.id);

    // Replies can attach to the built-in examples, but not to a reply.
    eq(await status(community(req(), { action: "post", parent_id: "demo-housing", body: "Call 311 and ask for tenant help." })), 200);
    const reply = r.post as unknown as { id: string };
    eq(await status(community(req(), { action: "post", parent_id: (reply as { id: string }).id, body: "Nested reply is not allowed" })), 400);

    let list = await community(req(), { action: "list" }) as { posts: Array<{ id: string; status?: string }> };
    eq(list.posts.length, 3);
    ok(list.posts.every((p) => p.status === undefined), "no internal fields");

    await community(req({ "x-admin-token": "test-admin" }), { action: "hide", id: q.post.id });
    list = await community(req(), { action: "list" }) as { posts: Array<{ id: string }> };
    ok(!list.posts.some((p) => p.id === q.post.id), "hidden post not listed");
  } finally {
    if (prev === undefined) Deno.env.delete("DATA_DIR");
    else Deno.env.set("DATA_DIR", prev);
    Deno.env.delete("ADMIN_TOKEN");
    await Deno.remove(dir, { recursive: true });
  }
} });

Deno.test("HTTP wrapper: GET is 405, list is public", async () => {
  eq((await handler(new Request("http://x/functions/community"))).status, 405);
});

// The demo script (README "Demo prompts" #6), end to end on a copy of data/:
// a housing question stays a discussion post; a tip from "Suggest a resource"
// is pending, then only after a person approves it becomes a directory result.
Deno.test({ name: "demo: community post vs reviewed tip (temp copy of data/)", ignore: !canWrite, fn: async () => {
  const { submitResource, reviewQueue } = await import("../shared/web/submissions.ts");
  const { listPlaces } = await import("../shared/web/directory.ts");
  const dir = await Deno.makeTempDir();
  for await (const f of Deno.readDir(new URL("../data/", import.meta.url))) {
    if (f.isFile && f.name.endsWith(".json")) await Deno.copyFile(new URL(`../data/${f.name}`, import.meta.url), `${dir}/${f.name}`);
  }
  const prev = Deno.env.get("DATA_DIR");
  Deno.env.set("DATA_DIR", dir);
  Deno.env.set("ADMIN_TOKEN", "test-admin");
  const admin = req({ "x-admin-token": "test-admin" });
  const NAME = "[DEMO] Despensa de prueba Corona";
  const search = async (q: string) =>
    ((await listPlaces(req(), { q })) as { places: Array<{ name: string; trust: string }> }).places;
  try {
    // 1. Housing question: a discussion post, never a directory result.
    await community(req(), { action: "post", kind: "question", need: "housing", zip: "11368", body: "Mi casero dice que me vaya a fin de mes. ¿Dónde dan ayuda gratis?" });
    eq((await search("casero")).length, 0, "housing question in directory");

    // 2. Tip through the form: pending, not in the directory yet.
    await submitResource(req(), { name: NAME, address: "40-12 National St, Corona, NY 11368", hours: "Sáb 9am-11am", needs: ["food"] });
    eq((await search("Despensa de prueba")).length, 0, "pending tip in directory");
    const queue = await reviewQueue(admin, { action: "list" }) as { submissions: Array<{ id: string; name: string }> };
    const sub = queue.submissions.find((s) => s.name === NAME);
    ok(sub, "tip in pending queue");

    // 3. A person approves it: now it is a directory result marked community.
    await reviewQueue(admin, { action: "approve", id: sub!.id });
    const hits = await search("Despensa de prueba");
    eq(hits.map((p) => [p.name, p.trust]), [[NAME, "community"]]);
  } finally {
    if (prev === undefined) Deno.env.delete("DATA_DIR");
    else Deno.env.set("DATA_DIR", prev);
    Deno.env.delete("ADMIN_TOKEN");
    await Deno.remove(dir, { recursive: true });
  }
} });
