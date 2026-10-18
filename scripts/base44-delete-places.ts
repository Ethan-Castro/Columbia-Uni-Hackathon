// Delete specific Places from the live Base44 app by our id (key). For fixing an import, never for
// bulk cleanup: name every id. Community places (approved by a person) are refused.
//
//   deno run -A scripts/base44-delete-places.ts place-fac-x place-fac-y            # dry run
//   deno run -A scripts/base44-delete-places.ts --yes place-fac-x place-fac-y      # delete

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const YES = Deno.args.includes("--yes");
const ids = Deno.args.filter((a) => a.startsWith("place-"));
if (!ids.length) throw new Error("name the place ids to delete");

const execScript = `
const E: any = (globalThis as any).base44.entities;
const IDS = ${JSON.stringify(ids)};
const YES = ${YES};
const out: any[] = [];
for (const key of IDS) {
  const rows = await E.Place.filter({ key }, "created_date", 10);
  for (const r of rows) {
    if (r.trust === "community") { out.push({ key, skipped: "community" }); continue; }
    if (YES) await E.Place.delete(r.id);
    out.push({ key, name: r.name, deleted: YES });
  }
  if (!rows.length) out.push({ key, missing: true });
}
console.log("DELETE_RESULT " + JSON.stringify(out));
`;
const child = new Deno.Command("base44", {
  args: ["exec", "--privileged", "--data-env", "prod"],
  cwd: ROOT,
  env: { BASE44_EXEC_SDK_VERSION: "0.8.53" },
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();
const w = child.stdin.getWriter();
await w.write(new TextEncoder().encode(execScript));
await w.close();
const res = await child.output();
const text = new TextDecoder().decode(res.stdout) + new TextDecoder().decode(res.stderr);
const line = text.split("\n").find((l) => l.startsWith("DELETE_RESULT "));
if (!line) {
  console.error(text.split("\n").slice(-20).join("\n"));
  Deno.exit(1);
}
for (const r of JSON.parse(line.slice("DELETE_RESULT ".length))) console.log(JSON.stringify(r));
if (!YES) console.log("(dry run; pass --yes to delete)");
