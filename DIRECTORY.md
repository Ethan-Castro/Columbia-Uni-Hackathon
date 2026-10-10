# Directory readiness: OpenAI Plugin Directory and Claude Connectors Directory

What to submit to each directory, ready to copy. **Nothing is submitted yet.** Facts come from the OpenAI plugin docs (developers.openai.com/plugins, fetched 2026-10-10) and the Claude connector docs (claude.com/docs/connectors, fetched 2026-10-10). **(unconfirmed)** marks anything those docs do not state.

## What the server already does

- One stateless MCP server: `functions/mcp`. It speaks JSON-RPC over POST, needs no auth and never returns 401.
- One MCP Apps widget, `ui://navigator/card-v1.html` (`shared/ui/card.ts`), shared by ChatGPT and Claude. It is a single file with no external assets, so its CSP is empty. `find_resources`, `make_plan` and `check_provider` render it.
- Every tool has a `title` and explicit `readOnlyHint`, `destructiveHint` and `openWorldHint` (`shared/tools/index.ts`).
- Every UI result carries `structuredContent`, plus a short Spanish-first text with the source, checked date and disclaimer (`shared/ui/result.ts`).
- Policy pages and icons are in `web/public/` and ship with the web build:
  - `privacy.html`, `terms.html`, `support.html`
  - `icon.svg` and `icon.png` (512×512, square, brand teal `#1f5f5b`)

## Blockers before either submission

1. **A stable custom domain.** Use something like `mcp.<our-domain>`, fronted by a small proxy (for example a Cloudflare Worker) in front of the Base44 function.
   - A quick tunnel is not accepted.
   - Changing the origin later (scheme, host or port) means creating a new ChatGPT plugin.
   - The OpenAI domain challenge has to be served on the MCP hostname or an eligible parent domain. The shared `base44.app` host most likely can't pass it **(unconfirmed)**.
2. **Public HTTPS URLs for the four pages.** Both directories need the privacy, terms and support pages, plus a website or docs URL. After `base44 site deploy` they should be at `https://<site>/privacy.html`, `/terms.html` and `/support.html` **(unconfirmed until the site is deployed)**.
3. **The support email.** Replace `[support email]` in `web/public/support.html` with the team's real address.
4. **Real data, not sample data.** OpenAI rejects "trial or demo plugins". The sample rows are tagged `(sample)` and are now being replaced by Felix's data.
5. **Tool descriptions that state facts, not instructions.** Both reviews reject descriptions that tell the model how to behave.
   - Move lines like "ALWAYS ask permission first" and "End your answer with…" out of the tool files and into the server `instructions`.
   - Not done yet. The tool files belong to another workstream.
6. **The location input `near` (OpenAI only).** OpenAI's guidelines say not to request precise location or raw location fields.
   - Consider limiting `near` to a ZIP code or borough.
   - Consider making it optional, with a fallback to `_meta["openai/userLocation"]`.
   - How strictly review enforces this is **(unconfirmed)**.

## Shared listing text

| Field | Text | Length |
| --- | --- | --- |
| Name | Navegador NYC | 13 |
| Short description (≤30) | Free help for NYC immigrants | 28 |
| One-liner (≤200) | Find free food, health, legal help, ID and more near you in New York City, in Spanish or English, with each place's source and checked date. Check a notario against the DOJ lists. | 179 |

**Long description (English, for both; ChatGPT ≤4000, Claude ≤2000):**

> Navegador NYC (NYC Navigator) helps immigrant New Yorkers find free services near them: food pantries, clinics and Child Health Plus, free legal help, IDNYC, benefits, school enrollment, money transfer and banking, housing, work and transit.
>
> Ask in Spanish or English. The answer is a short list of places with address, hours, an "open now" label, languages spoken, what to bring, a trust label, and a link to the source with the date it was last checked. For several needs at once, it builds a step-by-step plan in the right order, for example IDNYC before a bank account. If someone offers to "fix your papers", it checks the name against the Department of Justice lists of recognized organizations, accredited representatives and pro bono providers, and shows free DOJ-listed options nearby.
>
> With the person's explicit yes, it can send the plan to their WhatsApp. The phone number is never stored.
>
> Information and referrals only, never legal advice. It never asks about immigration status. Requests are logged anonymously (kind of help, zip code, language, channel) to show where services are missing. No account is needed.

**Spanish description (for the Spanish listing field or the docs page):**

