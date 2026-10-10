// Copy our code into the Base44 project folder, check it, and optionally deploy.
//
//   deno run -A scripts/base44-sync.ts            # regenerate base44/functions + base44/shared, validate, type-check
//   deno run -A scripts/base44-sync.ts --deploy   # ...then `base44 deploy -y --no-build` and remove stale remote functions
//
// Flags: --no-check (skip deno check), --no-prune (keep remote functions that no longer exist here).
//
// What it does:
//  1. Wipes base44/functions/ and base44/shared/ (generated output, never edit them).
//  2. Copies every handlers/<name>/ that has an entry.ts (entry.ts, function.jsonc, any other files),
//     and all of shared/.
//  3. Overlays base44-overrides/shared/* (Base44 versions of db.ts, auth.ts, logRequest.ts).
//     An override that imports "./<name>.local.ts" gets the repo-root file copied next to it under that name,
//     so unchanged helpers (toLogRow, timingSafeEqual) are never duplicated by hand.
//  4. Checks that each override still exports every name the repo-root file exports.
//  5. Checks that every relative import resolves inside base44/, and bare imports are ones Base44 supports.
//  6. Runs deno check on the generated tree with a throwaway config that maps "base44:runtime" to a stub
//     (nothing is written into base44/ or deno.json for this).
//  7. --deploy: base44 deploy -y --no-build, then deletes remote functions with no folder here.

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const B44 = `${ROOT}/base44`;
const args = new Set(Deno.args);
const DEPLOY = args.has("--deploy");
const CHECK = !args.has("--no-check");
const PRUNE = !args.has("--no-prune");

const rel = (p: string) => p.startsWith(ROOT + "/") ? p.slice(ROOT.length + 1) : p;
function fail(msg: string): never {
  console.error(`\nbase44-sync: ${msg}`);
  Deno.exit(1);
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (e.isFile) yield p;
  }
}

async function copyTree(src: string, dst: string, skip: (name: string) => boolean = () => false): Promise<number> {
  let n = 0;
  for await (const f of walk(src)) {
    const name = f.slice(src.length + 1);
    if (skip(name)) continue;
    const out = `${dst}/${name}`;
    await Deno.mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
    await Deno.copyFile(f, out);
    n++;
  }
  return n;
}

const skipJunk = (name: string) => /(^|\/)(\.DS_Store|.*\.test\.ts|.*~)$/.test(name);

// ---------- 1-3. regenerate ----------

await Deno.remove(`${B44}/functions`, { recursive: true }).catch(() => {});
await Deno.remove(`${B44}/shared`, { recursive: true }).catch(() => {});
await Deno.mkdir(`${B44}/functions`, { recursive: true });

const functionNames: string[] = [];
for await (const e of Deno.readDir(`${ROOT}/handlers`)) {
  if (!e.isDirectory) continue;
  if (!(await exists(`${ROOT}/handlers/${e.name}/entry.ts`))) {
    console.warn(`skip handlers/${e.name}: no entry.ts`);
    continue;
  }
  if (!/^[a-z0-9_-]+$/i.test(e.name)) fail(`function folder name "${e.name}" has characters Base44 may reject`);
  await copyTree(`${ROOT}/handlers/${e.name}`, `${B44}/functions/${e.name}`, skipJunk);
  functionNames.push(e.name);
}
functionNames.sort();

