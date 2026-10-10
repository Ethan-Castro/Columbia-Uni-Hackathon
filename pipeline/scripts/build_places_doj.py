"""Phase 2: DOJ EOIR listings -> out/places.csv (DOJ rows) + out/places_doj_detail.csv (fields the contract can't hold)
+ out/phase2_review.md (counts, exclusions, conflicts, geocoding coverage).

Three kinds of rows, all trust=official ("the listing came from an official DOJ source"; it does NOT mean DOJ
endorsement, current openings, or free service, and absence from these lists means nothing about a person):
  place-doj-ro-*   recognized-organization office, from the roster "by State and City" (has an address)
  place-doj-pb-*   pro bono list office under a New York City immigration court list
  place-doj-rep-*  accredited representative, from the alphabetical roster. The roster ties a rep to an
                   organization only, never to an office, so address/borough/zip/lat/lng stay blank.

NYC scope for an office = stated city, stated ZIP and Census geocoder county all agree on one borough.
Any disagreement -> row kept with borough/lat/lng blank and a review flag. Offices outside the five boroughs
are dropped from the roster; pro bono offices outside NYC that are listed for a NYC court are kept with
borough blank and nyc_scope=outside_nyc so they are never counted as NYC places.

Run: python3 scripts/build_places_doj.py
"""
import csv, datetime, hashlib, json, pathlib, re, sys, time
import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse_doj

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
GEO_CACHE = ROOT / "raw" / "geocode"
TODAY = datetime.date.today().isoformat()

COLUMNS = ["id", "name", "org", "org_type", "address", "borough", "zip", "lat", "lng", "hours", "open_evenings",
           "open_weekends", "languages", "phone", "trust", "source_url", "last_checked"]
DETAIL_COLUMNS = ["id", "record_kind", "nyc_scope", "review_flag", "office_name", "stated_city", "courts",
                  "pro_bono_marker", "service_notes", "date_recognized", "recognition_expires", "org_status",
                  "accreditation_expires", "rep_status", "dhs_only", "org_place_ids", "org_has_offices_outside_nyc",
                  "geocode_status", "geocode_matched_address", "geocode_county", "source_page", "source_updated"]

SRC_STATE = "https://www.justice.gov/eoir/media/1398081/dl?inline"            # roster by state and city
SRC_ALPHA = "https://www.justice.gov/eoir/page/file/942301/download"          # alphabetical roster (reps)
SRC_PB = "https://www.justice.gov/eoir/file/probonofulllist/download"         # pro bono list (all courts)
NYC_COURTS = ["New York Immigration Courts", "New York Immigration Courts Juvenile Docket"]

COUNTY_BOROUGH = {"New York County": "Manhattan", "Kings County": "Brooklyn", "Queens County": "Queens",
                  "Bronx County": "Bronx", "Richmond County": "Staten Island"}
CITY_BOROUGH = {"new york": "Manhattan", "new york city": "Manhattan", "manhattan": "Manhattan",
                "brooklyn": "Brooklyn", "bronx": "Bronx", "the bronx": "Bronx", "staten island": "Staten Island",
                "queens": "Queens"}
QUEENS_POSTAL = {"astoria", "long island city", "lic", "sunnyside", "woodside", "jackson heights", "elmhurst", "corona",
                 "east elmhurst", "flushing", "forest hills", "rego park", "kew gardens", "richmond hill", "jamaica",
                 "queens village", "bellerose", "hollis", "ridgewood", "maspeth", "middle village", "ozone park",
                 "south ozone park", "howard beach", "far rockaway", "bayside", "fresh meadows", "whitestone",
                 "college point", "springfield gardens", "saint albans", "st. albans", "cambria heights",
                 "rosedale", "glen oaks", "little neck", "oakland gardens", "arverne", "rockaway park",
                 "woodhaven", "south richmond hill", "briarwood", "jamaica estates"}
