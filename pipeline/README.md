# Data pipeline: services knowledge graph for immigrant New Yorkers

Builds three CSVs for the app, following the shared contract:
`out/programs.csv`, `out/places.csv`, `out/links.csv`.

## Layout
- `raw/`: untouched downloads (NYC Open Data JSON, DOJ PDFs, saved source pages). `raw/tavily/` caches every Tavily response.
- `scripts/`: everything that turns raw into out.
- `out/`: the handoff files.

## Setup
Python 3.11+ with `requests`, `beautifulsoup4`, `lxml`, `pdfplumber`, `pandas`, `matplotlib`.
Put the Tavily key in `pipeline/.env` as `TAVILY_API_KEY=...`. The file is git-ignored.

## Rerun everything (from `pipeline/`)
```
python3 scripts/fetch_raw.py        # downloads raw sources (skips files already present; --force to refresh)
python3 scripts/build_programs.py   # phase 1 -> out/programs.csv
python3 scripts/build_places_doj.py # phase 2 -> out/places.csv (DOJ rows) + out/places_doj_detail.csv (geocodes cached in raw/geocode/)
python3 scripts/report_phase2.py    # phase 2 checks + out/phase2_review.md (exits non-zero if a scope check fails)
python3 scripts/build_places_local.py  # phase 3 -> adds Food Help NYC + hand-sourced places to out/places.csv (keeps DOJ rows)
python3 scripts/build_links.py      # phase 4 -> out/links.csv (every link quote-checked against its source)
python3 scripts/validate.py         # phase 5 contract check of all three files (exits 1 on any error)
```
Order matters: `build_places_doj.py` rewrites places.csv with DOJ rows only; `build_places_local.py` then adds the rest.

## Phase 1 notes (programs.csv)
- 97 programs come from the NYC Benefits and Programs dataset (kvhd-5fmu). The download is English only.
  `source_url` points at that row in the dataset API.
- `scripts/program_curation.py` holds the hand-written layer: ids, needs tags, summaries under 30 words
  in English and Spanish, and `status_note` text taken from what each row says about immigration status or SSN.
  If a row says nothing, `status_note` uses the dataset's "regardless of immigration status" tag when present, otherwise it stays blank.
- 5 programs the dataset lacks are added from their own sources. Copies are in `raw/manual/` and `raw/tavily/`:
  NYS DREAM Act (HESC), McKinney-Vento transit help (NYC Public Schools), NYC Schools Account (NYC Public Schools),
  tandas (NYC DCA Immigrant Financial Services Study, 2013), and lending circles (Mission Asset Fund).
- If the dataset gains new rows, `build_programs.py` stops and lists the rows that need curation.

## Phase 2 notes (DOJ places)
- Sources, all from justice.gov:
  - The roster **by State and City**. The alphabetical roster has no addresses, so it can't place offices in NYC.
  - The **alphabetical roster**, used only for accredited representatives.
  - The **pro bono list**. Its index page links one nationwide PDF, and the New York court sections are parsed from it.
- `trust=official` means only that the listing came from an official DOJ source. It is not a DOJ endorsement. It does not mean the provider has current openings or that every service is free. Someone missing from these lists is not evidence of fraud.
- Row kinds, distinguished by id prefix: `place-doj-ro-` (recognized-organization office), `place-doj-pb-` (pro bono office), `place-doj-rep-` (accredited representative).
  Representative rows have no address, borough or coordinates, because the roster links a representative to an organization and never to an office.
- NYC scope: an office counts as NYC only when the stated city, the stated ZIP and the Census geocoder county agree on one borough.
  - Conflicts are kept with borough and coordinates blank, and listed in `out/phase2_review.md`.
  - Pro bono offices outside NYC that are listed for a NYC court are kept with borough blank and are never counted as NYC.
- `out/places_doj_detail.csv` holds what the contract can't: record kind, courts, "DHS only" accreditation, expiration dates, review flags, geocoder match and source page.

## Phase 3 notes (neighborhood depth)
- Food Help NYC: 523 open pantries and soup kitchens from the City's public ArcGIS layer behind finder.nyc.gov/foodhelp (`raw/foodhelp_nyc*.json`). Hours come from the City's structured fields. Rows where the City's own free-text schedule disagrees are flagged in `out/places_local_detail.csv`.
- Hand-sourced places live in `scripts/phase3_curation.py`. Every field has a quote that must match the saved source page, or the build stops.
- `trust`: `official` means the facts come from a government source; it does not certify current capacity or cost. Provider and agent pages are `unverified`.
- **`verified` only comes from `scripts/verified_ids.txt`.** Felix adds an id there after personally reviewing that place (checklist: `out/phase3_review_checklist.md`). No script writes to this file, and it must never be re-initialized.
- `hold=True` in the curation keeps a row out of the live `places.csv` (written to `out/places_held.csv` instead) while its sources conflict. Example: New Life CDC.
- Unknown language, requirements, fees and availability stay blank. `out/phase3_review.md` lists what the sources could not confirm.

## Phase 4 notes (links)
- `scripts/build_links.py` lists each relationship with the quote that supports it, taken from a NYC Benefits dataset row or a saved page. "Offers" links for WIC sites, IDNYC centers, SNAP centers and Family Welcome Centers come from the Phase 3 curation.
- Deliberately not linked (no source): IDNYC unlocks a bank account (the City list exists, but there's no named bank's own page yet), and WIC pairs_with Child Health Plus.

## Live import rules (after Ethan's 2:05 PM update)
- Ethan's importer (`scripts/import.ts` at the repo root) fills a blank borough from the ZIP and rejects rows outside NYC. So `build_places_local.py` applies these rules before writing `places.csv`:
  - DOJ rows with a city/ZIP conflict, or a PO Box only: the ZIP is blanked, so they stay in for the notario name check but out of location search until reviewed.
  - Rows outside NYC, rows with no ZIP, conflicting-source rows, and a roster row that duplicates its pro bono row: moved to `out/places_held.csv`, each with a `held_reason`.
- Check a handoff with Ethan's importer (Deno): `deno run --allow-read --allow-write --allow-env scripts/import.ts pipeline/out --dry-run --report=/tmp/import-report.json`
- Send updates by committing on `main`, then `git pull --rebase && git push origin main`, then tell Ethan "pushed".

## Felix's review tracker (Corona Place Checks)
- Shared page: https://claude.ai/artifact/Twu1xiB941vikqP6h7TEgR. It lists the 25 review places (seeded from `out/review_tracker_seed.json`). For each place Felix records: result, how he checked, languages spoken, hours, what to bring, walk-in or appointment, fee, and notes.
- To sync: Claude reads the tracker's `checks` collection into `raw/review_checks/`, then runs `python3 scripts/apply_review.py`, `build_places_local.py`, `build_links.py` and `validate.py`, then pushes to `main`.
- A place becomes `verified` only from a check marked confirmed by **phone call or in person**. Languages are applied only from those checks. A check marked closed holds the place out of `places.csv`. Hours, bring, fee and notes are listed for a person to apply by hand.
