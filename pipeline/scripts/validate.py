"""Check out/programs.csv, out/places.csv, out/links.csv against the shared contract and print a report.

Checks: header (same column set; order may differ), allowed enum values, id format and prefix, duplicate ids,
source_url (http/https), last_checked = date given, booleans, zip, borough, lat/lng, languages, hours given
without open flags, and that every links.csv endpoint exists. Missing files are skipped (reported).

Run: python3 scripts/validate.py [--date YYYY-MM-DD]      exits 1 if any error
"""
import collections, csv, datetime, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
CONTRACT = {
    "programs.csv": ["id", "name", "needs", "who_can_use", "status_note", "bring", "how_to_apply", "summary_es",
                     "summary_en", "source_url", "last_checked"],
    "places.csv": ["id", "name", "org", "org_type", "address", "borough", "zip", "lat", "lng", "hours", "open_evenings",
                   "open_weekends", "languages", "phone", "trust", "source_url", "last_checked"],
    "links.csv": ["from_id", "to_id", "type", "reason"],
}
NEEDS = {"food", "legal", "health", "benefits", "money", "school", "id", "housing", "work", "transit"}
TRUST = {"official", "verified", "community", "unverified"}
ORG_TYPES = {"doj_roster", "doj_pro_bono", "pantry", "consulate", "clinic", "benefits_office", "idnyc", "remittance",
             "check_casher", "school", "other"}
LINK_TYPES = {"offers", "unlocks", "pairs_with", "requires", "refers_to"}
BOROUGHS = {"Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"}
ID_RE = re.compile(r"^(prog|place)-[a-z0-9]+(-[a-z0-9]+)*$")
LANG_RE = re.compile(r"^[a-z]{2,3}$")


def load(name):
    path = OUT / name
    if not path.exists():
        return None, None
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def main():
    date = sys.argv[sys.argv.index("--date") + 1] if "--date" in sys.argv else datetime.date.today().isoformat()
    errors, warnings, counts = [], [], {}
    data = {}
    for name, cols in CONTRACT.items():
        header, rows = load(name)
        if header is None:
            warnings.append(f"{name}: not found, skipped"); continue
        data[name] = rows
        counts[name] = len(rows)
        if set(header) != set(cols):
            errors.append(f"{name}: header {header} != contract (missing {set(cols)-set(header)}, extra {set(header)-set(cols)})")
        for line, r in enumerate(rows, start=2):
            err = lambda msg: errors.append(f"{name}:{line} {r.get('id') or r.get('from_id')}: {msg}")
            if None in r or any(v is None for v in r.values()):
                err("wrong number of fields"); continue
            if name == "links.csv":
                if r["type"] not in LINK_TYPES: err(f"link type '{r['type']}'")
                if not r["reason"].strip(): err("reason missing")
                continue
            if not ID_RE.match(r["id"]): err("id format")
            want = "prog-" if name == "programs.csv" else "place-"
            if not r["id"].startswith(want): err(f"id must start with {want}")
            if not re.match(r"^https?://\S+$", r["source_url"]): err("source_url missing or not http(s)")
            if r["last_checked"] != date: err(f"last_checked '{r['last_checked']}' != {date}")
            if not r["name"].strip(): err("name missing")
            if name == "programs.csv":
                needs = r["needs"].split("|") if r["needs"] else []
                if not needs: err("needs empty")
                if set(needs) - NEEDS: err(f"needs {set(needs)-NEEDS}")
                for k in ("summary_en", "summary_es"):
                    if not r[k].strip(): err(f"{k} missing")
                    elif len(r[k].split()) >= 30: err(f"{k} has {len(r[k].split())} words (limit < 30)")
            else:
                if r["org_type"] not in ORG_TYPES: err(f"org_type '{r['org_type']}'")
                if r["trust"] not in TRUST: err(f"trust '{r['trust']}'")
                if r["borough"] and r["borough"] not in BOROUGHS: err(f"borough '{r['borough']}'")
                if r["zip"] and not re.fullmatch(r"\d{5}", r["zip"]): err(f"zip '{r['zip']}'")
                for b in ("open_evenings", "open_weekends"):
                    if r[b] not in ("true", "false", ""): err(f"{b} '{r[b]}'")
                    if r[b] and not r["hours"]: err(f"{b} set but hours unknown")
                if r["hours"] and (r["open_evenings"] == "" or r["open_weekends"] == ""):
                    warnings.append(f"{name}:{line} {r['id']}: hours given but open_evenings/open_weekends blank")
                if bool(r["lat"]) != bool(r["lng"]): err("lat/lng must both be set or both blank")
                if r["lat"]:
                    try:
                        lat, lng = float(r["lat"]), float(r["lng"])
                        if not (40.4 < lat < 41.0 and -74.3 < lng < -73.6):
                            warnings.append(f"{name}:{line} {r['id']}: coordinates outside NYC ({lat},{lng})")
                    except ValueError:
                        err("lat/lng not numeric")
                if r["languages"]:
                    bad = [l for l in r["languages"].split("|") if not LANG_RE.match(l)]
                    if bad: err(f"languages not ISO codes: {bad}")
        if name != "links.csv":
            for pid, n in collections.Counter(r["id"] for r in rows).items():
                if n > 1: errors.append(f"{name}: duplicate id {pid} ({n}x)")
    if "links.csv" in data:
        ids = {r["id"] for n in ("programs.csv", "places.csv") for r in data.get(n, [])}
        seen = collections.Counter((r["from_id"], r["to_id"], r["type"]) for r in data["links.csv"])
        for k, n in seen.items():
            if n > 1: errors.append(f"links.csv: duplicate link {k}")
        for line, r in enumerate(data["links.csv"], start=2):
            for k in ("from_id", "to_id"):
                if r[k] not in ids: errors.append(f"links.csv:{line}: {k} '{r[k]}' not found in programs/places")
            if r["type"] == "offers" and not (r["from_id"].startswith("place-") and r["to_id"].startswith("prog-")):
                errors.append(f"links.csv:{line}: offers must be place -> program")
    if "programs.csv" in data and "places.csv" in data:
        overlap = {r["id"] for r in data["programs.csv"]} & {r["id"] for r in data["places.csv"]}
        if overlap: errors.append(f"ids used in both files: {overlap}")

    print("VALIDATION REPORT", date)
    for n, c in counts.items():
        print(f"  {n}: {c} rows")
    print(f"  errors: {len(errors)}  warnings: {len(warnings)}")
    for e in errors[:200]:
        print("  ERROR", e)
    for w in warnings[:60]:
        print("  warn ", w)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