LANG = {"english": "en", "spanish": "es", "french": "fr", "arabic": "ar", "russian": "ru", "haitian creole": "ht",
        "chinese": "zh", "mandarin": "zh", "cantonese": "zh", "bengali": "bn", "portuguese": "pt", "korean": "ko",
        "polish": "pl", "urdu": "ur", "hindi": "hi", "punjabi": "pa", "nepali": "ne", "tibetan": "bo",
        "wolof": "wo", "fulani": "ff", "mixteco": "", "quechua": "qu", "k'iche'": "quc"}


def zip_borough(z):
    z = int(z)
    if 10001 <= z <= 10282: return "Manhattan"
    if 10301 <= z <= 10314: return "Staten Island"
    if 10451 <= z <= 10475: return "Bronx"
    if 11201 <= z <= 11256: return "Brooklyn"
    if z in (11004, 11005) or 11101 <= z <= 11109 or 11351 <= z <= 11499 or 11691 <= z <= 11697: return "Queens"
    return None                                                     # e.g. 11550 Hempstead (Nassau) is NOT NYC


def city_borough(city):
    c = city.strip().lower()
    return CITY_BOROUGH.get(c) or ("Queens" if c in QUEENS_POSTAL else None)


def slug(s, n=48):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " and ").replace("'", "")).strip("-")
    return s[:n].rstrip("-")


UNIT = re.compile(r",?\s*\b(suite|ste\.?|floor|fl\.?|room|rm\.?|unit|pmb|apt\.?|#)\s*[\w-]*|,?\s*\b\d+(st|nd|rd|th)\s+floor\b|,?\s*annex building", re.I)


def geocode(street, city, zip_):
    """Census onelineaddress + county layer, cached in raw/geocode/. Tries the stated address, then without unit."""
    out = []
    for q in dict.fromkeys([f"{street}, {city}, NY {zip_}", f"{UNIT.sub('', street).strip(' ,')}, {city}, NY {zip_}"]):
        path = GEO_CACHE / (hashlib.sha1(q.encode()).hexdigest()[:16] + ".json")
        if path.exists():
            data = json.loads(path.read_text())
        else:
            for attempt in range(4):
                try:
                    r = requests.get("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
                                     params={"address": q, "benchmark": "Public_AR_Current", "vintage": "Current_Current",
                                             "layers": "Counties", "format": "json"}, timeout=60)
                    r.raise_for_status(); break
                except requests.RequestException:
                    time.sleep(2 ** (attempt + 1))
            else:
                return {"status": "error", "query": q}
            data = {"query": q, "response": r.json()}
            GEO_CACHE.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=1))
        matches = data["response"]["result"]["addressMatches"]
        if not matches:
            continue
        cands = [{"matched": m["matchedAddress"], "lat": round(m["coordinates"]["y"], 6), "lng": round(m["coordinates"]["x"], 6),
                  "county": m["geographies"]["Counties"][0]["NAME"] if m["geographies"].get("Counties") else "",
                  "matched_zip": m["matchedAddress"].rsplit(",", 1)[-1].strip()} for m in matches]
        in_zip = [c for c in cands if c["matched_zip"] == zip_]
        # several candidates in the stated ZIP are fine when they are the same point ("164 3RD AVE" / "164 THIRD AVE")
        if in_zip and len({c["county"] for c in in_zip}) == 1 and \
                max(c["lat"] for c in in_zip) - min(c["lat"] for c in in_zip) < 0.0005 and \
                max(c["lng"] for c in in_zip) - min(c["lng"] for c in in_zip) < 0.0005:
            return {"status": "matched", "query": q, **in_zip[0], "candidates": len(cands)}
        if in_zip:
            return {"status": "ambiguous_in_zip", "query": q, "candidates": len(cands), "matched": in_zip[0]["matched"]}
        return {"status": "matched_other_zip", "query": q, "candidates": len(cands),
                "matched": "; ".join(c["matched"] for c in cands[:3]),
                "county": cands[0]["county"] if len({c["county"] for c in cands}) == 1 else ""}
    return {"status": "no_match", "query": q}


