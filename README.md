# Corona services map

A living map of services for immigrant New Yorkers, built for the Latinos x AI Hackathon NYC (Immigration track). It covers food, legal help, health, benefits, money, school, ID, housing, work and transit. One MCP server exposes it, so the same tools work inside Claude, ChatGPT, WhatsApp and a voice line. Every request is logged without personal data, and those logs feed an insights dashboard that shows where needs go unmet.

Demo neighborhood: Corona, Queens (zips 11368, 11373, 11372).
Personas:
- Rosa: new arrival with two kids, speaks only Spanish.
- Don Luis: bodega owner who works in cash and sends money home.

The data is a graph:
- **Programs** are the lines (IDNYC, WIC, school enrollment...).
- **Places** are the stations (a pantry, a clinic, a legal provider).
- **Links** are the transfers between them (IDNYC *unlocks* a bank account, WIC *pairs_with* Child Health Plus).

> Everything in `data/` right now is **sample data**. All places are fictional, have names ending in "(sample)", and have `trust = unverified`. Felix's real CSVs replace it in phase 3.

## Quick start

Requires [Deno](https://deno.com) 2.x.

```sh
cp .env.example .env        # add ANTHROPIC_API_KEY etc. (optional for phase 1)
deno task dev               # http://localhost:8787
```

```sh
# list functions
curl -s http://localhost:8787/

# record counts per entity
curl -s -X POST http://localhost:8787/functions/health -H 'content-type: application/json' -d '{}'
# -> {"ok":true,"counts":{"Program":8,"Place":10,"Link":11,"Submission":0,"RequestLog":0},...}

# Base44's alternate path works too
curl -s -X POST http://localhost:8787/api/apps/local/functions/health
```

Type-check everything with `deno task check`.

## Layout

```
dev.ts                    local server: /functions/<name>[/...] -> functions/<name>/entry.ts
functions/<name>/entry.ts one Base44-style function each: export default async (req) => Response
                          (flat names only, letters/digits/_/-: health, mcp, findResources)
  health/                 counts per entity
shared/                   copied verbatim to base44/shared/ when porting
  schema.ts               entity types, enums, CSV column lists (used by import validation)
  db.ts                   getDb(req).<Entity>.list/filter/get/create/update/count (Base44 SDK shape), JSON-file backed
  secrets.ts              getSecret / requireSecret (Deno.env.get only; dev.ts loads .env)
  llm.ts                  invokeLLM(req, {prompt, response_json_schema?}) (Base44 Core.InvokeLLM shape, no model param)
  http.ts                 json(), readJson(), CORS headers, errorResponse()
  logRequest.ts           logRequest(req, input): anonymous RequestLog row, whitelisted fields only, never throws
base44/entities/*.jsonc   Base44 entity schemas, ready for `base44 entities push`
data/<Entity>.json        local storage (one JSON array per entity)
```

Rules for function code: import shared code only with relative paths (`../../shared/x.ts`), access data only through `getDb(req)`, read secrets only through `shared/secrets.ts`, and make LLM calls only through `shared/llm.ts`. Code that follows these rules moves to Base44 by copying it.

`db.ts` resolves `data/` relative to the module, not to the working directory. Set `DATA_DIR=/some/copy` to point it at a copy, for example in tests. Writes take a `<Entity>.json.lock` file, so a script can write to `data/` while the dev server is running.

## Shared CSV contract

Felix produces these CSVs. They are the authoritative format. Do not change them.

```
programs.csv  id, name, needs, who_can_use, status_note, bring, how_to_apply,
              summary_es, summary_en, source_url, last_checked
places.csv    id, name, org, org_type, address, borough, zip, lat, lng, hours,
              open_evenings, open_weekends, languages, phone, trust,
              source_url, last_checked
links.csv     from_id, to_id, type, reason

ids           prog-<slug> and place-<slug>
lists         pipe-separated (food|legal)
booleans      true or false
needs         food, legal, health, benefits, money, school, id, housing, work, transit
trust         official, verified, community, unverified
org_type      doj_roster, doj_pro_bono, pantry, consulate, clinic,
              benefits_office, idnyc, remittance, check_casher, school, other
link type     offers, unlocks, pairs_with, requires, refers_to
last_checked  YYYY-MM-DD
```

In `data/*.json`:
- Lists are stored as string arrays: `needs`, `languages`, and `bring` (split on `|`).
- Booleans are stored as booleans.
- `lat` and `lng` are numbers.
- Records keep their CSV id (`prog-*`, `place-*`) as `id`.

Places have no `needs` column. A place serves a need in one of two ways:
- through a Link of type `offers` to a Program, or
- through its `org_type`, using the fallback map `ORG_TYPE_NEEDS` in `shared/schema.ts`.

Two entities extend the contract:
- **Submission**: place fields plus `status` (`pending | approved | rejected`).
- **RequestLog**: `needs, zip, language, channel (mcp|whatsapp|voice|web), results_found, unmet, created_at`. It never holds names, phones or free text.

## How data flows

```
Felix's programs.csv / places.csv / links.csv  ->  data/ (raw CSVs)
        -> scripts/import.ts (phase 3: validates against shared/schema.ts, reports bad rows)
        -> data/Program.json, Place.json, Link.json
        -> getDb(req) in every function (MCP tools, web, WhatsApp, voice)
Community / Scout submissions -> Submission (pending) -> human approval -> Place
Every tool call -> logRequest() -> RequestLog (anonymous) -> insights dashboard
```

## Trust rules

- We give information and referrals only, never legal advice. Every legal answer ends with a verified free provider.
- We never ask about immigration status.
- Every result carries `source_url` and `last_checked`.
- Nothing goes live without human approval. Scout and community submissions land as `pending`.
- Logs keep need, zip, language and channel only. `logRequest` whitelists those fields, drops everything else, and stores a zip only if it is exactly 5 digits.
- Texts carry places, hours and what to bring. Status details never leave the chat.
- Keys live in `.env`, which is gitignored. Secret values are never logged.

## Porting to Base44

1. Copy `functions/` to `base44/functions/` and `shared/` to `base44/shared/`. `base44/entities/` is already in place. Relative imports like `../../shared/db.ts` still resolve there.
2. Swap three internals:
   - `shared/db.ts`: make `getDb` return `createClientFromRequest(req).asServiceRole.entities` (`import { createClientFromRequest } from "npm:@base44/sdk"`). The method shapes (`list(sort, limit, skip)`, `filter(query, ...)`, `get`, `create`, `update`) already match.
   - `shared/llm.ts`: make `invokeLLM(req, params)` return `createClientFromRequest(req).asServiceRole.integrations.Core.InvokeLLM(params)`. Callers already pass `req`, and there is no `model` param to strip.
   - `shared/logRequest.ts`: wrap the write in `waitUntil(...)` from `base44:runtime` (`waitUntil(logRequest(req, input))`), so logging never delays the answer.
3. Set only the production secrets. Put them in a separate `.env.base44` (gitignored by `.env.*`) holding just `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TAVILY_API_KEY` and any shared-secret token, then run `base44 secrets set --env-file .env.base44`. Do not upload `.env`: `PORT`, `DATA_DIR`, `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are local only (InvokeLLM replaces the Anthropic calls), and every secret set redeploys the functions. Code reads secrets with `Deno.env.get` inside handlers, which works on both runtimes.
4. Push the entities and functions with `base44 entities push` and `base44 functions deploy`, or run `base44 deploy` to do both.

Caveats from research (test these before the demo):
- **Legacy v1/v2 backends.** These never serve a default-export handler, and `base44:runtime` and `base44/shared/` imports do not resolve there. On such an app:
  - wrap each handler as `Deno.serve(handler)`, and
  - make each `entry.ts` self-contained by inlining or bundling `shared/`.

  The same applies to functions edited in the Base44 app editor, whose FAQ says functions must be self-contained. New CLI-deployed apps run on the Cloudflare runtime, where the current layout works as is.
- **Project config.** `base44/config.jsonc` (app name, `visibility`, `functionsDir`, `entitiesDir`, `site.outputDirectory`) is not in this repo; `base44 create` or `base44 link` generates it. Keep the default `functionsDir` (`base44/functions`), because relative imports cannot escape `base44/`.
- **App visibility.** Visibility must allow unauthenticated calls for a public MCP endpoint. Set `"visibility": "public"` in `base44/config.jsonc`, then verify. Direct HTTP calls carry no user, which is why everything goes through `asServiceRole`. Protect write endpoints with a shared secret.
- **Public URL form.** The docs show two URL forms:
  - `https://<app>.base44.app/functions/<name>`
  - `https://app--<name>.base44.app/api/apps/<app-id>/functions/<name>`

  It is unconfirmed which of them passes sub-paths and GET/DELETE to the handler. MCP Streamable HTTP needs this, so test it.
- **Custom ids.** Base44 assigns ids itself and may not accept `prog-*` / `place-*` as `id` on create. If it rejects them, add a `key` field, upsert on it, and keep Link `from_id`/`to_id` pointing at that key.
- **No unique constraints.** Entities have none, so import must check for existing records or use `upsert`.

## Phases

- [x] 1. Scaffold, shared/ helpers, dev.ts, README, sample data (10 Corona places, all `unverified`)
- [ ] 2. `functions/mcp` with a `ping` tool, plus a cloudflared tunnel
- [ ] 3. `scripts/import.ts`: validate programs.csv, places.csv and links.csv into data/ and report bad rows
- [ ] 4. `find_resources` and `make_plan`
- [ ] 5. `check_provider` and `send_to_phone`
- [ ] 6. `web/`: directory and submit form, admin queue, insights (Spanish default, English toggle)
- [ ] 7. `functions/scout` (Tavily) and PORTING.md
