# Sustainability: what it costs to run, and who might pay

NYC Navigator (https://inmigracion-nyc.com) is moving from a hackathon project to a real service. This page covers what one conversation costs on each door, the monthly bill at three sizes, how to leave ElevenLabs, where to host, and who might fund it.

All prices were checked on **2026-10-17** unless a row says otherwise. Where we estimate, the arithmetic is shown. Anything we could not confirm is marked **unverified**.

## 0. What the code actually does per request

Read from the code, then measured locally: we ran `answerMessage` with a stubbed `fetch` that counts and sizes each OpenRouter call. No real model calls were made.

| Path | Model calls | Prompt size (measured) | Notes |
|---|---|---|---|
| WhatsApp "hola" | 0 | – | A keyword greeting check answers it (`parseKeywords` in `shared/whatsapp.ts`). |
| WhatsApp find turn | 2 | parse 1,410 chars + summaries 2,785 chars | `understand()` makes 1 parse call (4 s cap), then `findResources` makes 1 summary call (`writeSummaries`, 8 s cap). |
| WhatsApp plan turn | 2 | parse 1,485 + plan 5,074 chars | `understand()`, then `makePlan` (1 call). |
| WhatsApp check_provider | 1 | parse only | `check_provider.ts` makes no model call. |
| MCP `find_resources` | 1 | ~2,800 chars | Same call as above. |
| MCP `make_plan` | 1 | ~5,100 chars (4 needs) | |
| Website search | 0 | – | The site calls only `list_places` (`web/src/api.ts`), with no model call. |
| /voz one-shot | 1 + TTS (+ STT) | parse only | `shared/voice.ts` `voiceQuery`, then `/speak` (ElevenLabs TTS) and, without on-device recognition, `/transcribe` (Scribe). |
| /voz live and phone line | ElevenLabs agent | – | `web/public/voz/index.html` opens an ElevenLabs agent session (`AGENT_ID`). The phone line is the same kind of agent, and it calls our MCP tools. |

**Which model runs in production.** `shared/llm.ts` defaults to `anthropic/claude-haiku-5.5`. BASE44.md says `OPENROUTER_MODEL` is empty on Base44, and it is empty in `.env` too, so **production uses Haiku 5.5, not GLM**. `z-ai/glm-5.3-flash` is used only by the offline `scripts/articles.ts`. Both are priced below.

**Token estimate.** Tokens = characters ÷ 3.5 (a rough rule for Spanish plus JSON).
- Parse call: about 400 tokens in, 50 out.
- Summaries call: about 800 in, 300 out (5 places × 18 words, plus JSON).
- Plan call: about 1,450 in, 700 out.

Output sizes are estimates, not measurements.

**Catalog reads.** Every `find_resources`, `make_plan` and voice request calls `loadCatalog` (`shared/rank.ts`). That is 4 entity list calls reading about 1,315 rows (1,174 Place, 105 Program, 36 Link, plus open Feedback), with no cache.

## 1. Cost per conversation, per door

### Unit prices

| Item | Price | Source (as of 2026-10-17) |
|---|---|---|
| OpenRouter `anthropic/claude-haiku-5.5` | $0.10 / M input, $0.50 / M output | [OpenRouter models API](https://openrouter.ai/api/v1/models) |
| OpenRouter `z-ai/glm-5.3-flash` | $0.048 / M input, $0.20 / M output | [OpenRouter models API](https://openrouter.ai/api/v1/models) |
| Twilio WhatsApp fee | $0.005 per message, inbound or outbound | [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing) |
| Meta, service (non-template) messages | Free inside the 24 h customer service window | [Meta WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing) |
| Meta, utility template outside the window | $0.0034 per message (US) | Twilio calculator at the link above. Meta's own rate card was not read, so this is **unverified** against Meta. |
| Twilio US local number | $1.15 / month | [Twilio voice pricing (US)](https://www.twilio.com/en-us/voice/pricing/us) |
| Twilio inbound voice, local | $0.0085 / min | Same page |
| ElevenLabs Agents | $0.08 / min, plus LLM ($0.0005 to $0.045 / min, depending on model) | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api); LLM range from [getmacha](https://www.getmacha.com/blog/elevenlabs-agents-pricing-explained) (third party) |
| ElevenLabs TTS Multilingual v2 | $0.08 / 1k chars | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) |
| ElevenLabs Scribe v2 STT | $0.22 / hour (≈ $0.0037 / min) | Same page |

### Per model call (Haiku 5.5, production)

| Call | Arithmetic | Cost |
|---|---|---|
| parse | 400 × $0.10/M + 50 × $0.50/M | $0.000065 |
| summaries | 800 × $0.10/M + 300 × $0.50/M | $0.00023 |
| plan | 1,450 × $0.10/M + 700 × $0.50/M | $0.000495 |

With GLM 5.3 Flash the same calls cost $0.000029, $0.000098 and $0.00021, about 55% less. The LLM is under 2% of the total bill on every door, so switching models saves little.

### Per conversation

| Door | Assumption | Arithmetic | Cost |
|---|---|---|---|
| WhatsApp | 2 turns ("hola", then one find), user writes first, so service window | 4 msgs × $0.005 + parse + summaries; Meta $0 | **$0.0203** |
| WhatsApp + `send_to_phone` | Adds 1 outbound plan to a person who has not written in (needs a utility template in production) | + $0.005 + $0.0034 | +$0.0084 |
| ChatGPT / Claude (MCP) | 1 `find_resources` + 1 `make_plan`; only our backend cost (the user pays for their chat) | $0.00023 + $0.000495 | **$0.0007** |
| Phone, 3 min (ElevenLabs) | Agent all 3 min, low-end LLM, 1 `find_resources` | 3 × $0.08 + 3 × $0.0085 + 3 × $0.0005 + $0.00023 | **$0.267** |
| /voz live, 2 min | ElevenLabs agent in the browser, no telephony | 2 × $0.08 + 2 × $0.0005 + $0.00023 | **$0.161** |
| /voz one-shot | Browser speech in, ElevenLabs TTS out, about 150 chars | 150/1000 × $0.08 + parse | $0.012 |
| Website search | `list_places` only | hosting only | **≈ $0** |

Base44 does not publish a price per function call or per entity read. Its backend is "in beta and free to use", and operations draw on integration credits ([Base44 docs](https://docs.base44.com/developers/backend/overview/pricing)). How many credits a function call uses is **unverified**.

## 2. Monthly cost at three sizes

Door mix (assumed): WhatsApp 40%, ChatGPT/Claude 30%, website 20%, phone 5%, /voz live 5%.

| Line | 1k conv/mo | 10k | 100k |
|---|---|---|---|
| WhatsApp (400 / 4k / 40k × $0.0203) | $8.12 | $81.18 | $811.80 |
| MCP (300 / 3k / 30k × $0.0007) | $0.22 | $2.17 | $21.75 |
| Website | $0 | $0 | $0 |
| Phone (50 / 500 / 5k × $0.267) | $13.36 | $133.62 | $1,336.15 |
| /voz live (50 / 500 / 5k × $0.161) | $8.06 | $80.62 | $806.15 |
| **Variable total** | **$29.76** | **$297.59** | **$2,975.85** |
| Twilio number | $1.15 | $1.15 | $1.15 |
| Hosting | Base44 Builder $40 | Base44 Builder $40 | Hot path on Deno Deploy Pro $20 + database (see 4) |
| **Total (approx.)** | **≈ $71** | **≈ $339** | **≈ $3,000 + database** |

Notes:
- Voice minutes are 250, 2,500 and 25,000 per month. They are 72% to 75% of the bill at every size. Voice is the cost to manage.
- Base44 Builder is $40/mo billed annually ([Base44 pricing](https://base44.com/pricing)). One third-party source says it is $50 billed monthly (**unverified**).
- ElevenLabs plans prepay the same $0.08/min. For example, Creator is $22 for 275 min ([ElevenLabs API pricing](https://elevenlabs.io/pricing/api)), so they do not change these totals much.
- Moving /voz to the one-shot flow with the browser's own speech (section 3) cuts the /voz line from $806 to about $5 at 100k (5k × ~$0.001).

## 3. Leaving ElevenLabs

### Text to speech (the /voz one-shot reply, `/speak`)

| Option | Price | Source |
|---|---|---|
| ElevenLabs Multilingual v2 (today) | $0.08 / 1k chars ($0.04 Flash) | [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Deepgram Aura-2 | $0.030 / 1k chars; $200 free credit | [deepgram.com/pricing](https://deepgram.com/pricing). Spanish voice quality is **unverified**. |
| Cartesia Sonic | 1 credit per char; Startup $49 for 1.25M credits ≈ $0.039 / 1k | [cartesia.ai/pricing](https://cartesia.ai/pricing) |
| OpenAI gpt-4o-mini-tts | $0.60 / M text in, $12 / M audio out; no per-minute figure listed | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| Browser `speechSynthesis` | $0 | Already the fallback in `web/public/voz/index.html` |

Google Cloud TTS: the pricing page did not load, so it is **unverified** and left out.

### Speech to text (`/transcribe`)

| Option | Price | Source |
|---|---|---|
| ElevenLabs Scribe v2 (today) | $0.22 / h ≈ $0.0037 / min | [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| OpenAI gpt-4o-mini-transcribe | $0.003 / min | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| Deepgram Nova-3 multilingual, pre-recorded | $0.0052 / min | [deepgram.com/pricing](https://deepgram.com/pricing) |
| Browser `SpeechRecognition` | $0 | Already the first choice in `/voz` |

### Phone voice agent (3-minute call; add Twilio $0.0085/min where we keep our number)

| Option | Per min | 3-min call | Notes |
|---|---|---|---|
| ElevenLabs Agents (today) | $0.08 + LLM + $0.0085 | ≈ $0.267 | Managed. Calls our MCP tools. |
| Twilio ConversationRelay | $0.07 + $0.0085 + our LLM | ≈ $0.24 | Twilio handles STT/TTS; we run the LLM and tools over a WebSocket. [Twilio pricing](https://www.twilio.com/en-us/voice/pricing/us). Spanish voices are **unverified**. |
| Deepgram Voice Agent API, BYO LLM | $0.065 + $0.0085 + our LLM | ≈ $0.22 | We must bridge Twilio Media Streams to Deepgram. [deepgram.com/pricing](https://deepgram.com/pricing) |
| Cartesia Managed Agents | $0.06 + $0.014 (their number) | ≈ $0.22 | Managed, with a new number. [cartesia.ai/pricing](https://cartesia.ai/pricing) |
| OpenAI gpt-realtime-mini | audio $10 / M in, $20 / M out | ≈ $0.07 estimated + $0.026 Twilio | Estimate assumes ~600 input and ~1,200 output audio tokens per speaking minute, half the call each side. That token rate is **unverified**. |

### Recommendation

1. **/voz:** make the one-shot flow the default, with browser speech in and out. That is $0 per conversation. Use Deepgram Aura-2 for TTS and OpenAI gpt-4o-mini-transcribe for STT as the server fallback, for phones without on-device speech. Drop the live agent in the browser, or keep it behind a button.
2. **Phone line:** move to **Twilio ConversationRelay**.
   - It keeps our number and one vendor (Twilio), and Twilio.org discounts apply (section 5).
   - It lets our own code run the conversation with direct tool calls, with no MCP round trip.
   - Before switching, pilot OpenAI gpt-realtime-mini side by side for Spanish quality and real cost per minute.
   - Savings are small per minute (about 10%). The real win is control and fewer vendors.

### What changes in the code

- `shared/voice.ts`: rewrite `speak()` and `transcribe()` for the new provider's API.
- `handlers/speak/entry.ts` and `handlers/transcribe/entry.ts`: change the secret names (`ELEVENLABS_*`) and the default voice/model.
- `web/public/voz/index.html`: remove the `@elevenlabs/client` import, `AGENT_ID` and the live-conversation block (lines ~256–380), and make the one-shot flow the default.
- New WebSocket handler for ConversationRelay (for example `handlers/voice_relay/`). It calls `findResources`, `makePlan` and `voiceQuery` directly. Base44 functions are request/response only, so it must run on Deno Deploy or Workers (section 4).
- `web/public/privacy.html` and `web/src/pages/Home.tsx`: update the vendor names and the video caption.
- `BASE44.md`: replace the ElevenLabs phone and MCP setup steps.

## 4. Hosting

**What we saw.** During a bulk approval run at the hackathon, Base44 returned 429 (rate limit) and 503 ("busy"). BASE44.md also records `find_resources` at 7–9 s and `make_plan` at 6–8 s through the public URL, against about 2 s for the same model call from a laptop.

**Base44 limits.**
- The pricing page gives credits only. Free is 25 message credits and 100 integration credits a month ([pricing](https://base44.com/pricing)).
- Rate limits are a base per endpoint on Free. Builder gets 2× and Enterprise up to 10× (the docs' example: 20/min on Free is 60/min on Pro). Limits count per caller, and some 429s come from Base44's upstream hosts ([rate limits](https://docs.base44.com/developers/references/apps-api/get-started/rate-limits)).
- No published limit for function calls or entity rows (**unverified**).

**Our load.**
- 100k conversations/month is about 3,300 a day, maybe 10–20 requests a minute at peak.
- Each tool call does 4 entity list calls reading about 1,315 rows. At ~1.5 tool calls per conversation that is 100k × 1.5 × 4 ≈ 600k entity calls and about 200M rows read a month.
- On Cloudflare D1 that fits in the included 25 billion rows read ([Workers/D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/)).

**Recommendation: split it.**
1. **Now (under 10k/mo):** stay on Base44 and upgrade to Builder.
   - Cache the catalog in memory per isolate for 5 minutes in `loadCatalog`. That cuts most entity calls.
   - Batch and throttle approvals (`review_queue`) with retry on 429/503.
   - Keep Base44 for the dashboard, the review queue and data entry.
2. **Before 10k/mo, or when the phone line moves to ConversationRelay:** move the hot path (`mcp`, `find_resources`, `make_plan`, `whatsapp`, `voice`) to **Deno Deploy**.
   - Our handlers are plain Deno already: `dev.ts` serves them, `Deno.env` works, and `shared/db.ts` is the only seam.
   - Free tier is 1M requests/month; Pro is $20 for 5M requests and 50 h CPU ([Deno Deploy pricing](https://deno.com/deploy/pricing)).
   - It supports WebSockets for ConversationRelay.
   - For data: a read-only catalog snapshot (1,315 rows) synced from Base44 or Postgres, plus a small Postgres for Submissions and RequestLog. A Postgres host was not priced (**unverified**).
3. **Alternative:** Cloudflare Workers Paid ($5/mo, 10M requests) with D1 (5 GB, 25B reads included). It is cheaper at scale and has Durable Objects for WebSockets, but it needs more porting off `Deno.*` APIs.

Why move at all: the hot path is latency-sensitive (voice agents time out at 15 s). We do not control Base44's rate limits, and the free backend beta has no published price or limits to plan around.

## 5. Funding and credits

Confirmed by search on 2026-10-17. "Fit" is our judgment.

| Program | What it is | Fit | Link |
|---|---|---|---|
| Twilio.org Impact Access | $100 one-time credit plus discounted pricing for 501(c)(3)s and social enterprises | Direct cut to the WhatsApp and voice bill, which is most of our cost. Needs a nonprofit or fiscal sponsor. | [twilio.org/apply](https://www.twilio.org/apply) |
| Funds for the Newest New Yorkers (NY Community Trust + Robin Hood) | $100k–$500k over two years for newly arrived immigrants; 2024 cycle closed | Exact population. Watch for the next call; nonprofits only. | [thenytrust.org](https://thenytrust.org/collaborative-fund/the-fund-for-the-newest-new-yorkers/) |
| NYC MOIA solicitations | 2024 RFPs (> $18M) for Immigration Legal Support Centers | Shows MOIA funds partners. Pitch as a referral tool for those centers. No 2026 RFP found. | [nyc.gov/immigrants](https://www.nyc.gov/site/immigrants/about/press-releases/city-issues-rfp-for-immigrant-legal-support-centers.page) |
| Fast Forward Accelerator | $25k+ unrestricted funding for tech nonprofits with an MVP; 2027 deadline (Sept 2026) has passed | Strong fit for the 2028 cycle | [ffwd.org](https://www.ffwd.org/) |
| Google.org Accelerator: Generative AI | Share of $30M, 6 months of support, Cloud credits; last call Feb 2025 | Fit if a 2026/27 call opens | [blog.google](https://blog.google/company-news/outreach-and-initiatives/google-org/google-org-generative-ai-accelerator-2025/) |
| ElevenLabs Impact Program | Free or discounted licenses for nonprofits | Bridge while we migrate off ElevenLabs | [elevenlabs.io/impact-program](https://elevenlabs.io/impact-program) |
| Deepgram | $200 free credit for new accounts | Covers the /voz fallback for a long time | [deepgram.com/pricing](https://deepgram.com/pricing) |
| OpenAI for Nonprofits | Up to 75% off ChatGPT Business/Enterprise; **not** API credits | Team seats only, not our backend | [openai.com](https://openai.com/index/introducing-openai-for-nonprofits) |
| Claude for Nonprofits | Up to 75% off Team/Enterprise (launched Dec 2025); no API credits found | Team seats only | [nonprofitpro.com](https://www.nonprofitpro.com/article/claude-for-nonprofits-launches-with-sector-discounts-data-connectors-and-training) |
| Code for America Community Fellowship | Pairs local technologists with government; listed active Mar 2026 | People, not money. The Brigade network closed in 2023. | [civictech.guide](https://directory.civictech.guide/listing/code-for-america-cfa-community-fellowship-program) |
| Social Good Fund (fiscal sponsor) | Fiscal sponsorship, about 6–8% fee | Lets us take grants and Twilio.org benefits before having our own 501(c)(3) | [fiscalsponsordirectory.org](https://fiscalsponsordirectory.org/?p=569) |
| Open Source Collective (fiscal host) | 10% fee; 501(c)(6), open-source software only | Only if we fund the code as open source. Open Collective Foundation (the 501(c)(3)) dissolved in 2024. | [opencollective.com](https://opencollective.com/opensource/updates/regarding-the-announcement-to-dissolve-open-collective-foundation) |

**Unverified:**
- NYCx: no activity found after 2017–2018.
- A claimed "$500 Anthropic API credits/month for nonprofits": one source only.
- Twilio.org $500 credit via TechSoup: one blog only.
- Anthropic and OpenAI startup credit programs: not checked.

## 6. Next 30 days

- [ ] Set `OPENROUTER_MODEL` explicitly on Base44 (Haiku 5.5 or GLM 5.3 Flash), so the model in use is a choice, not a default.
- [ ] Add a 5-minute in-memory catalog cache to `loadCatalog` (`shared/rank.ts`), and add 429/503 retry with backoff to bulk approvals.
- [ ] Upgrade Base44 to Builder, then re-time `find_resources` and `make_plan` (BASE44.md (d)).
- [ ] Pick a fiscal sponsor (Social Good Fund or similar), then apply to Twilio.org Impact Access and the ElevenLabs Impact Program.
- [ ] Register a real WhatsApp Business sender (the sandbox is not production), and submit a utility template for `send_to_phone`.
- [ ] Make the /voz one-shot flow the default with browser speech; put Deepgram TTS and OpenAI STT behind `/speak` and `/transcribe`.
- [ ] Prototype ConversationRelay on Deno Deploy with one call path (`find_resources`). Compare Spanish quality against gpt-realtime-mini.
- [ ] Log per-door volume from RequestLog weekly, to replace the assumed door mix in section 2 with real numbers.
- [ ] Watch for the next Funds for the Newest New Yorkers call and the Fast Forward 2028 cycle; email MOIA about a referral-tool partnership.
