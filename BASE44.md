# Running NYC Navigator on Base44

The live app is **NYC Navigator**, app id `6aca64c59c3d35bc8bab2330`. It is on the Free plan, set to public, and runs on Base44's new Cloudflare runtime.
Dashboard: https://app.base44.com/apps/6aca64c59c3d35bc8bab2330

All the code lives in this repo. Base44 gets a generated copy of it, and nobody edits code inside Base44.

| What | Where |
|---|---|
| Our code (edit this) | `functions/`, `shared/` |
| Base44-only versions of 3 files | `base44-overrides/shared/` (`db.ts`, `auth.ts`, `logRequest.ts`) |
| Generated copy that gets deployed (never edit) | `base44/functions/`, `base44/shared/` (see `base44/GENERATED.md`) |
| Entity schemas | `base44/entities/*.jsonc` |
| Commands | `scripts/base44-sync.ts`, `scripts/base44-seed.ts` |

You need the `base44` CLI (`npm i -g base44`), a login with `base44 login`, and `base44/.app.jsonc` containing `{ "id": "6aca64c59c3d35bc8bab2330" }`. That file is gitignored, and `base44 link` creates it.

## (e) Connector URL (Claude, ChatGPT, voice)

```
https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/mcp
```

The connector needs no login. Paste it exactly: **no trailing slash** (`/mcp/` returns 404).
Every other function follows the same pattern, `.../functions/<name>`: `health`, `find_resources`, `make_plan`, `check_provider`, `send_to_phone`, `list_places`, `submit_resource`, `review_queue`, `insights`, `scout`.

## (a) Sync and deploy

```sh
deno run -A scripts/base44-sync.ts            # regenerate base44/functions + base44/shared, check imports, deno check
deno run -A scripts/base44-sync.ts --deploy   # same, then: base44 deploy -y --no-build, then delete remote functions we no longer have
```

What the sync does:
- It wipes and regenerates `base44/functions/` and `base44/shared/`. It copies every `functions/<name>/` that has an `entry.ts`, including its `function.jsonc`, and all of `shared/`.
- It copies `base44-overrides/shared/*` on top:
  - `db.ts` uses `createClientFromRequest(req).asServiceRole.entities`.
  - `auth.ts` accepts either `x-admin-token` or a signed-in Base44 user with role admin.
  - `logRequest.ts` wraps the write in `waitUntil`.
  - An override that imports `./X.local.ts` builds on the repo-root original, which the sync copies in under that name.
- It fails if an override no longer exports everything that the repo-root file exports. If someone adds an export to `shared/db.ts`, add it to the override as well.
- It fails if a relative import resolves outside `base44/`, or if a bare import is not one of `npm:` / `jsr:` / `node:` / `https:` / `base44:runtime`. Base44 ignores `deno.json` import maps.
- It runs `deno check` with a throwaway config that stubs `base44:runtime`, and writes nothing into the repo for this. `--no-check` skips it.
- It removes `"automations"` from the generated `function.jsonc`. This app uses Base44 Workflows, which reject legacy automations with error 409 and fail the whole deploy. To schedule Scout nightly, create a Workflow in the dashboard instead.
- Flags: `--no-check` and `--no-prune`.

To deploy a single function after a sync: `base44 functions deploy find_resources`.

## (b) Seed the data

```sh
deno run -A scripts/base44-seed.ts             # upsert data/Program.json, Place.json, Link.json into Base44
deno run -A scripts/base44-seed.ts --dry-run   # show what is there, write nothing
deno run -A scripts/base44-seed.ts --replace   # also delete Base44 Program/Place/Link records that are not in the files
deno run -A scripts/base44-seed.ts other/dir   # seed from another folder that holds the same three JSON files
```

**When Felix's CSVs arrive:**

```sh
deno task import path/to/felix-csvs     # validates, drops sample records, writes data/*.json (read data/import-report.json)
deno run -A scripts/base44-seed.ts --replace   # --replace removes the "(sample)" places from Base44 too
```

How the ids work:
- Base44 assigns its own record ids. Our CSV ids (`prog-…`, `place-…`) live in a `key` field on Program and Place.
- The data layer translates both ways, so functions still see `id: "place-corona-community-pantry"`, with the Base44 id kept as `_b44id`.
- `Link.from_id` and `Link.to_id` hold our keys.

Upsert rules:
- Program and Place upsert by `key`. Link upserts by `from_id + to_id + type`.
- `--replace` never touches Submission or RequestLog. It never deletes `trust=community` places (approved submissions), and it keeps links that point at those places.

Data environment:
- The deployed functions read **prod**, and the seed writes prod by default. The script checks this by reading counts back through the public `health` function and prints `MATCH`.
- `--data-env dev` targets the separate, empty dev data set.

How the seed runs:
- It pipes a generated script with the data embedded into `base44 exec --privileged`. exec runs locally in Deno with your CLI login.
- Until a site is published, exec's "published site URL" lookup returns 404. The script then reruns exec through a small local proxy that answers only that lookup with `https://nyc-navigator.base44.app`, and passes every other request to app.base44.com.

