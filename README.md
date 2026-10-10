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

> Everything in `data/` right now is **sample data**. All places are fictional, have names ending in "(sample)", and have `trust = unverified`. Felix's real CSVs replace it through `deno task import`.

## Quick start

Requires [Deno](https://deno.com) 2.x and Node 18+ (for the web app only).

```sh
cp .env.example .env        # fill in OPENROUTER_API_KEY, TWILIO_*, TAVILY_API_KEY, ADMIN_TOKEN
deno task dev               # backend on http://localhost:8787
deno task dev:watch         # same, restarts on every save under functions/ or shared/
```

Without `OPENROUTER_API_KEY` everything still works: summaries and plan text fall back to fixed templates.

```sh
# list functions
curl -s http://localhost:8787/

# public catalog counts (add -H "x-admin-token: $ADMIN_TOKEN" to also see Submission and RequestLog)
curl -s -X POST http://localhost:8787/functions/health -H 'content-type: application/json' -d '{}'
# -> {"ok":true,"counts":{"Program":8,"Place":10,"Link":11},...}

# one tool over plain HTTP (each tool is also its own function)
curl -s -X POST http://localhost:8787/functions/find_resources -H 'content-type: application/json' \
  -d '{"need":"food","near":"Corona","language":"es"}'
```

### Web app (directory, submit form, admin queue, insights)

```sh
cd web && npm install
npm run dev                 # http://localhost:5180, proxies /functions -> :8787
npm run build               # -> web/dist/
```

Admin pages (`#/admin`, `#/insights`) ask once per tab for the `ADMIN_TOKEN` from `.env`. See `web/README.md`.

### Loading Felix's data

```sh
# put programs.csv, places.csv, links.csv in data/, then:
deno task import --dry-run  # validate only, shows every bad row with its line number
deno task import            # replace the sample rows with his (add --keep-sample to keep the Corona demo rows)
```

Rules and exit codes: `scripts/README.md`. Loading the same data into Base44: `PORTING.md`.

### Tests

```sh
deno task check                                                        # type-check
deno task test                                                         # unit tests (tests/)
deno test --allow-read --allow-env --allow-write tests/                # + RequestLog checks on a temp data copy
deno test --allow-read --allow-write --allow-env scripts/              # CSV import (fixtures)
deno run -A scripts/base44-sync.ts                                     # regenerate + type-check the Base44 copy
```

## MCP connector (Claude, ChatGPT)

The MCP server is `functions/mcp` (stateless Streamable HTTP, JSON-RPC over POST). To use the local server from Claude:

```sh
deno task dev:watch                                          # :8787
cloudflared tunnel --no-autoupdate --url http://localhost:8787
# prints https://<random-words>.trycloudflare.com
```

In Claude: Settings > Connectors > Add custom connector, URL `https://<random-words>.trycloudflare.com/functions/mcp`, no auth. A quick tunnel gets a new hostname every time cloudflared restarts, so update the connector after a restart. To find the current hostname of a running tunnel: `curl -s localhost:20241/quicktunnel`.

On Base44 the connector URL is `https://nyc-navigator.base44.app/api/apps/6aca64c59c3d35bc8bab2330/functions/mcp` (see `PORTING.md`).

Quick check:

```sh
curl -s -X POST <url> -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Tools

| Tool | What it does |
| --- | --- |
| `find_resources` | Top 5 places for one need near a zip, neighborhood or borough: official/verified first, then nearest, then open now and evening/weekend hours when `open_now`. Each has hours, languages, what to bring, trust, source and last-checked date, plus a 1-2 sentence summary in the person's language. Lists related programs when few places match. |
| `make_plan` | One best place per need, ordered by Links so the step that unlocks the others comes first (IDNYC before WIC or a bank account). With legal, adds an intake summary (English for the lawyer, Spanish for the person) built only from what the person said, never stored. Returns `plan_text` ready for WhatsApp. |
| `check_provider` | Fuzzy-matches a notario, consultant or lawyer name against the DOJ roster and pro bono list. Returns found or not, the match, a plain warning when not found, and up to 3 free DOJ-listed legal providers nearby. |
| `send_to_phone` | Sends a plan by WhatsApp (Twilio sandbox) only when `consent` is the boolean `true`. Strips anything about immigration status, never logs the number. |
| `ping` | Connectivity check. |

Every tool call writes one anonymous RequestLog row (needs, zip, language, channel, results_found, unmet). Calls rejected as bad input (unknown need, missing place) write one row with `unmet: true`. `ping` is not logged.

### Demo prompts

Paste into Claude with the connector on:

1. Rosa: `Acabo de llegar a Corona con mis dos hijos. Necesito comida y no sé qué es seguro pedir.` Expected: IDNYC first, then the pantry, then the clinic with WIC and Child Health Plus, each with hours, what to bring, source and date.
2. Notario: `Un señor en la agencia de viajes dice que me arregla los papeles por $3,000.` Expected: not on the DOJ lists, the warning that notarios cannot give legal help, free DOJ-listed providers nearby, and (if asked for a plan) the intake summary for the lawyer.
3. WhatsApp: `Mándame el plan por WhatsApp al +1 ...` Expected: Claude asks for permission first; with consent the text carries places, hours and what to bring only. The Twilio account is a trial: the number must have joined the sandbox.
4. Don Luis: `Tengo una bodega en Corona, me pagan en efectivo y mando dinero a mi familia en México. ¿Dónde puedo mandar dinero y abrir una cuenta?` Expected: the money transfer shop (fees apply), plus the starter bank account program with "get IDNYC first".
5. Dashboard: open `#/insights` in the web app (admin token) to show requests by need, unmet by zip, language and channel mix, labeled Test traffic.

## Layout

```
dev.ts                    local server: /functions/<name>[/...] -> functions/<name>/entry.ts
functions/<name>/entry.ts one Base44-style function each: export default async (req) => Response
                          (flat names only, letters/digits/_/-: health, mcp, findResources)
  health/                 catalog counts (all counts for admins)
  mcp/                    the MCP server (tools from shared/tools/index.ts)
  find_resources/ ...     one thin HTTP wrapper per tool, plus list_places, submit_resource, review_queue, insights, scout
shared/                   copied verbatim to base44/shared/ when porting
  schema.ts               entity types, enums, CSV column lists (used by import validation)
  db.ts                   getDb(req).<Entity>.list/filter/get/create/update/count (Base44 SDK shape), JSON-file backed
  secrets.ts              getSecret / requireSecret (Deno.env.get only; dev.ts loads .env)
  llm.ts                  invokeLLM(req, {prompt, response_json_schema?}) (Base44 Core.InvokeLLM shape; OpenRouter locally, reasoning off)
  rank.ts                 catalog loading, ranking, output shapes, the one LLM call per tool (8s cap + template fallback)
  redact.ts               the one status vocabulary: mentionsStatus / statesStatus / redactStatus
  tools/                  one file per MCP tool + index.ts registry + wrap.ts (tool -> HTTP function)
  web/                    list_places, submit_resource, review_queue, insights
base44-overrides/shared/  Base44 versions of db.ts, llm.ts, logRequest.ts, auth.ts (scripts/base44-sync.ts)
scripts/                  import.ts (CSV -> data/), base44-sync.ts, base44-seed.ts (local only)
web/                      React + Vite frontend
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
- through its `org_type`, using the fallback map `PLACE_ORG_NEEDS` in `shared/rank.ts` (consulates count for ID only).

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

- We give information and referrals only, never legal advice. Every legal answer ends with a free DOJ-listed provider (verified ones first; the heading says "verified" only when they are).
- We never ask about immigration status.
- Every result carries `source_url` and `last_checked`.
- Nothing goes live without human approval. Scout and community submissions land as `pending`.
- Logs keep need, zip, language and channel only. `logRequest` whitelists those fields, drops everything else, and stores a zip only if it is exactly 5 digits.
- Texts carry places, hours and what to bring. Status details never leave the chat.
- Keys live in `.env`, which is gitignored. Secret values are never logged.

## Porting to Base44

Everything that changes in the Base44 copy, the exact commands, the secrets, data loading and a pre-demo checklist are in [PORTING.md](PORTING.md). Short version: `deno run -A scripts/base44-sync.ts --deploy` regenerates `base44/functions` and `base44/shared` from this repo (with the Base44 versions of `db.ts`, `llm.ts`, `logRequest.ts` and `auth.ts` from `base44-overrides/`) and deploys them; `deno run -A scripts/base44-seed.ts` loads `data/*.json` into the Base44 entities.

## Phases

- [x] 1. Scaffold, shared/ helpers, dev.ts, README, sample data (10 Corona places, all `unverified`)
- [x] 2. `functions/mcp` with a `ping` tool, plus a cloudflared tunnel
- [x] 3. `scripts/import.ts`: validate programs.csv, places.csv and links.csv into data/ and report bad rows
- [x] 4. `find_resources` and `make_plan`
- [x] 5. `check_provider` and `send_to_phone`
- [x] 6. `web/`: directory and submit form, admin queue, insights (Spanish default, English toggle)
- [x] 7. `functions/scout` (Tavily), nightly schedule config, PORTING.md, Base44 sync and seed scripts
- [ ] Load Felix's real programs.csv / places.csv / links.csv (`deno task import`, then `scripts/base44-seed.ts`)

Waiting on Felix's data:
- Every sample place is `unverified`, and there are only 2 DOJ places, so legal answers say "free legal providers on the DOJ lists" (not "verified") and list 2 providers, not 3. Rows marked `official` or `verified` switch the wording automatically.
- Program `bring`, `status_note` and `who_can_use` are English only. `make_plan` translates the bring list in its one AI call; `find_resources` and the web cards still show English. Optional extra columns such as `bring_es` and `status_note_es` would need an importer change and a CSV contract change, so agree on them with Felix first.
- A bank or credit union place that offers `prog-bank-account` would give Don Luis a place, not just a program.
