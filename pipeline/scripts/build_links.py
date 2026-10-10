"""Phase 4: out/links.csv. Only relationships a source states. Each link carries the quote that supports it, and the
build fails if the quote is not found in the saved source (a NYC Benefits dataset row, or a saved web page).

  offers     place -> program   (from phase3_curation 'offers', already quote-checked, plus the ones below)
  unlocks    having/doing A opens B          pairs_with  A and B go together (e.g. one application)
  requires   B needs A first                 refers_to   A sends people to B

Not added on purpose (no supporting source yet): prog-idnyc -> prog-idnyc-bank-account 'unlocks' (needs a named bank's
own page), prog-wic -> prog-child-health-plus 'pairs_with'.
Run: python3 scripts/build_links.py
"""
import csv, html, json, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import sources
from program_curation import DATASET

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

STH = "https://www.schools.nyc.gov/school-life/special-situations/students-in-temporary-housing"   # raw/manual/nycps_sth.html
NYCSA = "https://www.schools.nyc.gov/learning/student-journey/nyc-schools-account"                 # raw/manual/nycps_nycsa.html
MAF = "https://www.missionassetfund.org/lending-circles"
IDNYC_BENEFITS = "https://www.nyc.gov/site/idnyc/benefits/benefits.page"
IDNYC_BANKS = "https://www.nyc.gov/site/idnyc/benefits/banks-and-credit-unions.page"
MANUAL = {STH: "raw/manual/nycps_sth.html", NYCSA: "raw/manual/nycps_nycsa.html"}

# (from, to, type, reason, source, quote). source "dataset:<id>" = that program's row in the NYC Benefits dataset.
LINKS = [
    ("prog-idnyc", "prog-snap", "unlocks", "IDNYC can be used as ID when applying for SNAP.",
     "dataset:prog-idnyc", "Use an IDNYC card to Apply for SNAP, Cash Assistance, Section 8, and other benefits"),
    ("prog-idnyc", "prog-cash-assistance", "unlocks", "IDNYC can be used as ID when applying for Cash Assistance.",
     "dataset:prog-idnyc", "Use an IDNYC card to Apply for SNAP, Cash Assistance, Section 8, and other benefits"),
    ("prog-idnyc", "prog-section-8", "unlocks", "IDNYC can be used as ID when applying for Section 8.",
     "dataset:prog-idnyc", "Use an IDNYC card to Apply for SNAP, Cash Assistance, Section 8, and other benefits"),
    ("prog-idnyc", "prog-library-card", "unlocks", "An IDNYC card works at any public library in New York City.",
     IDNYC_BENEFITS, "You can use your IDNYC card at any public library in New York City"),
    ("prog-idnyc", "prog-nycsa", "unlocks", "IDNYC is one of the photo IDs accepted to register for a NYC Schools Account at school.",
     NYCSA, "bring a valid photo ID (like your passport, driver's license, or IDNYC)"),
    ("prog-nycsa", "prog-school-enrollment", "requires", "NYCSA registration needs your child's NYC student ID number, so the child must be enrolled first.",
     NYCSA, "your child's nine-digit student ID number"),
    ("prog-school-enrollment", "prog-sth-transportation", "pairs_with", "Students in temporary housing can enroll right away and have a right to transportation to school.",
     STH, "Not be denied immediate school enrollment"),
    ("prog-cash-assistance", "prog-snap", "pairs_with", "One ACCESS HRA application covers Cash Assistance, SNAP and Medicaid.",
     "dataset:prog-cash-assistance", "You can apply for Cash Assistance, SNAP, and Medicaid at the same time"),
    ("prog-cash-assistance", "prog-medicaid", "pairs_with", "One ACCESS HRA application covers Cash Assistance, SNAP and Medicaid.",
     "dataset:prog-cash-assistance", "You can apply for Cash Assistance, SNAP, and Medicaid at the same time"),
    ("prog-snap", "prog-wic", "unlocks", "Being in SNAP counts toward WIC eligibility.",
     "dataset:prog-wic", "Does someone in your household participate in one of these programs? SNAP"),
    ("prog-medicaid", "prog-wic", "unlocks", "Being in Medicaid counts toward WIC eligibility.",
     "dataset:prog-wic", "SNAP TANF (cash assistance) Medicaid"),
    ("prog-essential-plan", "prog-wic", "unlocks", "Being in the Essential Plan counts toward WIC eligibility.",
     "dataset:prog-wic", "Essential Plan healthcare"),
    ("prog-snap", "prog-summer-ebt", "unlocks", "Children enrolled in SNAP are approved for Summer EBT automatically.",
     "dataset:prog-summer-ebt", "You do not need to apply if your child is enrolled in: SNAP"),
    ("prog-medicaid", "prog-summer-ebt", "unlocks", "Children enrolled in Medicaid are approved for Summer EBT automatically.",
     "dataset:prog-summer-ebt", "Medicaid Free or reduced-price school meals"),
    ("prog-snap", "prog-head-start", "unlocks", "Families receiving SNAP can qualify for Head Start or Early Head Start.",
     "dataset:prog-head-start", "You currently receive cash assistance, SNAP"),
    ("prog-child-health-plus", "prog-medicaid", "refers_to", "Child Health Plus is for children who don't qualify for Medicaid, so check Medicaid too.",
     "dataset:prog-child-health-plus", "children 18 and under who don't qualify for Medicaid"),
    ("prog-essential-plan", "prog-medicaid", "refers_to", "The Essential Plan is for people not eligible for Medicaid or Child Health Plus.",
     "dataset:prog-essential-plan", "Not eligible for Medicaid or Child Health Plus"),
    ("prog-nurse-family-partnership", "prog-wic", "pairs_with", "Nurse-Family Partnership asks whether you are or may be eligible for Medicaid or WIC.",
     "dataset:prog-nurse-family-partnership", "Are you eligible or think you may be eligible for Medicaid or WIC"),
    ("prog-eitc", "prog-free-tax-prep", "refers_to", "Get help claiming the EITC through NYC Free Tax Prep.",
     "dataset:prog-eitc", "Get help filing current and prior year returns through NYC Free Tax Prep"),
    ("prog-child-tax-credit", "prog-free-tax-prep", "refers_to", "Get help claiming the Child Tax Credit through NYC Free Tax Prep.",
     "dataset:prog-child-tax-credit", "Get help filing current and prior year returns through NYC Free Tax Prep"),
    ("prog-tandas", "prog-lending-circles", "pairs_with", "Lending Circles turn the community practice of lending in a group into a credit-building loan.",
     MAF, "Lending Circles turns a common community practice into a credit-building activity"),
    ("prog-idnyc-bank-account", "prog-financial-empowerment-centers", "refers_to", "The City points people opening a bank account to its Financial Empowerment Centers.",
     IDNYC_BANKS, "learn more about opening a bank account at one of the City's"),
    # ---------------- place -> program offers (beyond phase3_curation)
    ("place-queens-public-library-corona", "prog-library-card", "offers", "A public library in NYC, where an IDNYC card can be used.",
     IDNYC_BENEFITS, "You can use your IDNYC card at any public library in New York City"),
    ("place-queens-public-library-elmhurst", "prog-library-card", "offers", "A public library in NYC, where an IDNYC card can be used.",
     IDNYC_BENEFITS, "You can use your IDNYC card at any public library in New York City"),
    ("place-queens-public-library-jackson-heights", "prog-library-card", "offers", "A public library in NYC, where an IDNYC card can be used.",
     IDNYC_BENEFITS, "You can use your IDNYC card at any public library in New York City"),
    ("place-nyc-hh-elmhurst-hospital", "prog-nyc-care", "offers", "NYC Care services are at NYC Health + Hospitals locations.",
     "dataset:prog-nyc-care", "services at NYC Health + Hospitals locations citywide"),
    ("place-nyc-hh-gotham-jackson-heights", "prog-nyc-care", "offers", "NYC Care services are at NYC Health + Hospitals locations.",
     "dataset:prog-nyc-care", "services at NYC Health + Hospitals locations citywide"),
    ("place-nyc-hh-gotham-womens-health-corona", "prog-nyc-care", "offers", "NYC Care services are at NYC Health + Hospitals locations.",
     "dataset:prog-nyc-care", "services at NYC Health + Hospitals locations citywide"),
]