> Navegador NYC ayuda a inmigrantes en Nueva York a encontrar servicios gratuitos cerca: comida, salud, ayuda legal gratuita, IDNYC, beneficios, escuela, dinero, vivienda, trabajo y transporte. Cada lugar muestra dirección, horario, idiomas, qué llevar, su fuente y la fecha de revisión. Revisa si un notario o consultor aparece en las listas del DOJ y muestra opciones gratuitas cerca. Con su permiso, le envía el plan por WhatsApp. Información y referidos, nunca consejo legal. Nunca preguntamos por su situación migratoria.

**Starter prompts** (ChatGPT allows at most 3, each ≤128 characters, no @mentions):

1. `¿Dónde consigo comida gratis cerca de 11368?`
2. `Acabo de llegar a Corona con mis dos hijos. ¿Qué hago primero?`
3. `Un notario me ofrece arreglar mis papeles por $3,000. ¿Está en la lista del DOJ?`

### Test cases (ChatGPT needs exactly 5 positive and 3 negative; reuse them as Claude's test instructions)

Positive cases: the tool should be called.

| # | Prompt | Expected |
| --- | --- | --- |
| 1 | ¿Dónde consigo comida cerca de 11368? | `find_resources` with need=food and near=11368. The card lists up to 5 places, each with hours, open-now, languages, a trust label and "Fuente · revisado el DATE". |
| 2 | Acabo de llegar a Corona con mis hijos, necesito comida, doctor y una identificación. | `make_plan` with needs food, health and id. IDNYC comes first, and each step explains why it is in that order and what to bring. |
| 3 | Un señor en la agencia de viajes dice que me arregla los papeles por $3,000. Se llama José Pérez. | `check_provider` with name "José Pérez". The result says he is not on the DOJ lists and that notarios can't give legal help, then lists free DOJ-listed options nearby. No legal advice. |
| 4 | Where can I find a free immigration lawyer in Queens? | `find_resources` with need=legal and near=Queens, in English. Ends with a free DOJ-listed provider and its source and date. |
| 5 | Mándame el plan por WhatsApp. | The model asks for permission and the number first. `send_to_phone` runs only after an explicit yes (`consent: true`), and the host shows its write or destructive confirmation. |

Negative cases: no tool call, or a refusal to go beyond information.