def resolve_location(city, zip_, street):
    """Returns (nyc_scope, borough, lat, lng, flag, geo). Coordinates only when every signal agrees."""
    cb, zb = city_borough(city), zip_borough(zip_)
    if not cb and not zb:
        return "outside_nyc", "", "", "", "", {}
    if re.match(r"^(P\.?\s?O\.?\s*Box)\b", street, re.I):
        return "mailing_only", "", "", "", "PO Box mailing address, not a walk-in office", {"status": "not_geocoded_po_box"}
    if cb != zb:
        return "nyc_uncertain", "", "", "", f"stated city '{city}' ({cb or 'not NYC'}) disagrees with ZIP {zip_} ({zb or 'not NYC'})", \
            geocode(street, city, zip_) if street else {"status": "no_street"}
    geo = geocode(street, city, zip_) if street else {"status": "no_street"}
    gb = COUNTY_BOROUGH.get(geo.get("county", ""))
    if geo["status"] == "matched":
        if gb != zb:
            return "nyc_uncertain", "", "", "", f"geocoder county {geo['county']} disagrees with stated city/ZIP ({zb})", geo
        return "nyc", zb, geo["lat"], geo["lng"], "", geo
    # city and ZIP agree on a borough but the geocoder could not confirm the point: keep borough, withhold coordinates
    if geo["status"] == "matched_other_zip" and geo.get("county") and gb != zb:
        why = f"geocoder only found this street in other ZIPs/counties ({geo['matched']})"
    elif geo["status"] == "matched_other_zip":
        why = f"geocoder matched a different ZIP ({geo['matched']})"
    else:
        why = f"geocoder: {geo['status']}"
    return "nyc", zb, "", "", f"{why}; coordinates withheld, borough from stated city and ZIP", geo


def langs_from_notes(notes):
    found = []
    text = " ".join(notes)
    m = re.search(r"Languages?:\s*([^•]+)", text)
    seg = m.group(1) if m else ""
    m2 = re.search(r"bilingual\s+([A-Za-z]+)/([A-Za-z]+)", text, re.I)
    if m2:
        seg += f", {m2.group(1)}, {m2.group(2)}"
    if re.search(r"staff speaks spanish", text, re.I):
        seg += ", Spanish"
    for name, code in LANG.items():
        if code and re.search(rf"\b{re.escape(name)}\b", seg, re.I) and code not in found:
            found.append(code)
    return "|".join(found)


def pro_bono_records():
    blocks = parse_doj.parse_pro_bono(NYC_COURTS)
    # a name wrapped onto two lines in the right column ("ABA Commission ... Detention" / "Information Hotline**")
    # leaves its first half as the trailing line of the block above it; move it back
    for i in range(1, len(blocks)):
        prev, b = blocks[i - 1], blocks[i]
        if b["column"] == 1 and len(b["lines"][0].split()) <= 3 and len(prev["lines"]) > 1 \
                and re.match(r"^[A-Z][A-Za-z ]+$", prev["lines"][-1]) and len(prev["lines"][-1].split()) >= 3:
            b["lines"][0] = prev["lines"].pop() + " " + b["lines"][0]
            print(f"  note: joined wrapped pro bono name -> {b['lines'][0]}")
    recs = {}
    for b in blocks:
        head = b["lines"][0]
        marker = {"*": "non-profit organization", "**": "referral service", "***": "private attorney"}[re.search(r"\*+$", head).group(0)]
        org = head.rstrip("*").strip()
        body = b["lines"][1:]
        notes_start = next((i for i, l in enumerate(body) if l.startswith("•")), len(body))
        info, notes_raw = body[:notes_start], body[notes_start:]
        notes = []
        for l in notes_raw:                                         # re-join wrapped bullet lines
            if l.startswith("•"): notes.append(l.lstrip("• ").strip())
            elif notes: notes[-1] += " " + l
        offices, cur = [], {"office": "", "lines": []}
        for l in info:
            if re.match(r"^[A-Z][A-Za-z ]+ Office:$", l):
                if cur["lines"]: offices.append(cur)
                cur = {"office": l.rstrip(":"), "lines": []}
            else:
                cur["lines"].append(l)
        offices.append(cur)
        for o in offices:
            ci = next((i for i, l in enumerate(o["lines"]) if parse_doj.CITYLINE.match(l)), None)
            cm = parse_doj.CITYLINE.match(o["lines"][ci]) if ci is not None else None
            street = ", ".join(o["lines"][:ci]) if ci else ""
            phone = next((l.split(":", 1)[1].strip() for l in o["lines"] if l.startswith("Tel:")), "")
            key = (org, o["office"], street)
            r = recs.setdefault(key, {"org": org, "office": o["office"], "street": street,
                                      "city": cm["city"] if cm else "", "state": cm["state"] if cm else "",
                                      "zip": cm["zip"] if cm else "", "phone": phone, "marker": marker,
                                      "notes": notes, "languages": langs_from_notes(notes), "courts": [], "pages": []})
            if b["court"] not in r["courts"]:
                r["courts"].append(b["court"]); r["pages"].append(b["page"])
    return list(recs.values())


