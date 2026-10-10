# Running NYC Navigator on Base44

The live app is **NYC Navigator**, app id `6aca64c59c3d35bc8bab2330`. It is on the Free plan, set to public, and runs on Base44's new Cloudflare runtime.
Dashboard: https://app.base44.com/apps/6aca64c59c3d35bc8bab2330

All the code lives in this repo. Base44 gets a generated copy of it, and nobody edits code inside Base44.

| What | Where |
|---|---|
| Our code (edit this) | `handlers/`, `shared/` |
| Base44-only versions of 4 files | `base44-overrides/shared/` (`db.ts`, `auth.ts`, `logRequest.ts`, `llm.ts`) |
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
- It wipes and regenerates `base44/functions/` and `base44/shared/`. It copies every `handlers/<name>/` that has an `entry.ts`, including its `function.jsonc`, and all of `shared/`.
- It copies `base44-overrides/shared/*` on top:
  - `db.ts` uses `createClientFromRequest(req).asServiceRole.entities`.
  - `auth.ts` accepts either `x-admin-token` or a signed-in Base44 user with role admin.
  - `logRequest.ts` wraps the write in `waitUntil`.
  - `llm.ts` keeps the repo-root OpenRouter call when the `OPENROUTER_API_KEY` secret is set, and falls back to Base44's `Core.InvokeLLM` only when it is not.
  - An override that imports `./X.local.ts` builds on the repo-root original, which the sync copies in under that name.
- It fails if an override no longer exports everything that the repo-root file exports. If someone adds an export to `shared/db.ts`, add it to the override as well.
- It fails if a relative import resolves outside `base44/`, or if a bare import is not one of `npm:` / `jsr:` / `node:` / `https:` / `base44:runtime`. Base44 ignores `deno.json` import maps.
- It runs `deno check` with a throwaway config that stubs `base44:runtime`, and writes nothing into the repo for this. `--no-check` skips it.
- It removes `"automations"` from the generated `function.jsonc`. This app uses Base44 Workflows, which reject legacy automations with error 409 and fail the whole deploy. Scout is not scheduled on Base44; see (f).
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
- **Scout runs by hand for the demo**, with the admin token (the admin page has no Scout button):
  `curl -s -X POST $U/scout -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"query":"food pantry Corona Queens","max_results":5}'`
  New drafts land in the review queue as pending Submissions. A nightly Workflow that just calls `scout` gets 401, because `scout` requires the admin token. The repo's `scout` now also accepts a `SCOUT_TOKEN` secret sent in the body (`scout_token`), which is the path for a Workflow, but that version is not deployed yet and `SCOUT_TOKEN` is not set. Leave nightly runs off for the demo.

**Felix**
- Send the three CSVs (`programs.csv`, `places.csv`, `links.csv`). `deno task import` and then `base44-seed --replace` put them live. Felix needs nothing in Base44 besides viewing data.