def dataset_text():
    d = json.loads((ROOT / "raw" / "benefits_kvhd-5fmu.json").read_text())
    cols = [c["fieldName"] for c in d["meta"]["view"]["columns"]]
    out = {}
    for r in d["data"]:
        row = dict(zip(cols, r))
        pid = DATASET[row["unique_id_number"]][0]
        txt = " ".join(str(v) for k, v in row.items() if not k.startswith(":") and v and v != "NULL")
        out[pid] = html.unescape(re.sub(r"<[^>]+>", " ", txt)).replace("’", "'")
    return out


def page(url):
    if url in MANUAL:
        from bs4 import BeautifulSoup
        return BeautifulSoup((ROOT / MANUAL[url]).read_text(encoding="utf-8", errors="ignore"), "lxml").get_text(" ")
    return sources.text(url)


def main():
    ds = dataset_text()
    rows, failures = [], []
    for frm, to, typ, reason, src, quote in LINKS:
        text = ds.get(src.split(":", 1)[1], "") if src.startswith("dataset:") else page(src)
        if sources.norm(quote) not in sources.norm(text).replace("’", "'"):
            failures.append(f"{frm} -> {to}: quote not found in {src}")
        rows.append({"from_id": frm, "to_id": to, "type": typ, "reason": reason})
    for o in json.loads((OUT / "phase3_offers.json").read_text()):
        prog = o["to_id"]
        reason = {"prog-wic": "Listed as a WIC site by its official source.",
                  "prog-idnyc": "Listed by the City as an IDNYC enrollment center.",
                  "prog-snap": "Listed by HRA as a SNAP center.",
                  "prog-school-enrollment": "NYC Public Schools Family Welcome Center that helps families enroll students."}[prog]
        rows.append({"from_id": o["from_id"], "to_id": prog, "type": "offers", "reason": reason})
    if failures:
        print("LINK EVIDENCE FAILURES:\n  " + "\n  ".join(failures)); sys.exit(1)
    seen, uniq = set(), []
    for r in rows:
        k = (r["from_id"], r["to_id"], r["type"])
        if k not in seen:
            seen.add(k); uniq.append(r)
    with (OUT / "links.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["from_id", "to_id", "type", "reason"]); w.writeheader(); w.writerows(uniq)
    print(f"wrote out/links.csv: {len(uniq)} links; all {len(LINKS)} explicit links matched their source quote")


if __name__ == "__main__":
    main()
