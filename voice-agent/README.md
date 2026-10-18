# Voice agent (ElevenLabs "NAVEGADOR NYC")

The phone line (+1 743-330-7616) and the live /voz app talk to one ElevenLabs Conversational AI agent
(`ELEVENLABS_AGENT_ID` in `.env`). It reaches our data through the MCP server (`.../functions/mcp`):
find_resources, make_plan, check_provider, explore, report_feedback, send_to_phone.

- `prompt.es.md` is the agent's system prompt. Edit it here, not in the dashboard.
- `apply.ts` pushes the prompt, the opening lines (Spanish, plus an English preset), turn timing and privacy settings:

```sh
set -a && . ./.env && set +a && deno run -A voice-agent/apply.ts            # dry run: shows now vs. new
set -a && . ./.env && set +a && deno run -A voice-agent/apply.ts --apply    # PATCH the agent
```

What it changes, and why:
- **Callers are often nervous.** The agent uses "usted", asks one question at a time, gives one option first, reads phone numbers slowly, and reassures callers that the call is free and nobody will ask about their papers.
- **No made-up facts.** Only what the tools return. Stale or reported places get "call before you go".
- **Uses the new tools.** `explore` answers "what do I bring / where do I get an ID". `report_feedback` records "did it help" (anonymous).
- **Emergencies:** 911, 988 (crisis, Spanish available), and the NYC domestic violence line 1-800-621-4673.
- **Privacy:** audio is not recorded, and transcripts are deleted after 1 day, the same promise as the rest of the app. Before this, the agent recorded voice and kept every conversation with no time limit. Past conversations are not touched.

When we move off ElevenLabs (docs/SUSTAINABILITY.md), the prompt and the MCP tools carry over unchanged.
