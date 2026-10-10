"""Phase 2 checks + review report. Reads out/places.csv, out/places_doj_detail.csv, out/.phase2_meta.json and
writes out/phase2_review.md. Exits non-zero if a scope/reference check fails, so places.csv is not handed off.

Run: python3 scripts/report_phase2.py
"""
import collections, csv, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
COLUMNS = ["id", "name", "org", "org_type", "address", "borough", "zip", "lat", "lng", "hours", "open_evenings",
           "open_weekends", "languages", "phone", "trust", "source_url", "last_checked"]
BOROUGHS = {"Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"}
DEMO_ZIPS = {"11368", "11373", "11372"}
COUNTY_BOROUGH = {"New York County": "Manhattan", "Kings County": "Brooklyn", "Queens County": "Queens",
                  "Bronx County": "Bronx", "Richmond County": "Staten Island"}

rows = list(csv.DictReader((OUT / "places.csv").open(encoding="utf-8")))
header = next(csv.reader((OUT / "places.csv").open(encoding="utf-8")))
det = {d["id"]: d for d in csv.DictReader((OUT / "places_doj_detail.csv").open(encoding="utf-8"))}
meta = json.loads((OUT / ".phase2_meta.json").read_text())
errors = []

# ---------------- checks
if header != COLUMNS:
    errors.append(f"header mismatch: {header}")
ids = [r["id"] for r in rows]
for pid, n in collections.Counter(ids).items():
    if n > 1: errors.append(f"duplicate id {pid}")
for r in rows:
    d = det.get(r["id"])
    if d is None: errors.append(f"{r['id']}: no detail row"); continue
    if not re.fullmatch(r"place-[a-z0-9-]+", r["id"]): errors.append(f"{r['id']}: bad id")
    if r["trust"] != "official" or r["org_type"] not in ("doj_roster", "doj_pro_bono"): errors.append(f"{r['id']}: trust/org_type")
    if not r["source_url"].startswith("https://www.justice.gov/"): errors.append(f"{r['id']}: source_url")
    if r["zip"] and not re.fullmatch(r"\d{5}", r["zip"]): errors.append(f"{r['id']}: zip")
    if r["borough"] and r["borough"] not in BOROUGHS: errors.append(f"{r['id']}: borough value")
    # scope: a borough is set only for verified NYC offices, and must agree with geocoder county when coords exist
    if r["borough"] and d["nyc_scope"] != "nyc": errors.append(f"{r['id']}: borough set but scope {d['nyc_scope']}")
    if d["nyc_scope"] == "nyc" and not r["borough"]: errors.append(f"{r['id']}: NYC scope without borough")
    if r["lat"] and d["nyc_scope"] == "nyc" and COUNTY_BOROUGH.get(d["geocode_county"]) != r["borough"]:
        errors.append(f"{r['id']}: coords county {d['geocode_county']} != borough {r['borough']}")
    if r["lat"] and d["nyc_scope"] == "nyc_uncertain": errors.append(f"{r['id']}: uncertain row has coordinates")
    if d["record_kind"] == "accredited_rep":
        if any(r[k] for k in ("address", "borough", "zip", "lat", "lng", "phone")):
            errors.append(f"{r['id']}: rep tied to a location")
        for pid in d["org_place_ids"].split("|"):
            if pid not in det: errors.append(f"{r['id']}: org_place_id {pid} missing")
    if r["zip"] == "11550" and r["borough"]: errors.append(f"{r['id']}: Hempstead counted as NYC")

# ---------------- report
kind = collections.Counter(det[r["id"]]["record_kind"] for r in rows)
nyc = [r for r in rows if det[r["id"]]["nyc_scope"] == "nyc"]
unc = [r for r in rows if det[r["id"]]["nyc_scope"] == "nyc_uncertain"]
offices = [r for r in rows if det[r["id"]]["record_kind"] != "accredited_rep"]
L = ["# Phase 2 review: DOJ places", "",
     f"Generated from out/places.csv ({len(rows)} rows). Checks: {'PASS' if not errors else 'FAIL'}.", "",
     "`trust=official` means the listing came from an official DOJ source. It does not mean DOJ endorses the provider, that the provider has openings, or that every service is free. Someone missing from these lists is not evidence of fraud.", "",
     "## Rows by list", "", "| kind | rows |", "|---|---|"]
