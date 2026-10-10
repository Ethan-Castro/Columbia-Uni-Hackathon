"""Phase 1: build out/programs.csv from the NYC Benefits and Programs dataset (kvhd-5fmu)
plus the hand-sourced programs in program_curation.MANUAL.

Run: python3 scripts/build_programs.py   (after scripts/fetch_raw.py)
"""
import csv, datetime, html, json, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from program_curation import DATASET, MANUAL

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "benefits_kvhd-5fmu.json"
OUT = ROOT / "out" / "programs.csv"
TODAY = datetime.date.today().isoformat()
COLUMNS = ["id", "name", "needs", "who_can_use", "status_note", "bring", "how_to_apply",
           "summary_es", "summary_en", "source_url", "last_checked"]
NEEDS = {"food", "legal", "health", "benefits", "money", "school", "id", "housing", "work", "transit"}
SOURCE_URL = "https://data.cityofnewyork.us/resource/kvhd-5fmu.json?unique_id_number={}"
STATUS_TAG = "Open to all New Yorkers regardless of immigration status (NYC Benefits dataset tag)."


def clean(s):
    """HTML fragment -> one line of plain text. The dataset uses the string 'NULL' for empty."""
    if not s or s.strip() == "NULL":
        return ""
    s = re.sub(r"</li>\s*", "; ", s)
    s = re.sub(r"</p>|<br\s*/?>|</h\d>", " ", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s)).replace(" ", " ")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"(;\s*)+;", ";", s)
    return s.strip(" ;")


def how_to_apply(r):
    parts = []
    if clean(r["how_to_apply_summary"]):
        parts.append(clean(r["how_to_apply_summary"]))
    for label, text_key, url_key in [("Online", "how_to_apply_or_enroll_online", "url_of_online_application"),
                                     ("In person", "how_to_apply_or_enroll_in_person", "office_locations_url"),
                                     ("By phone", "how_to_apply_or_enroll_by_phone", None),
                                     ("By mail", "how_to_apply_or_enroll_by_mail", "url_of_pdf_application_forms")]:
        text = clean(r[text_key])
        url = clean(r[url_key]) if url_key else ""
        if text or url:
            parts.append(f"{label}: {text}{' ' if text and url else ''}{url}")
    if not parts:  # some service pages only list ways to get help
        for label, key in [("Get help", "get_help_summary"), ("In person", "get_help_in_person"),
                           ("Online", "get_help_online"), ("Email", "get_help_by_email"),
                           ("Call", "get_help_by_calling_other_than_311"), ("311", "get_help_by_calling_311")]:
            if clean(r[key]):
                parts.append(f"{label}: {clean(r[key])}")
    return " | ".join(parts)


def main():
    d = json.loads(RAW.read_text())
    cols = [c["fieldName"] for c in d["meta"]["view"]["columns"]]
    rows = [dict(zip(cols, r)) for r in d["data"]]
    missing = {r["unique_id_number"] for r in rows} - set(DATASET)
    if missing:
        sys.exit(f"New dataset rows need curation in program_curation.py: {sorted(missing)}")

    out = []
    for r in rows:
        pid, needs, en, es, status = DATASET[r["unique_id_number"]]
        if status is None:
            status = STATUS_TAG if "regardless of" in (r["population_served"] or "") else ""
        who = clean(r["plain_language_eligibility"])
        if not who and clean(r["population_served"]):
            who = "Population served: " + clean(r["population_served"]).replace(",", ", ")
        acronym = clean(r["program_acronym"])
        name = r["program_name"].strip()
        if acronym and acronym.lower() not in name.lower():
            name = f"{name} ({acronym})"
        out.append({
            "id": pid, "name": name, "needs": needs, "who_can_use": who, "status_note": status,
            "bring": clean(r["required_documents_summary"]), "how_to_apply": how_to_apply(r),
            "summary_es": es, "summary_en": en,
            "source_url": SOURCE_URL.format(r["unique_id_number"]), "last_checked": TODAY,
        })
    for m in MANUAL:
        out.append({**{k: m.get(k, "") for k in COLUMNS}, "last_checked": TODAY})

    # light self-checks; scripts/validate.py does the full contract check in phase 5
    ids = [o["id"] for o in out]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for o in out:
        assert o["id"].startswith("prog-") and re.fullmatch(r"prog-[a-z0-9-]+", o["id"]), o["id"]
        assert set(o["needs"].split("|")) <= NEEDS, (o["id"], o["needs"])
        for k in ("summary_en", "summary_es"):
            assert len(o[k].split()) < 30, (o["id"], k, len(o[k].split()))

    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        w.writerows(out)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} programs ({len(rows)} from dataset, {len(MANUAL)} added)")


if __name__ == "__main__":
    main()
