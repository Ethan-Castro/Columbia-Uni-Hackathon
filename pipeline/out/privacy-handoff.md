# Privacy handoff (design note for a later build)

Status: design note only. Nothing here is built for the hackathon demo.

## Today (demo)
- Log **synthetic test requests only**. Do not log real residents' questions, even during rehearsal.
- The three CSVs (`programs.csv`, `places.csv`, `links.csv`) are public resource data. They contain no resident information.
  `places.csv` includes accredited representatives' names. Those names come from the public DOJ roster and describe the people providing services, not the people using them.

## Boundary for a future build
1. **Public resource data stays separate from resident data.** The knowledge graph (programs, places, links) lives in its own store. Resident cases, conversations and messaging live in another store, with separate access controls. The graph never stores a resident identifier, and resident records only point to graph ids (for example `place-doj-pb-...`).
2. **Analytics never contain:** names, phone numbers, emails, addresses, raw question text, or anything about immigration status (including the status a person mentions, or which status-dependent program they asked about, in a way that can be tied back to them). Log structured events instead, for example `{need: "legal", program_id, borough, week}`.
3. **Coarse geography.** Record borough or a ZIP3-level area, never a full address or precise coordinates for a resident. A demo-zip flag such as "Corona area" is enough for neighborhood reporting.
4. **Limited retention.** Delete raw conversation logs on a short fixed schedule, for example 30 days or less, and keep only aggregated counts after that. Write the schedule down and enforce it automatically.
5. **Small-group suppression.** Do not publish or display any aggregate cell with fewer than about 10 people, for example "legal questions from 11368 this week". Combine or suppress small cells before sharing with partners.
6. **No data sharing with enforcement or third parties** without legal review. Treat messaging content as potentially sensitive legal information.

## Notes from the data side
- In the DOJ rows, `trust=official` means only that the listing came from an official DOJ source. It is not a DOJ endorsement, does not mean the provider has openings, and does not mean the service is free. A person missing from these lists is not evidence of fraud. The parsed roster may also be incomplete.
- Phase 1 `status_note` text describes program rules. It must never be written into a resident's record as a fact about that resident.