L += [f"| {k} | {v} |" for k, v in kind.items()]
L += ["", "## NYC offices by borough (stated city and ZIP agree; where coordinates exist the geocoder county agrees too)", "",
      "| borough | recognized-org offices | pro bono offices |", "|---|---|---|"]
for b in sorted(BOROUGHS):
    ro = sum(1 for r in nyc if r["borough"] == b and r["org_type"] == "doj_roster")
    pb = sum(1 for r in nyc if r["borough"] == b and r["org_type"] == "doj_pro_bono")
    L.append(f"| {b} | {ro} | {pb} |")
L.append(f"| **total** | {sum(1 for r in nyc if r['org_type']=='doj_roster')} | {sum(1 for r in nyc if r['org_type']=='doj_pro_bono')} |")
L += ["", "## Pro bono listings by court", "", "| court | listings (offices) |", "|---|---|"]
court_ct = collections.Counter(c for r in rows for c in det[r["id"]]["courts"].split("|") if c)
L += [f"| {c} | {n} |" for c, n in court_ct.items()]
L += ["", "## Uncertain NYC records (kept, borough and coordinates left blank, needs manual review)", ""]
L += [f"- `{r['id']}`: {r['address']}. {det[r['id']]['review_flag']}" for r in unc] or ["- none"]
L += ["", "## Kept rows that are not counted as NYC places (outside NYC, no address, or mailing-only)", ""]
L += [f"- `{r['id']}`: {r['address'] or '(no address in listing)'}. {det[r['id']]['review_flag']}"
      for r in rows if det[r["id"]]["nyc_scope"] in ("outside_nyc", "no_address", "mailing_only")] or ["- none"]
exc = meta.get("excluded_outside_nyc") or meta.get("excluded_hempstead", [])
near = [e for e in exc if e["zip"].startswith("11")]
L += ["", f"## Excluded roster offices outside the five boroughs: {len(exc)}", "",
      "Long Island ZIPs (11xxx) among them, listed because a ZIP-prefix rule could wrongly count them as Queens:", ""]
L += [f"- {e['org']} ({e['office']}), {e['city']}, NY {e['zip']}" for e in near]
geo = collections.Counter(det[r["id"]]["geocode_status"] or "n/a" for r in offices)
with_coords = sum(1 for r in offices if r["lat"])
L += ["", "## Geocoding coverage (offices only; reps are never geocoded)", "",
      f"- offices with coordinates: {with_coords} of {len(offices)}",
      f"- verified NYC offices with coordinates: {sum(1 for r in nyc if r['lat'])} of {len(nyc)}",
      f"- geocoder status: {dict(geo)}"]
missing = [r for r in nyc if not r["lat"]]
L += [f"- NYC office without coordinates: `{r['id']}` ({det[r['id']]['review_flag']})" for r in missing]
L += ["", "## Same address on both lists (kept as separate listings)", ""]
addr = collections.defaultdict(list)
for r in offices:
    if r["address"]:
        addr[re.sub(r"\W", "", r["address"].lower().split(",")[0])].append(r)
dups = [v for v in addr.values() if len({x["org_type"] for x in v}) > 1 or len(v) > 1]
L += [f"- {' / '.join(f'`{x['id']}`' for x in v)}: {v[0]['address']}" for v in dups] or ["- none"]
L += ["", "## Parser reconciliation", "",
      f"- Alphabetical roster: {meta['alpha_org_count']} organizations parsed vs 951 stated on page 1; {meta['alpha_rep_count']} representatives "
      "(matches an independent count: dates in the table minus two per organization row).",
      f"- State/city roster, NEW YORK section: {meta['state_roster_ny_records']} office records (one per City, NY ZIP line in the text).",
      f"- NYC organizations not found in the alphabetical roster: {meta['unmatched_orgs'] or 'none'}. A name not found by the parser is not proof that the organization or person is not accredited.",
      "", "## Demo zips (11368, 11373, 11372): DOJ rows to verify by hand", ""]
L += [f"- `{r['id']}`: {r['name']}, {r['address']}, {r['phone']}" for r in rows if r["zip"] in DEMO_ZIPS] or ["- none"]
if errors:
    L += ["", "## Check failures", ""] + [f"- {e}" for e in errors]
(OUT / "phase2_review.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("\n".join(L))
sys.exit(1 if errors else 0)
