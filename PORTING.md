# Porting to Base44

What changes when this repo moves into Base44, and the exact steps. The Base44 facts come from docs.base44.com and github.com/base44/cli (checked 2026-10-07) and from what we saw on our own app on 2026-10-10. Anything we have not confirmed is marked **(unconfirmed)**.

## Where things stand (2026-10-10)

- App: **NYC Navigator**, id `6aca64c59c3d35bc8bab2330`, `https://nyc-navigator.base44.app`. It is linked locally through `base44/.app.jsonc`, which is gitignored.
- An earlier build is deployed. At 16:42 UTC an anonymous `GET .../functions/health` returned Program 8, Place 10, Link 11, and an anonymous `tools/list` on `.../functions/mcp` listed all 5 tools.
- Secrets already set on Base44 (names from `base44 secrets list`): `ADMIN_TOKEN`, `TAVILY_API_KEY`, `TWILIO_WHATSAPP_FROM`, `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `OPENROUTER_API_KEY`.
- **Today's fixes are not deployed yet.** These include the status redaction, the "verified" wording, the AI speed-up and the related programs. To ship them, run `deno run -A scripts/base44-sync.ts --deploy` (step 3).

## 1. Copying the files: `scripts/base44-sync.ts`

Never copy files into `base44/` by hand. `deno run -A scripts/base44-sync.ts` does the copy:

| From | To | Notes |
| --- | --- | --- |
| `handlers/<name>/` | `base44/functions/<name>/` | Copies `entry.ts` and `function.jsonc`. The `automations` block is stripped (see section 6). |
| `shared/` | `base44/shared/` | Relative imports (`../../shared/x.ts`) still resolve. They cannot point outside `base44/`. |
| `base44-overrides/shared/*.ts` | on top of `base44/shared/` | These are the Base44 versions of 4 files (section 2). When an override imports `./x.local.ts`, the sync copies the repo-root original next to it under that name. |
| `base44/entities/*.jsonc` | stays where it is | Already in place, ready for `base44 entities push`. |

The sync also checks three things:
- each override exports every name the original exports;
- every import is relative inside `base44/`, or uses `npm:`, `jsr:`, `https:` or `base44:runtime`;
- the generated tree passes `deno check` with a stub for `base44:runtime`.

It writes nothing outside `base44/`.

These stay local and are never deployed: `dev.ts`, `data/`, `scripts/`, `tests/`, `.env`, `web/node_modules/`.

## 2. Internals that change in the Base44 copy

| File | Locally | On Base44 (override in `base44-overrides/shared/`) |
| --- | --- | --- |
| `db.ts` | JSON files in `data/` | `createClientFromRequest(req).asServiceRole.entities` from `npm:@base44/sdk@0.8.53`, with the same `list(sort, limit, skip)`, `filter(query, sort, limit, skip)`, `get`, `create`, `update` and `count`. Base44 assigns its own ids, so Program and Place keep our CSV id (`prog-*`, `place-*`) in a `key` field. The layer translates `id` to `key` in queries, sorts and lookups, and records come back with `id` = key. `count` falls back to reading the list if the count endpoint is missing. |
| `llm.ts` | OpenRouter `fetch`, reasoning off, aborted at the 8s cap | If the `OPENROUTER_API_KEY` secret is set, the same OpenRouter call. Otherwise `asServiceRole.integrations.Core.InvokeLLM({prompt, response_json_schema})`. The OpenRouter key is set today, so the demo uses OpenRouter (about 2s per call). InvokeLLM latency against the 8s cap has not been measured **(unconfirmed)**. Either way, a slow call falls back to templates. |
| `logRequest.ts` | fire-and-forget write | The write is wrapped in `waitUntil(...)` from `base44:runtime`, so it outlives the response. |
| `auth.ts` | `x-admin-token` header must equal `ADMIN_TOKEN` (constant-time compare) | Accepts that header **or** a signed-in Base44 user whose `base44.auth.me()` role is `"admin"`. |
| `secrets.ts` | `Deno.env.get` inside each call | Unchanged: Base44 secrets show up in `Deno.env`. `import { secrets } from "base44:runtime"` would also work. |

The function entries do not change. Each one is a `default export async function (req)`, which the current Cloudflare runtime serves directly.

Frontend, `web/src/api.ts`. Today every call is `fetch("/functions/<name>")`, sent as a POST from the same origin. This works on Base44 only if the site is served from `nyc-navigator.base44.app` and that origin routes `/functions/<name>` to the function **(unconfirmed)**. On 2026-10-10, `POST https://nyc-navigator.base44.app/functions/health` returned 404, probably because no site is published yet. If it still 404s after `base44 site deploy`, swap the body of `call()` for `base44.functions.invoke(name, body).then((r) => r.data)` using the Base44 client. Signed-in admins then pass `requireAdmin` through their Base44 role. The admin token keeps working too.

## 3. Base44 CLI steps

```sh
npx base44 login                       # or: base44 login (CLI installed globally)
base44 link                            # already done: base44/.app.jsonc holds the app id
                                       # (a new copy: base44 create, then link)
deno run -A scripts/base44-sync.ts     # regenerate base44/functions + base44/shared, validate, deno check
base44 entities push                   # schemas in base44/entities/*.jsonc
base44 functions deploy                # all functions in base44/functions/
cd web && npm run build && cd ..       # site -> web/dist
base44 site deploy                     # or `base44 deploy`, which deploys entities, functions and site in one go
```

`deno run -A scripts/base44-sync.ts --deploy` combines the sync, `base44 deploy -y --no-build` and deleting remote functions that no longer exist here (`--no-prune` skips the delete).

Setting `site.outputDirectory` in `base44/config.jsonc` so that `base44 deploy` picks up `web/dist` has not been set or tested yet **(unconfirmed key and path)**.

## 4. Secrets

```sh
# .env.base44 (gitignored by .env.*): only these lines
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TAVILY_API_KEY=...
ADMIN_TOKEN=...
SCOUT_TOKEN=...            # optional: lets scheduled Scout runs in (section 6)
OPENROUTER_API_KEY=...     # optional: faster AI; without it InvokeLLM is used

base44 secrets set --env-file .env.base44      # or: base44 secrets set KEY=VALUE
```

Do **not** upload the whole `.env`:
- `PORT` and `DATA_DIR` are local only.
- `TWILIO_PHONE_NUMBER` and `OFFLINEBASE_*` are unused by the functions. `OPENROUTER_MODEL` is optional (the default model is used without it).
- `ANTHROPIC_*` is not needed.

Each `secrets set` redeploys the functions.

## 5. Loading data into Base44

Concrete path: **load Felix's CSVs locally with `deno task import`, then push the JSON to Base44 with `scripts/base44-seed.ts`.**

```sh
deno task import --dry-run                 # validate programs.csv / places.csv / links.csv in data/
deno task import                           # -> data/Program.json, Place.json, Link.json
deno run -A scripts/base44-seed.ts --dry-run
deno run -A scripts/base44-seed.ts         # upsert into the live app
deno run -A scripts/base44-seed.ts --replace   # ...and delete Base44 catalog rows that are not in the files
```

How it works:
- The script pipes a generated script to `base44 exec --privileged`, which uses your CLI login.
- It upserts Program and Place by `key` (our CSV id) and Link by `from_id + to_id + type`.
- It never touches Submission or RequestLog.
- `--replace` keeps Places with `trust: community` (approved submissions) and the Links that point at them.
- When it finishes, it reads the counts back through the deployed `health` function and exits 2 on a mismatch.
- `--data-env dev` targets the dev data instead of prod.

## 6. Nightly Scout

- `handlers/scout/function.jsonc` has 4 daily schedules, 07:00 to 07:30 UTC, one query each. They use the documented automation format. Each is `is_active: false` in the repo.
- **This app has Base44 Workflows enabled.** Legacy `automations` make the deploy fail with HTTP 409, so the sync strips the block. Recreate the 4 runs as Workflows that call `scout` with the body `{"args": {"query": "food pantry Corona Queens", "max_results": 5, "scout_token": "<SCOUT_TOKEN>"}}`. Use the other 3 queries from `function.jsonc` for the rest. The exact Workflow step config has not been verified **(unconfirmed)**. `base44 workflows list` and `base44 workflows runs` show what exists and what ran.
- Auth: a scheduled run has no signed-in admin. `scout` accepts either `requireAdmin` or the `SCOUT_TOKEN` secret, compared in constant time. The token can come from `args.scout_token`, `scout_token` or the `x-scout-token` header. Put the token only in the Base44 dashboard, never in `function.jsonc`. With `SCOUT_TOKEN` unset, only admins can run Scout.
- Limits from the docs: Builder plan or higher, each run at most 3 minutes, 1 integration credit per run. Scout only creates `pending` Submissions, and nothing goes live without approval.

## 7. Visibility and the MCP endpoint

- `base44/config.jsonc` has `"visibility": "public"` (also settable with `base44 visibility public`). Anonymous calls to `/api/apps/<id>/functions/mcp` and `/health` work today.
- Whether a private app would block them is **(unconfirmed)**, so keep it public.
- Direct HTTP calls carry no user, which is why every data and LLM call goes through `asServiceRole`.
- The Base44 security scan flags "Anyone can run this function". That is expected for `mcp`, the tool functions, `list_places`, `submit_resource` and `health`. The admin functions (`review_queue`, `insights`, `scout`) check `requireAdmin`. The public `health` only returns catalog counts.

## 8. MCP connector URL change

| | URL |
| --- | --- |
| Local (today) | `https://<random-words>.trycloudflare.com/functions/mcp`. Changes whenever cloudflared restarts; current host: `curl -s localhost:20241/quicktunnel` |
| Base44 | `https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/mcp` (answered `tools/list` on 2026-10-10) |

In Claude, open Settings > Connectors, then edit the custom connector or add a new one with the Base44 URL and no auth. The app-domain form `https://nyc-navigator.base44.app/functions/mcp` returned 404, so do not use it until the site is published and it is re-tested **(unconfirmed)**. The MCP server only needs POST. GET is answered with 405, which clients accept.

## 9. Legacy v1/v2 runtime caveat

Apps on the older backend never serve a default-export handler, and `base44:runtime` and `base44/shared/` imports do not resolve there. Functions edited in the Base44 web editor must also be self-contained. On such an app:
1. end each entry with `Deno.serve(handler)`;
2. inline or bundle `shared/` into each `entry.ts`, for example with `deno bundle` or esbuild;
3. replace `waitUntil` in `logRequest.ts` with a plain fire-and-forget write.

CLI-deployed apps on the current Cloudflare runtime, ours included, need none of this. The health and MCP functions answering with the current layout confirms it.

## 10. Still to verify on Base44

- `list(sort, 5000)` returns every row, with no lower server-side cap **(unconfirmed)**. This matters once Felix's places pass a few hundred.
- RequestLog rows created through `asServiceRole` carry no `created_by` user email **(unconfirmed)**. Look at one row in the dashboard. Direct MCP calls have no user, so it should be empty.
- `check_provider` no longer needs the Mongo `$in` filter. It lists Place and filters in code.
- `Submission.jsonc` already has `needs`, `notes`, `place_id` and `reviewed_at`. `Place.jsonc` has `key` and optional `needs`.

## Pre-demo checklist

1. `deno task check`, `deno task test` and `deno run -A scripts/base44-sync.ts` all pass.
2. Deploy today's fixes: `deno run -A scripts/base44-sync.ts --deploy`.
3. `curl -s https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/health` returns the expected catalog counts.
4. `tools/list` on the Base44 MCP URL lists `find_resources`, `make_plan`, `check_provider`, `send_to_phone` and `ping`.
5. Decide which URL the Claude connector uses: the tunnel (local, AI about 2s) or Base44. Run the Rosa and notario prompts once through it.
6. WhatsApp: the demo phone has joined the Twilio sandbox (send `join <keyword>` to +1 415 523 8886). Run one real send only on that phone.
7. Insights: open `#/insights` with the admin token. The rows say Test traffic.
8. Community: after the deploy, the Base44 dashboard shows a `CommunityPost` entity and a `community` function. Open `https://inmigracion-nyc.com/#/community`: the pinned card, four posts labeled synthetic, and a working "Escribir un mensaje" form (if the form is missing, the function is not deployed yet). Do one dry run of README demo #6, then reject or delete the `[DEMO]` tip and hide any test posts (Hide button shows with the admin token set).
9. Felix's data, if it arrives: `deno task import --dry-run`, then `deno task import` (add `--keep-sample` if his rows do not cover Corona), then `scripts/base44-seed.ts`. Re-run step 5.