def main():
    places, details, excluded = [], [], []
    used = set()

    def new_id(base):
        i, pid = 2, base
        while pid in used:
            pid = f"{base}-{i}"; i += 1
        used.add(pid)
        return pid

    def add(place, detail):
        places.append({**{k: "" for k in COLUMNS}, **place, "trust": "official", "last_checked": TODAY})
        details.append({**{k: "" for k in DETAIL_COLUMNS}, **detail, "id": place["id"]})

    # ---- recognized organizations: NYC offices from the state/city roster
    roster = parse_doj.parse_state_roster()
    org_offices = {}
    for r in roster:
        street = r["street"]
        dup_city = f", {r['city']}, {r['state']} {r['zip']}"
        if street.endswith(dup_city):                               # one office repeats its city line in the street
            street = street[: -len(dup_city)]
        scope, borough, lat, lng, flag, geo = resolve_location(r["city"], r["zip"], street)
        if scope == "outside_nyc":
            excluded.append({"org": r["org"], "office": r["office"], "city": r["city"], "zip": r["zip"]})
            continue
        office_part = "" if r["office"] == "Principal Office" else r["office"]
        office_key = re.sub(rf"^{re.escape(r['org'])}\s*[-–]\s*", "", office_part)
        office_key = re.sub(r"(extension|satellite)?\s*office$", "", office_key, flags=re.I)
        pid = new_id("place-doj-ro-" + slug(r["org"], 40) + ("-" + slug(office_key, 24) if office_key.strip() else ""))
        org_offices.setdefault((r["org"], r["date_recognized"]), []).append(pid)
        add({"id": pid, "name": r["org"] + (f" ({office_part})" if office_part else ""), "org": r["org"],
             "org_type": "doj_roster", "address": ", ".join(x for x in [street, f"{r['city']}, NY {r['zip']}"] if x),
             "borough": borough, "zip": r["zip"], "lat": lat, "lng": lng, "phone": r["phone"],
             "source_url": f"{SRC_STATE}#page={r['page']}"},
            {"record_kind": "recognized_org_office", "nyc_scope": scope, "review_flag": flag,
             "office_name": r["office"], "stated_city": r["city"], "date_recognized": r.get("date_recognized", ""),
             "recognition_expires": r.get("recognition_expires", ""), "org_status": r.get("org_status", ""),
             "geocode_status": geo.get("status", ""), "geocode_matched_address": geo.get("matched", ""),
             "geocode_county": geo.get("county", ""), "source_page": r["page"], "source_updated": "2026-10-04"})
    # orgs that also have offices outside NYC (their reps may work there)
    outside = {(r["org"], r.get("date_recognized", "")) for r in roster if not zip_borough(r["zip"]) and not city_borough(r["city"])}

    # ---- pro bono listings under the NYC immigration court lists
    for r in pro_bono_records():
        if r["zip"]:
            scope, borough, lat, lng, flag, geo = resolve_location(r["city"], r["zip"], r["street"])
        else:
            scope, borough, lat, lng, flag, geo = "no_address", "", "", "", "no street address in the listing", {}
        if scope == "outside_nyc":
            flag = "office outside NYC; listed for a NYC immigration court, not counted as a NYC place"
            # stated address outside NYC: coordinates are fine to keep only when the geocoder agrees on ZIP
            geo = geocode(r["street"], r["city"], r["zip"]) if r["state"] == "NY" else {"status": "not_geocoded_out_of_state"}
            if geo.get("status") == "matched" and geo.get("matched_zip") == r["zip"]:
                lat, lng = geo["lat"], geo["lng"]
        office_part = r["office"]
        pid = new_id("place-doj-pb-" + slug(r["org"]) + ("-" + slug(office_part.replace("Office", ""), 20) if office_part else ""))
        add({"id": pid, "name": r["org"] + (f" ({office_part})" if office_part else ""), "org": r["org"],
             "org_type": "doj_pro_bono",
             "address": ", ".join(x for x in [r["street"], f"{r['city']}, {r['state']} {r['zip']}" if r["zip"] else ""] if x),
             "borough": borough, "zip": r["zip"], "lat": lat, "lng": lng, "languages": r["languages"],
             "phone": r["phone"], "source_url": f"{SRC_PB}#page={r['pages'][0]}"},
            {"record_kind": "pro_bono_listing", "nyc_scope": scope, "review_flag": flag, "office_name": office_part,
             "stated_city": r["city"], "courts": "|".join(r["courts"]), "pro_bono_marker": r["marker"],
             "service_notes": " | ".join(r["notes"]), "geocode_status": geo.get("status", ""),
             "geocode_matched_address": geo.get("matched", ""), "geocode_county": geo.get("county", ""),
             "source_page": "|".join(map(str, r["pages"])), "source_updated": "October 2026"})

    # ---- accredited representatives of organizations with at least one NYC office
    alpha = parse_doj.parse_alpha_roster()
    norm = lambda s: re.sub(r"\W", "", s.lower())
    by_key = {(norm(o["org"]), o["date_recognized"]): o for o in alpha}
    unmatched_orgs = []
    for (org, date), pids in org_offices.items():
        o = by_key.get((norm(org), date))
        if not o:
            unmatched_orgs.append(org); continue
        for rep in o["reps"]:
            pid = new_id("place-doj-rep-" + slug(rep["name"], 32) + "-" + slug(org, 24))
            add({"id": pid, "name": rep["name"], "org": org, "org_type": "doj_roster",
                 "source_url": f"{SRC_ALPHA}#page={rep['page']}"},
                {"record_kind": "accredited_rep", "nyc_scope": "org_has_nyc_office",
                 "review_flag": "", "accreditation_expires": rep["accreditation_expires"],
                 "rep_status": rep["rep_status"], "dhs_only": str(rep["dhs_only"]).lower(),
                 "org_place_ids": "|".join(pids), "org_has_offices_outside_nyc": str((org, date) in outside).lower(),
                 "date_recognized": o["date_recognized"], "recognition_expires": o["recognition_expires"],
                 "org_status": o["org_status"], "source_page": rep["page"], "source_updated": "2026-10-04"})

    OUT.mkdir(exist_ok=True)
    with (OUT / "places.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS); w.writeheader(); w.writerows(places)
    with (OUT / "places_doj_detail.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=DETAIL_COLUMNS); w.writeheader(); w.writerows(details)
    json.dump({"excluded_outside_nyc": excluded, "unmatched_orgs": unmatched_orgs,
               "alpha_org_count": len(alpha), "alpha_rep_count": sum(len(o["reps"]) for o in alpha),
               "state_roster_ny_records": len(roster)},
              open(OUT / ".phase2_meta.json", "w"), indent=1)
    print(f"wrote out/places.csv: {len(places)} rows; out/places_doj_detail.csv")


if __name__ == "__main__":
    main()
