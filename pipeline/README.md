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
```

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
