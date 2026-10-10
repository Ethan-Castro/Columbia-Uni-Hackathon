"""Build an open-data release of the knowledge graph for Hugging Face: hf_release/ with a dataset card and 3 CSVs.

Public-release filters (the app's own files in out/ keep everything):
  - accredited representatives (place-doj-rep-*): individual names are left out; the DOJ roster is linked instead
  - rows sourced only from the Western Union agent locator: a company's site, not open data
  - links whose endpoints were removed by the filters above
Run: python3 scripts/build_hf_release.py   (after the main pipeline)
"""
import collections, csv, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT, REL = ROOT / "out", ROOT / "hf_release"


def read(name):
    with (OUT / name).open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        return r.fieldnames, list(r)


def write(name, cols, rows):
    with (REL / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)


def main():
    if REL.exists():
        shutil.rmtree(REL)
    REL.mkdir()
    pc, programs = read("programs.csv")
    lc, places = read("places.csv")
    kc, links = read("links.csv")
    keep = [p for p in places if not p["id"].startswith("place-doj-rep-") and "location.westernunion.com" not in p["source_url"]]
    ids = {p["id"] for p in programs} | {p["id"] for p in keep}
    links = [l for l in links if l["from_id"] in ids and l["to_id"] in ids]
    write("programs.csv", pc, programs); write("places.csv", lc, keep); write("links.csv", kc, links)
    demo = [p for p in keep if p["zip"] in ("11368", "11373", "11372")]
    trust = collections.Counter(p["trust"] for p in keep)
    types = collections.Counter(p["org_type"] for p in keep)
    card = f"""---
license: cc-by-4.0
language:
- en
- es
pretty_name: NYC Immigrant Services Knowledge Graph (Corona, Queens focus)
tags:
- immigration
- social-services
- new-york-city
- knowledge-graph
- civic-tech
size_categories:
- n<1K
configs:
- config_name: programs
  data_files: programs.csv
- config_name: places
  data_files: places.csv
- config_name: links
  data_files: links.csv
---

# NYC Immigrant Services Knowledge Graph

A small, source-cited knowledge graph of public programs and service locations for immigrant New Yorkers, built in one day at the Latinos x AI Hackathon NYC (Immigration track, 2026-10-10). It goes deep in Corona, Queens (ZIPs 11368, 11373, 11372) and shallow across the rest of NYC. It powers an AI navigator that answers in Spanish and English.

**This is reference data, not legal advice.** Every row has a `source_url` and a `last_checked` date. Call ahead before going anywhere.

## Files

| File | Rows | What it is |
|---|---|---|
| `programs.csv` | {len(programs)} | Benefits and programs (SNAP, WIC, IDNYC, NYS DREAM Act, lending circles...) with plain-language summaries in Spanish and English, who can use them, what to bring, how to apply |
| `places.csv` | {len(keep)} | Physical locations: food pantries, WIC clinics, DOJ-listed immigration legal offices, IDNYC and HRA centers, libraries, consulates, check cashers ({len(demo)} in the Corona-area demo ZIPs) |
| `links.csv` | {len(links)} | Typed edges: `offers` (place to program), `unlocks`, `pairs_with`, `requires`, `refers_to` (program to program), each with a one-line reason |

Lists are pipe-separated (`food|legal`); languages are ISO codes; booleans are `true`/`false`, blank when unknown.

## Trust levels

- `official` ({trust['official']}): the facts come from a government source (NYC Open Data, NYC agencies, NYS, the U.S. Department of Justice EOIR lists, a consulate's own government site). This does not certify current capacity, cost or wait times, and a DOJ listing is not a DOJ endorsement.
- `verified` ({trust['verified']}): a person on our team confirmed it by phone on the check date.
- `unverified` ({trust['unverified']}): from a provider's own web page, not yet confirmed by phone.

Place types: {", ".join(f"{k} {v}" for k, v in types.most_common())}.

## Sources

- NYC Benefits and Programs dataset (NYC Open Data `kvhd-5fmu`)
- Food Help NYC, the City's food pantry and soup kitchen finder (its public data layer)
- U.S. DOJ EOIR Recognized Organizations and Accredited Representatives roster, and List of Pro Bono Legal Service Providers (NYC immigration courts)
- NYS Department of Agriculture WIC agency list; NYC Health + Hospitals; NYC HRA; IDNYC; NYC Public Schools; Queens Public Library
- Program pages: NYS HESC (DREAM Act), NYC Public Schools (McKinney-Vento transportation, NYC Schools Account), NYC DCA Immigrant Financial Services Study (tandas), Mission Asset Fund (lending circles)
- Census Geocoder for coordinates, kept only when the geocoder's ZIP and county agree with the stated address

## What is left out of this public release

- Names of individual DOJ-accredited representatives. Check a person on the official roster instead: https://www.justice.gov/eoir/recognition-accreditation-roster-reports. Someone missing from our data or the roster is not proof of fraud; ask a free legal provider.
- Locations taken from a money-transfer company's agent locator.
- Anything about the people who use the navigator. The dataset contains no resident data.

## Known limits

- Built in one day. Hours and phone numbers change; a phone spot-check of 8 places found wrong numbers and hours that differed from listings.
- Languages spoken are mostly unknown (blank) because few sources state them.
- Some relationships people expect (for example WIC with Child Health Plus) are not linked because no source we found states them.

## Citation

Latinos x AI Hackathon NYC 2026, Immigration track team. Data pipeline: `pipeline/` in https://github.com/Ethan-Castro/Columbia-Uni-Hackathon (if that repository is public).
"""
    (REL / "README.md").write_text(card, encoding="utf-8")
    print(f"hf_release/: programs {len(programs)}, places {len(keep)} (of {len(places)}), links {len(links)} (of {len(read('links.csv')[1])})")


if __name__ == "__main__":
    main()