**Gil**
- View data in the dashboard's **Data** tab: Program, Place, Link, Submission and RequestLog.
- Programs and places come from Felix's files, and the next seed overwrites edits to them. Send fixes to Ethan or Felix instead of editing records.
- Check the site on phones in Spanish and English once the web app is deployed.
- **Twilio and the voice line: the team checklist is the source of truth.** Gil's prompt on https://claude.ai/artifact/2yW8hwuCAqNudm2W2hZ8b6 has the full steps. The short version, checked against Twilio's API at 12:45:
  - **The account is still on Trial.** If the Console shows no Trial banner, skip the trial-only steps.
  - **Our number, +1 743 330 7616 (voice + SMS), still points at Twilio's demo** (`demo.twilio.com`) for both calls and texts. Calling it plays Twilio's demo message until ElevenLabs takes it over.
  - **WhatsApp sandbox.** `TWILIO_WHATSAPP_FROM` is the sandbox number, +1 415 523 8886. On every demo phone, send exactly `join package-question` to it on WhatsApp and wait for the reply. A join lasts 3 days. The phrase and a QR code are also in Console > Messaging > Try it out > Send a WhatsApp message.
  - **Trial only: verify each demo phone** in Console > Phone Numbers > Manage > Verified Caller IDs (4 free slots, SMS code). On a trial, Twilio only messages and takes calls from verified numbers (error 21608 otherwise).
  - **24-hour window.** Between 4:00 and 4:45, each demo phone sends "hola" to the sandbox. Errors: 63015 = not joined, 63016 = no message from that phone in 24 hours. The sandbox sends at most one message every 3 seconds.
  - **Leave the sandbox's "When a message comes in" setting alone.** There is no inbound WhatsApp function; the bot only sends.
  - **Voice, step 0: make one test call first.** Import +1 743 330 7616 into ElevenLabs (Phone Numbers > Import > Twilio, with the Account SID and Auth Token Ethan shares privately, never in chats or docs) and call it from a verified phone. If it says "The Stream verb is not available on trial accounts", the trial blocks voice agents: upgrade Twilio (about $20), use a free Vapi number, or demo the agent from the laptop.
  - **ElevenLabs MCP server:** Integrations > Add Custom MCP Server, URL = the connector URL in (e), no token or headers, transport Streamable HTTP (not SSE), approval No Approval or Fine-Grained with every tool auto-approved (not Always Ask). 5 tools should appear. **Set the tool timeout to 15 s or more:** `find_resources` and `make_plan` take 6 to 9 seconds on Base44 right now (see (g)). `check_provider` takes under half a second.
  - Gil sets nothing in Base44 for any of this; the Twilio secrets are already there.
- Slides and the demo video.

## (g) Known limits

- **Free plan.** Expect function rate and usage limits. Don't load-test. Every `secrets set` redeploys the functions.
- **URLs.** No trailing slash. The gateway answers `OPTIONS` (CORS preflight) itself, with 200, so the handler never sees it. `GET /mcp` returns 405 because there is no SSE stream.
- **Validation.** Base44 enforces only `required`. `pattern` and `format` are not checked (a Submission with zip `"abc"` was stored), so ids, zips and URLs are validated in our code (`scripts/import.ts`, the seed's `keyed()`, `cleanFields`). Unset fields read back as `null`, not missing. Booleans that the code derives from hours (`open_evenings`, `open_weekends`) have no schema default, so an unset value stays `null` and the hours fallback runs on approval.
- **AI latency.** At 12:30 and again after the last sync, `find_resources` took 7 to 9 seconds through the public URL and often hit its 8-second LLM cap, returning `summaries_by: "template"`. `make_plan` took 6 to 8 seconds. The same OpenRouter call takes about 2 seconds from a laptop. The fix in `shared/llm.ts` (reasoning off) is synced into `base44/` but **not deployed yet**. After `--deploy`, time it again (see (d)). If it is still slow, log per-call time in the OpenRouter fetch on the Workers runtime.
- **Unknown fields are silently dropped.** Base44 stores only fields that are defined in `base44/entities/*.jsonc`. If code writes a new field, add it to the schema, or the value disappears. We already added Place `key` and `needs`, Program `key`, and Submission `needs`, `notes`, `place_id` and `reviewed_at`.
- **Filters.** Scalar-vs-array filters work natively, as in Mongo: `{needs: "food"}` matches arrays that contain `food`, and an array value means "any of". `$in` works.
- **No unique constraints.** Uniqueness of `key` is enforced by our data layer (`create` returns 409 on a duplicate) and by upsert in the seed, not by Base44.
- **Automations.** Legacy `function.jsonc` automations are rejected because the app uses Workflows. The sync strips them.
- **Published site.** `base44 exec` needs a published site URL. The seed works around this until the web app is deployed.
- **Dashboard data.** Records edited in the dashboard are real prod data. Seeding with `--replace` deletes catalog records that are not in our files, but never submissions, logs or community places.