## (c) Secrets

Set from a temporary file that holds only the production keys. Never upload `.env` itself.

```sh
grep -E '^(OPENROUTER_API_KEY|OPENROUTER_MODEL|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_WHATSAPP_FROM|TAVILY_API_KEY|ADMIN_TOKEN)=.' .env > /tmp/b44.env
base44 secrets set --env-file /tmp/b44.env && rm /tmp/b44.env
base44 secrets list        # names only
base44 secrets set KEY=value   # one at a time
```

These secrets are set now: `OPENROUTER_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TAVILY_API_KEY`, `ADMIN_TOKEN`.
`OPENROUTER_MODEL` is empty, so the default model is used. LLM calls stay on OpenRouter (`shared/llm.ts`), not InvokeLLM.
Do not upload `PORT`, `DATA_DIR`, `OFFLINEBASE_*` or `TWILIO_PHONE_NUMBER`: no function reads them.

## (d) Logs and quick checks

```sh
base44 logs --since 30m                       # all functions
base44 logs --function mcp,find_resources -f  # follow
base44 logs --level error --since 2h
base44 functions list

U=https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions
curl -s $U/health                             # record counts per entity
curl -s -X POST $U/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## (f) What each person does by hand in Base44

**Nobody prompts the Base44 AI editor on this app.** We deploy this app from the repo with the CLI. Edits from the editor or chat can overwrite or conflict with that code, and the next deploy overwrites them anyway. To try the editor, use a separate scratch app.

**Ethan**
- Invite Felix and Gil from the dashboard: https://app.base44.com/apps/6aca64c59c3d35bc8bab2330. Use the invite or share button in the app's dashboard settings. Editor access lets them view data and logs.
- Run the sync, seed and secrets commands above (or ask Claude to).
- Optional: to make Scout run nightly, add a Workflow in the dashboard that calls the `scout` function.

**Felix**
- Send the three CSVs (`programs.csv`, `places.csv`, `links.csv`). `deno task import` and then `base44-seed --replace` put them live. Felix needs nothing in Base44 besides viewing data.

**Gil**
- View data in the dashboard's **Data** tab: Program, Place, Link, Submission and RequestLog.
- Programs and places come from Felix's files, and the next seed overwrites edits to them. Send fixes to Ethan or Felix instead of editing records.
- Check the site on phones in Spanish and English once the web app is deployed.
- **Twilio WhatsApp sandbox.** `send_to_phone` texts through it. Do this on every demo phone:
  1. In the Twilio Console, open Messaging > Try it out > Send a WhatsApp message. Note the sandbox number (+1 415 523 8886, the `TWILIO_WHATSAPP_FROM` we set) and the `join <two-words>` code shown there. Ethan can share Twilio console access. Never paste the Account SID or Auth Token into chats or docs.
  2. From each demo phone, send `join <two-words>` to that number on WhatsApp and wait for the confirmation.
  3. Each phone must have messaged the sandbox in the last 24 hours, so re-send any message to it on demo morning. Otherwise Twilio refuses (codes 63015 "not joined" and 63016 "outside 24h window"; `send_to_phone` explains both in plain words).
  4. Leave the sandbox's "When a message comes in" webhook alone. There is no inbound WhatsApp chat function yet, and the bot only sends.
  5. Base44 already has the Twilio secrets. Gil sets nothing in Base44 for this.
- **Voice line.** In the voice-agent tool you use, add an MCP server or tool with the connector URL above (no auth, no trailing slash). Attach our Twilio phone number to that tool; it asks for the Account SID and Auth Token, which Ethan shares privately. Test by asking for "comida cerca de 11368".
- Slides and the demo video.

## (g) Known limits

- **Free plan.** Expect function rate and usage limits. Don't load-test. Every `secrets set` redeploys the functions.
- **URLs.** No trailing slash. The gateway answers `OPTIONS` (CORS preflight) itself, with 200, so the handler never sees it. `GET /mcp` returns 405 because there is no SSE stream.
- **Unknown fields are silently dropped.** Base44 stores only fields that are defined in `base44/entities/*.jsonc`. If code writes a new field, add it to the schema, or the value disappears. We already added Place `key` and `needs`, Program `key`, and Submission `needs`, `notes`, `place_id` and `reviewed_at`.
- **Filters.** Scalar-vs-array filters work natively, as in Mongo: `{needs: "food"}` matches arrays that contain `food`, and an array value means "any of". `$in` works.
- **No unique constraints.** Uniqueness of `key` is enforced by our data layer (`create` returns 409 on a duplicate) and by upsert in the seed, not by Base44.
- **Automations.** Legacy `function.jsonc` automations are rejected because the app uses Workflows. The sync strips them.
- **Published site.** `base44 exec` needs a published site URL. The seed works around this until the web app is deployed.
- **Dashboard data.** Records edited in the dashboard are real prod data. Seeding with `--replace` deletes catalog records that are not in our files, but never submissions, logs or community places.
