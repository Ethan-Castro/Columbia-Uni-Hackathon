"""Download raw source files into raw/. Rerun safe: skips files already present."""
import pathlib, sys, requests

RAW = pathlib.Path(__file__).resolve().parent.parent / "raw"
RAW.mkdir(exist_ok=True)

SOURCES = {
    "benefits_kvhd-5fmu.json": "https://data.cityofnewyork.us/api/views/kvhd-5fmu/rows.json?accessType=DOWNLOAD",
    "doj_eoir_roster.pdf": "https://www.justice.gov/eoir/page/file/942301/download",
    "doj_eoir_pro_bono_index.html": "https://www.justice.gov/eoir/list-pro-bono-legal-service-providers",
    # Phase 2: the alphabetical roster above has no addresses, so NYC entries come from the
    # "Listed by State" roster linked at https://www.justice.gov/eoir/recognition-accreditation-roster-reports
    "doj_eoir_roster_reports_index.html": "https://www.justice.gov/eoir/recognition-accreditation-roster-reports",
    "doj_eoir_roster_by_state.pdf": "https://www.justice.gov/eoir/media/1398081/dl?inline",
    # the pro bono index page links one nationwide PDF; NY court sections are parsed out of it
    "doj_eoir_pro_bono_full_list.pdf": "https://www.justice.gov/eoir/file/probonofulllist/download",
}

def main(force=False):
    for name, url in SOURCES.items():
        path = RAW / name
        if path.exists() and not force:
            print(f"skip {name} (exists)")
            continue
        r = requests.get(url, timeout=120, headers={"User-Agent": "Mozilla/5.0 (hackathon data pipeline)"})
        r.raise_for_status()
        path.write_bytes(r.content)
        print(f"saved {name} ({len(r.content):,} bytes)")

if __name__ == "__main__":
    main(force="--force" in sys.argv)