| # | Prompt | Expected |
| --- | --- | --- |
| 1 | What's the weather in Manhattan tomorrow? | No tool call. Out of scope. |
| 2 | ¿Califico para asilo? Mi situación es… | No legal advice and no question about status. The answer suggests a free DOJ-listed provider (it may call `find_resources` with need=legal). |
| 3 | Send this plan to +1 718 555 0101. (the number's owner has not said yes) | No `send_to_phone` call until the person explicitly says yes. Without `consent: true` the tool sends nothing. |

### Annotation justifications (ChatGPT asks for one per hint)

| Tool | readOnly | destructive | openWorld | Why |
| --- | --- | --- | --- | --- |
| find_resources | true | false | false | Reads our own curated dataset and writes nothing the user can see. The only write is one anonymous log row. |
| make_plan | true | false | false | Same dataset. The intake summary is returned to the user, never stored. |
| check_provider | true | false | false | Compares a name against the DOJ rows in our dataset. The name is never logged. |
| send_to_phone | false | true | true | Sends a WhatsApp message to an outside number. A sent message can't be undone. It also requires `consent: true`. |
| ping | true | false | false | Connectivity check. |

## OpenAI Plugin Directory (ChatGPT)

**Portal:** platform.openai.com/plugins → Upload new or existing plugin. Since 2026-07-09 the App Directory is the Plugin Directory.

**Who can submit:**
- The org owner, or a member with Apps Management Write.
- Individual or business verification must be done first, in organization settings.

**What to prepare:**

1. **A plugin ZIP** in Agent Plugins format:
   - Root `plugin.json` with `$schema`, `name: "nyc-navigator"`, version, description, author, and `extensions.com.openai` (interface, review, `publication.countries: ["US"]`).
   - Root `mcp.json`: `{"mcpServers":{"nyc-navigator":{"type":"streamable-http","url":"https://<stable-host>/mcp"}}}`.
   - The test cases above can be imported from `extensions.com.openai.review`.
   - No `hooks/` or `.app.json`; either blocks submission.
2. **Listing:**
   - displayName (≤30), shortDescription (≤30), longDescription (≤4000), up to 3 starter prompts.
   - Website, privacy, terms and support URLs, all HTTPS.
3. **Icons:** `logo` (required) = `web/public/icon.png` or `icon.svg`. They must be square, at least 48×48, PNG/JPEG/WebP/SVG, ≤5 MiB.
   - Optional: `logoDark`, `composerIcon`, `brandColor: "#1f5f5b"`.
4. **Screenshots:** optional for UI plugins. One per starter prompt, exactly 706 px wide and 400–860 px tall.
5. **Review package:**
   - Exactly 5 positive and 3 negative test cases.
   - A demo-recording URL (web and mobile).
   - Release notes.
   - The annotation justifications above.
6. **`_meta.ui.domain`:** a unique origin string is required for plugins with UI.
   - Claude rejects any value except its own hash domain, so serve ChatGPT from its own endpoint, such as `https://<host>/mcp?client=openai`.
   - Add `ui.domain` and `openai/widgetDomain` only there.
   - Add the real `source_url` hosts to `openai/widgetCSP.redirect_domains` in `shared/ui/card.ts`.
7. **Suitability:** ages 13–17. It must work on desktop and mobile, including the widget.

**Domain verification steps:**

1. After uploading the ZIP, open MCPs → Connect and enter `https://<stable-host>/mcp`.
2. The portal shows a challenge token.
3. Serve that token as plain text (the token only, nothing else) at `https://<stable-host or eligible parent>/.well-known/openai-apps-challenge`. Paths on the MCP URL are ignored.
   - With the proxy in place, add that one route to the Worker.
   - It cannot be served from the shared `base44.app` host.
4. Press Verify, then run the scan.
5. Only one MCP server can be connected per plugin.

**After approval:**
- We publish manually.
- OpenAI scans the server daily, and eligible tool changes go live after automated checks.
- There is no expedited review.

## Claude Connectors Directory

**Portal:** claude.ai/directory/manage → Submit new → MCP connector.
- Requires a Pro, Max, Team or Enterprise account; on Team and Enterprise an Owner submits.
- No domain proof is needed.

**What to prepare:**

1. **Server URL:** `https://<stable-host>/mcp`, remote HTTPS, no auth. That is acceptable because the data is public.
   - Must be IPv4 reachable, with no cross-host redirects and no bot challenge.
2. **Listing:**
   - Name (≤100), one-liner (≤200), description (≤2000).
   - 1–5 categories, suggested: Public services, Legal, Health **(category names unconfirmed)**.
   - The slug is permanent. Suggested: `navegador-nyc`.
3. **URLs:** docs (`support.html` or the README), privacy (`privacy.html`), support contact. Icon: `web/public/icon.png` (512×512) and `icon.svg`.
4. **Test instructions:** "No login needed. Add the URL, then try the 5 positive prompts above."
5. **Screenshots (MCP App):**
   - 3–5 PNGs, at least 1000 px wide, cropped to the app response with no prompt in the image.
   - Supply each screenshot's prompt text separately.
   - No video or GIF.
   - Suggested shots: the find_resources card, the make_plan card, and the check_provider card.
6. **Allowed link URIs:** leave empty.
   - Only origins or schemes we own can be listed, so Google Maps, Apple Maps and justice.gov can't be, and `tel:` is rejected.
   - The "Open external link" modal therefore stays.
7. **Tools:** every tool already has a `title` and readOnly/destructive hints. Destructive tools (`send_to_phone`) always prompt in Claude.
8. **Compliance:** the 7 compliance acknowledgments in the form.

**After submission:**
- After automated scanning the connector is listed as "Community" by default.
- Human review time varies. Escalations go to mcp-review@anthropic.com.
- A Claude **Plugin** listing (skills plus connector) additionally needs a public GitHub repo, a README of at least 40 words, a license, and a human review.

## Before pressing Submit

- [ ] Stable domain live, `/mcp` answers `initialize` with `resources` in capabilities.
- [ ] `tools/list` shows titles, annotations and `_meta.ui.resourceUri` on the three UI tools (`deno task test` covers this in `tests/mcp_apps_test.ts`).
- [ ] `resources/read` returns `text/html;profile=mcp-app`. Bump `card-v1` to `card-v2` after any widget change.
- [ ] Privacy, terms and support pages live over HTTPS, and the support email is filled in.
- [ ] Real data loaded and no `(sample)` rows in answers.
- [ ] Tool descriptions cleaned up (blocker 5).
- [ ] ChatGPT only: `?client=openai` endpoint with `ui.domain`, domain challenge served, demo recording on web and phone.
- [ ] Claude only: 3–5 screenshots at 1000 px or wider, cropped to the card.
