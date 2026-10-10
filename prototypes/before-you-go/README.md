# Antes de ir / Before You Go (standalone prototype)

A mobile-first, single-file prototype for the immigrant New Yorker resource navigator.
It does not touch the Base44 app, HumHub, the MCP tools, or `pipeline/`.

- `index.html`: the whole prototype. Open it in a phone-width browser. No build step, no server, no network calls.
- `places.json`: 661 rows exported from `pipeline/hf_release/places.csv` (real data, same fields, same `last_checked` dates). It is also inlined into `index.html`.
- `screenshot-slide.png`, `screenshot-en.png`: 390x844 at 2x, Spanish and English result views.

## What it does
1. User picks a need (food, legal, health, benefits, ID, money, school), a ZIP, and a time (weekday evening or weekend).
2. Shows up to three places from `places.csv` whose `org_type` matches the need, ranked by the matching `open_evenings` / `open_weekends` flag (true first, blank next, false excluded) and then by distance from the ZIP's centroid in the dataset.
3. Each card shows stated hours, languages, phone, source link, last-checked date, and a "Call first" note. Blank hours, languages, or phone display as **unknown**.
4. A bilingual "Before you leave" card lists five questions to ask. The user can copy the questions or the public place details.

## Honest limits
- No name, phone, immigration status, or story is requested or stored. The page keeps no state at all.
- Hours and flags are whatever the source stated on `last_checked`. The prototype makes no claim about live availability, eligibility, or safety.
- `languages` is blank for 656 of 661 rows, so most cards will show "unknown" for languages. That is accurate, not a bug.
- Need mapping comes from `org_type` because the CSV has no category column.

## Rebuild from the CSV
```
python3 -I export.py   # regenerates places.json and re-inlines it into index.html
```
