# scripts/

Local-only tools. Nothing in this folder is copied to Base44.

| File | What it does |
| --- | --- |
| `import.ts` | Validates `programs.csv`, `places.csv`, `links.csv` and loads them into `data/Program.json`, `Place.json`, `Link.json` |
| `csv.ts` | RFC 4180 CSV parser (quotes, commas and newlines inside quotes, CRLF, BOM) that survives broken quotes |
| `import_test.ts` | Tests for both, run against temp copies of `data/` |
| `fixtures/good/` | Valid CSVs in the exact contract (BOM + CRLF, quoted commas and pipes, a multi-line field, shuffled mixed-case header) |
| `fixtures/bad/` | One of each problem: wrong enum, bad id, bad date, missing source_url, bad boolean, dangling link, duplicate id, duplicate name+address, unclosed quote, extra column/value |

```sh
deno task import --help
deno test --allow-read --allow-write --allow-env scripts/      # 14 tests, ~0.2 s
```

## Data handoff

How Felix's files go in. It takes about a minute.

**1. Export.** Use three CSV files with exactly these names. Case does not matter, so `Places.csv` also works. Export as **CSV UTF-8**. A Windows-1252 file is still read, but you get a warning.

```
programs.csv  id, name, needs, who_can_use, status_note, bring, how_to_apply, summary_es, summary_en, source_url, last_checked
places.csv    id, name, org, org_type, address, borough, zip, lat, lng, hours, open_evenings, open_weekends, languages, phone, trust, source_url, last_checked
links.csv     from_id, to_id, type, reason
```

Header rules:
- Columns can come in any order.
- Header case and surrounding spaces are ignored.
- An extra column (for example `notes`) is ignored, with a warning.
- A missing column counts as blank in every row, with a warning.
- A file is unusable without its key columns: `id` for programs and places, and `from_id`, `to_id`, `type` for links.

You can send one file or all three. A file that is missing is skipped, and that entity stays as it is.

**2. Drop the files in `data/`, then do a dry run.**

```sh
cp ~/Downloads/{programs,places,links}.csv data/
deno task import --dry-run          # validates, prints the table, writes data/import-report.json, changes nothing else
```

The CSVs can also stay in their own folder: `deno task import ~/Downloads/felix --dry-run`.

**3. Fix what the report flags, then import for real.**

```sh
deno task import
```

The running dev server picks up the new data on its next request. No restart is needed: functions read `data/*.json` on every call, and the import uses the same lock files as `shared/db.ts`. Check the result with:

```sh
curl -s -X POST localhost:8787/functions/health -d '{}'
```

### What gets checked

A row with any **error** is skipped. The report lists the file, the line, the id and every reason. Rows with only **warnings** are imported.

| Field | Rule |
| --- | --- |
| `id` | `prog-<slug>` / `place-<slug>`: lowercase letters, digits, single hyphens. Uppercase is lowercased with a warning. |
| duplicate id | The later row wins, with a warning. In `links.csv` this applies to the same from/type/to. |
| duplicate place | Same name and address (normalized, so `Avenue` = `Ave`) under a different id: the first row is kept and the later one is skipped, with a warning. |
| `needs` | Pipe list. Every item must be one of `food legal health benefits money school id housing work transit`. Case is ignored. `comida` is an error that suggests `food`. |
| `org_type`, `trust`, link `type` | Must be in the enum. Case, spaces and hyphens are ignored (`DOJ roster` becomes `doj_roster`). Typos get a suggestion. A blank `org_type` becomes `other` and a blank `trust` becomes `unverified`, both with warnings. |
| booleans | `true` / `false`. `TRUE`, `False`, `yes`, `no`, `1`, `0` and `si` are accepted with a warning. A blank value is derived from `hours`, with a warning. |
| `last_checked` | A real `YYYY-MM-DD` date (`2026-02-30` is an error). `10/9/2026` and ISO datetimes are converted, with a warning. Future dates and dates more than 2 years old also get a warning. |
| `source_url` | Required. Must be an `http(s)://` URL. |
| `zip` | 5 digits. ZIP+4 is shortened, with a warning. A non-NYC zip gets a warning. |
| `borough` | Normalized to Manhattan / Brooklyn / Queens / Bronx / Staten Island (`el bronx`, `BROOKLYN` and similar are accepted). A blank or unknown borough is filled in from the zip, with a warning. |
| `lat`, `lng` | Numbers inside NYC. A blank value becomes `null` with a warning, and that place is left out of distance sorting. A swapped pair is fixed, with a warning. A point outside NYC is an error. |
| `languages` | Pipe list of codes (`es`, `en`, `zh`, `quc`, `es-MX`). Names like `Spanish` or `Español` are converted, with a warning. Junk entries are dropped, with a warning. |
| links | `from_id` / `to_id` must exist in the imported or existing programs and places. Self-links are errors. An `offers` link that does not go place to program gets a warning. |
| CSV shape | A row with more values than the header (an unquoted comma) or fewer is skipped. An unclosed or stray quote costs only that one row, and parsing resumes on the next line. |

### Merge policy

The import upserts by `id`. Links upsert by `from_id + type + to_id`. New links get the id `link-<from>-<type>-<to>`.

- **New** ids are created with `created_date` and `updated_date`.
- **Changed** records keep their `id` and `created_date`, and get a new `updated_date`. Identical rows are counted as `unchanged` and left alone, so re-running the import is safe.
- **Sample records** have a `source_url` starting with `https://example.org/sample/`. They are removed for each entity whose CSV brings at least one valid row. Links that touch sample records are removed when `links.csv` is imported. Use `--keep-sample` to keep them.
- **Other existing records** that are not in the CSV are kept. This covers places that were approved from community submissions. Use `--replace` to make the CSV the whole truth.
- Links whose endpoints no longer exist are always pruned.
- A file that is broken or has no valid rows never wipes existing data. That entity is left as it is.
- `Submission` and `RequestLog` are never touched.

### Exit code and report

- **Exit code `0`:** the import ran, even if some rows were skipped.
- **Exit code `1`:** a file was unreadable, a header was missing its key columns, or no CSV was found. Any other files that were valid are still imported.

The console prints a table with these columns for each file: read, new, updated, unchanged, skipped, removed, errors and warnings. After the table it lists every skipped row with its reasons, the warnings, the removals and the top reasons.

The full machine-readable report goes to `data/import-report.json`, which is gitignored. With `DATA_DIR` set, it goes to `$DATA_DIR/import-report.json` instead. Override the path with `--report=PATH`, or turn the report off with `--no-report`.

### Options

```
deno task import [csv-dir] [--dry-run] [--keep-sample] [--replace] [--report=PATH | --no-report]
```

- `csv-dir` defaults to the data dir.
- Output goes to `$DATA_DIR` when that is set, otherwise to the repo's `data/`, the same as `shared/db.ts`.
- To try the import without touching `data/`:

  ```sh
  mkdir -p /tmp/try && cp data/*.json /tmp/try/ && DATA_DIR=/tmp/try deno task import ~/Downloads/felix
  ```

### Base44

This script only writes the local JSON files. To load the same CSVs into Base44, run the import locally so the CSVs are validated. Then use one of these routes:
- push the records through the SDK (`entities.Program.bulkCreate`, upserting by `id`), or
- use Base44's CSV import on each entity.

Base44 may refuse custom ids. In that case, see "Custom ids" in the root README.