// JSONC -> JSON: drops line and block comments outside strings, and trailing commas.
function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// This app is on Base44 Workflows, where legacy "automations" in function.jsonc
// make the deploy fail (409 workflows_enabled). Strip them from the generated copy.
const strippedAutomations: string[] = [];
for (const n of functionNames) {
  const p = `${B44}/functions/${n}/function.jsonc`;
  if (!(await exists(p))) continue;
  const cfg = parseJsonc(await Deno.readTextFile(p)) as Record<string, unknown>;
  if (!("automations" in cfg)) continue;
  delete cfg.automations;
  await Deno.writeTextFile(
    p,
    `// GENERATED from handlers/${n}/function.jsonc by scripts/base44-sync.ts.\n` +
      `// "automations" removed: this app uses Base44 Workflows, which reject legacy automations.\n` +
      JSON.stringify(cfg, null, 2) + "\n",
  );
  strippedAutomations.push(n);
}
if (strippedAutomations.length) {
  console.warn(
    `note: removed "automations" from function.jsonc of ${strippedAutomations.join(", ")} ` +
      `(this app uses Workflows; schedule those runs as a Workflow instead)`,
  );
}

const sharedCount = await copyTree(`${ROOT}/shared`, `${B44}/shared`, skipJunk);

const OVR = `${ROOT}/base44-overrides/shared`;
const overrides: string[] = [];
for await (const f of walk(OVR)) {
  const name = f.slice(OVR.length + 1);
  if (skipJunk(name)) continue;
  const text = await Deno.readTextFile(f);
  const base = name.replace(/\.ts$/, "");
  const localName = `${base.split("/").pop()}.local.ts`;
  const original = `${ROOT}/shared/${name}`;
  if (text.includes(`./${localName}`)) {
    if (!(await exists(original))) fail(`${rel(f)} imports ./${localName} but shared/${name} does not exist`);
    await Deno.copyFile(original, `${B44}/shared/${base}.local.ts`);
  }
  await Deno.mkdir(`${B44}/shared/${name}`.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeTextFile(`${B44}/shared/${name}`, text);
  overrides.push(name);
}

// ---------- 4. override exports ----------

function exportNames(src: string): { names: Set<string>; stars: string[] } {
  const code = stripComments(src);
  const names = new Set<string>();
  const stars: string[] = [];
  for (const m of code.matchAll(/^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of code.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n);
    }
  }
  for (const m of code.matchAll(/^\s*export\s+\*\s+from\s+["']([^"']+)["']/gm)) stars.push(m[1]);
  return { names, stars };
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

for (const name of overrides) {
  const original = `${ROOT}/shared/${name}`;
  if (!(await exists(original))) continue;
  const want = exportNames(await Deno.readTextFile(original)).names;
  const ovr = exportNames(await Deno.readTextFile(`${B44}/shared/${name}`));
  const covered = new Set(ovr.names);
  for (const star of ovr.stars) {
    const target = `${B44}/shared/${name}`.replace(/[^/]+$/, "") + star.replace(/^\.\//, "");
    if (await exists(target)) for (const n of exportNames(await Deno.readTextFile(target)).names) covered.add(n);
  }
  const missing = [...want].filter((n) => !covered.has(n));
  if (missing.length) {
    fail(`base44-overrides/shared/${name} is missing exports that shared/${name} has: ${missing.join(", ")}. Update the override.`);
  }
}

// ---------- 5. imports ----------

const ALLOWED_BARE = [/^npm:/, /^jsr:/, /^node:/, /^https:\/\//, /^base44:runtime$/];
const problems: string[] = [];
let fileCount = 0;
for (const dir of [`${B44}/functions`, `${B44}/shared`]) {
  for await (const f of walk(dir)) {
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    fileCount++;
    const code = stripComments(await Deno.readTextFile(f));
    const specs = [
      ...code.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm),
      ...code.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
      ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const s of specs) {
      if (s.startsWith(".")) {
        const target = new URL(s, `file://${f}`).pathname;
        if (!target.startsWith(B44 + "/")) problems.push(`${rel(f)}: "${s}" points outside base44/`);
        else if (!(await exists(target))) problems.push(`${rel(f)}: "${s}" does not exist`);
      } else if (!ALLOWED_BARE.some((r) => r.test(s))) {
        problems.push(`${rel(f)}: bare import "${s}" (use npm:/jsr:/https: specifiers; Base44 ignores deno.json import maps)`);
      }
    }
  }
}
if (problems.length) fail(`import problems:\n  ${problems.join("\n  ")}`);

// ---------- GENERATED.md ----------

await Deno.writeTextFile(
  `${B44}/GENERATED.md`,
  `# Generated folders: do not edit

\`base44/functions/\` and \`base44/shared/\` are regenerated by \`deno run -A scripts/base44-sync.ts\`
from the repo-root \`handlers/\` and \`shared/\`, with \`base44-overrides/shared/\` copied on top
(\`*.local.ts\` files are the repo-root originals that an override builds on).

Edit the repo-root copies (or the overrides), then run the sync again. Hand edits here are wiped.

Last sync: ${new Date().toISOString()}
Functions: ${functionNames.join(", ")}
Overrides: ${overrides.join(", ")}
`,
);

console.log(`synced ${functionNames.length} functions (${functionNames.join(", ")})`);
console.log(`synced ${sharedCount} shared files, overrides: ${overrides.join(", ")}`);
console.log(`imports ok in ${fileCount} files`);

// ---------- 6. type check ----------

async function run(cmd: string, argv: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const out = await new Deno.Command(cmd, {
    args: argv,
    cwd: opts.cwd ?? ROOT,
    stdout: opts.quiet ? "piped" : "inherit",
    stderr: opts.quiet ? "piped" : "inherit",
    stdin: "null",
  }).output();
  return {
    code: out.code,
    stdout: opts.quiet ? new TextDecoder().decode(out.stdout) : "",
    stderr: opts.quiet ? new TextDecoder().decode(out.stderr) : "",
  };
}

if (CHECK) {
  const tmp = await Deno.makeTempDir({ prefix: "base44-check-" });
  try {
    await Deno.writeTextFile(
      `${tmp}/runtime-stub.ts`,
      `// Type-only stand-in for Base44's "base44:runtime" module.
export function waitUntil<T>(promise: Promise<T>): Promise<T> { return promise; }
export const secrets: { get(name: string): string | undefined } = { get: (n) => Deno.env.get(n) };
`,
    );
    await Deno.writeTextFile(
      `${tmp}/deno.json`,
      JSON.stringify({
        compilerOptions: { strict: true },
        imports: { "base44:runtime": `file://${tmp}/runtime-stub.ts` },
        nodeModulesDir: "none",
      }),
    );
    const files: string[] = [];
    for (const n of functionNames) files.push(`base44/functions/${n}/entry.ts`);
    for await (const f of walk(`${B44}/shared`)) if (f.endsWith(".ts")) files.push(rel(f));
    console.log(`deno check (${files.length} files)...`);
    const r = await run("deno", ["check", "--config", `${tmp}/deno.json`, ...files]);
    if (r.code !== 0) fail("deno check failed on the generated tree (see above). Fix the repo-root file, then re-run.");
    console.log("deno check ok");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

// ---------- 7. deploy ----------

if (DEPLOY) {
  console.log("\nbase44 deploy -y --no-build ...");
  const r = await run("base44", ["deploy", "-y", "--no-build"]);
  if (r.code !== 0) fail("base44 deploy failed");

  if (PRUNE) {
    const list = await run("base44", ["functions", "list"], { quiet: true });
    const remote = (list.stdout + "\n" + list.stderr).split("\n")
      // deno-lint-ignore no-control-regex
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
      .filter((l) => /^[A-Za-z0-9_-]+$/.test(l));
    const stale = remote.filter((n) => !functionNames.includes(n));
    if (stale.length) {
      console.log(`removing remote functions with no folder here: ${stale.join(", ")}`);
      const d = await run("base44", ["functions", "delete", ...stale]);
      if (d.code !== 0) console.warn("could not delete stale functions; run: base44 functions delete " + stale.join(" "));
    }
  }
  console.log("\ndeployed. Connector URL: https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/mcp");
}
