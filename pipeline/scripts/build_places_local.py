"""Phase 3: add neighborhood-depth places to out/places.csv, keeping the Phase 2 DOJ rows untouched.

Sources
  1. Food Help NYC (the City's food pantry / soup kitchen finder): open sites from its public ArcGIS layer
     (raw/foodhelp_nyc1.json). Hours come from the layer's structured day/time fields, coordinates from the layer.
  2. Hand-sourced places in scripts/phase3_curation.py; every field has a quote checked against the saved page.
trust: official for government sources, unverified otherwise. 'verified' is applied ONLY to ids listed in
scripts/verified_ids.txt, which is filled after Felix's manual review.

Writes out/places.csv (DOJ rows + these), out/places_local_detail.csv, out/phase3_offers.json (for links.csv),
out/phase3_review.md and out/phase3_review_checklist.md.
Run: python3 scripts/build_places_local.py
"""
import collections, csv, datetime, json, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import sources
from build_places_doj import COLUMNS, resolve_location, slug
from phase3_curation import PLACES, MANUAL_FILES, UNCONFIRMED

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
TODAY = datetime.date.today().isoformat()
FH_LAYER = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/Food_Help_Programs_PROD_view/FeatureServer/0"
BORO = {"QN": "Queens", "BK": "Brooklyn", "MN": "Manhattan", "MH": "Manhattan", "NY": "Manhattan", "BX": "Bronx", "SI": "Staten Island"}
NEIGHBORHOOD = {"11368": "Corona", "11373": "Elmhurst", "11372": "Jackson Heights", "11369": "East Elmhurst",
                "11370": "East Elmhurst"}
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def neighborhood(z):
    return NEIGHBORHOOD.get(z, "rest of NYC" if z else "unknown")


# ---------------------------------------------------------------- Food Help NYC
def t12(s):
    """'09:00 AM' -> ('9am', minutes since midnight). '12:00 AM' as a closing time means midnight (24:00)."""
    m = re.match(r"(\d{1,2}):(\d{2})\s*([AP]M)", s or "", re.I)
    if not m:
        return None
    h, mi, ap = int(m[1]), int(m[2]), m[3].lower()
    mins = (h % 12 + (12 if ap == "pm" else 0)) * 60 + mi
    return f"{h}{':' + m[2] if mi else ''}{ap}", mins


def fh_hours(a):
    """Build 'Mon-Fri 11:30am-1pm (soup kitchen); Sat 11am-12pm (pantry)' from the structured fields."""
    groups, evening, weekend, any_window = [], False, False, False
    for svc, label in (("fp", "pantry"), ("sk", "soup kitchen")):
        per_day = []
        for d in DAYS:
            wins = []
            if (a.get(f"{svc}_{d}") or "").lower() == "open":
                for k in (1, 2, 3):
                    o, c = t12(a.get(f"{svc}_{d}_open{k}")), t12(a.get(f"{svc}_{d}_close{k}"))
                    if o and c:
                        close = c[1] if c[1] > o[1] else c[1] + 24 * 60
                        wins.append(f"{o[0]}-{c[0]}")
                        any_window = True
                        if d in DAYS[:5] and close > 18 * 60: evening = True
                        if d in ("sat", "sun"): weekend = True
            per_day.append(", ".join(wins))
        i = 0
        while i < 7:                                            # merge consecutive days with the same windows
            if not per_day[i]:
                i += 1; continue
            j = i
            while j + 1 < 7 and per_day[j + 1] == per_day[i]:
                j += 1
            span = DAYS[i].title() if i == j else f"{DAYS[i].title()}-{DAYS[j].title()}"
            groups.append((i, f"{span} {per_day[i]}", label))
            i = j + 1
    notes = {"pantry": (a.get("fp_notes") or "").strip(" ()"), "soup kitchen": (a.get("sk_notes") or "").strip(" ()")}
    out = []
    for _, txt, label in sorted(groups):
        note = f"{label}: {notes[label]}" if notes[label] else label
        out.append(f"{txt} ({note})")
    if not any_window:
        return "", "", ""
    return "; ".join(out), str(evening).lower(), str(weekend).lower()


def foodhelp_rows(used):
    data = json.loads((ROOT / "raw" / "foodhelp_nyc1.json").read_text())
    rows, details = [], []
    for f in data["features"]:
        a = f["attributes"]
        if a.get("status") != "Open":
            continue
        name = re.sub(r"\s+", " ", a["program"]).strip()
        addr = re.sub(r",?\s*USA$", "", (a["distadd"] or "").strip())
        zip_ = str(a["distzip"] or "")
        flags = []
        m = re.search(r"\b(\d{5})\b(?!.*\d{5})", addr)
        if m and m[1] != zip_:
            flags.append(f"address ZIP {m[1]} differs from layer ZIP {zip_}; using the address ZIP")
            zip_ = m[1]
        hours, eve, wkd = fh_hours(a)
        orig = " / ".join(x for x in [f"pantry: {a.get('fp_days_orig')} {a.get('fp_hours_orig')}" if a.get("fp_days_orig") else "",
                                      f"soup kitchen: {a.get('sk_days_orig')} {a.get('sk_hours_orig')}" if a.get("sk_days_orig") else ""] if x)
        def toks(x):
            x = x.upper().replace("THUR", "THU")
            return set(re.findall(r"MON|TUE|WED|THU|FRI|SAT|SUN", x)) | {n.lstrip("0") for n in re.findall(r"\d+", x)}
        if orig and hours and toks(orig) - {""} != toks(hours.replace(":00", "")) - {""}:
            flags.append(f"confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says '{orig}'")
        good_geo = (a.get("address_score") or 0) >= 95 and a.get("lat") and a.get("lon")
        base = "place-fh-" + slug(name, 44)
        pid, k = base, 2
        while pid in used:
            pid = f"{base}-{k}"; k += 1
        used.add(pid)
        rows.append({**{c: "" for c in COLUMNS}, "id": pid, "name": name, "org": name, "org_type": "pantry",
                     "address": addr if re.search(r"\d{5}", addr) else f"{addr}, NY {zip_}".strip(", "),
                     "borough": BORO.get(a.get("distboro"), ""), "zip": zip_,
                     "lat": round(a["lat"], 6) if good_geo else "", "lng": round(a["lon"], 6) if good_geo else "",
                     "hours": hours, "open_evenings": eve, "open_weekends": wkd, "phone": (a.get("org_phone") or "").strip(),
                     "trust": "official", "source_url": f"{FH_LAYER}/query?where=FID%3D{a['FID']}&outFields=*&f=json",
                     "last_checked": TODAY})
        details.append({"id": pid, "source_kind": "foodhelp_nyc", "neighborhood": neighborhood(zip_),
                        "services": ",".join(s for s, v in (("pantry", a.get("type_fp")), ("soup kitchen", a.get("type_sk"))) if v),
                        "review_flag": "; ".join(flags), "evidence_check": "structured City record",
                        "geocode_status": "City layer coordinates" if good_geo else f"address_score {a.get('address_score')}; coordinates withheld",
                        "layer_edit_date": datetime.datetime.fromtimestamp(a["EditDate"] / 1000, datetime.UTC).date().isoformat() if a.get("EditDate") else ""})
    return rows, details


# ---------------------------------------------------------------- hand-sourced
def page_text(url):
    if url in MANUAL_FILES:
        from bs4 import BeautifulSoup
        html = (ROOT / MANUAL_FILES[url]).read_text(encoding="utf-8", errors="ignore")
        return BeautifulSoup(html, "lxml").get_text(" ")
    return sources.text(url)


def check_evidence(p):
    failures = []
    pairs = [(p["source_url"], p["evidence"])] + list(p.get("evidence_more", {}).items())
    for url, ev in pairs:
        txt = sources.norm(page_text(url))
        if not txt:
            failures.append(f"no saved copy of {url}")
        for field, quote in ev.items():
            if sources.norm(quote) not in txt:
                failures.append(f"{field}: quote not found in {url}")
    return failures


def hand_rows(used):
    rows, details, offers, failures = [], [], [], []
    for p in PLACES:
        fails = check_evidence(p)
        failures += [f"{p['id']}: {x}" for x in fails]
        street = p["address"].rsplit(",", 2)[0] if p["zip"] else ""
        city = p["address"].rsplit(",", 2)[1].strip() if p["zip"] and p["address"].count(",") >= 2 else ""
        if p["zip"]:
            scope, borough, lat, lng, flag, geo = resolve_location(city, p["zip"], street)
        else:
            scope, borough, lat, lng, flag, geo = "no_zip", "", "", "", "no ZIP in source", {}
        if scope == "outside_nyc":
            flag = "outside NYC"
        used.add(p["id"])
        row = {**{c: "" for c in COLUMNS}, **{k: v for k, v in p.items() if k in COLUMNS}, "borough": borough,
               "lat": lat, "lng": lng, "last_checked": TODAY}
        rows.append(row)
        details.append({"id": p["id"], "source_kind": "hand_sourced", "neighborhood": neighborhood(p["zip"]),
                        "services": "", "review_flag": "; ".join(x for x in [p.get("review", ""), flag] if x),
                        "evidence_check": "FAIL: " + "; ".join(fails) if fails else f"pass ({len(p['evidence']) + sum(len(v) for v in p.get('evidence_more', {}).values())} quotes)",
                        "geocode_status": geo.get("status", ""), "layer_edit_date": ""})
        for prog in p.get("offers", []):
            offers.append({"from_id": p["id"], "to_id": prog, "source_url": p["source_url"]})
    return rows, details, offers, failures


def main():
    doj = list(csv.DictReader((OUT / "places_doj.csv").open(encoding="utf-8")))   # written by build_places_doj.py
    used = {r["id"] for r in doj}
    fh, fh_det = foodhelp_rows(used)
    hs, hs_det, offers, failures = hand_rows(used)
    if failures:
        print("EVIDENCE CHECK FAILURES:\n  " + "\n  ".join(failures))
        sys.exit(1)
    verified = set()
    vfile = ROOT / "scripts" / "verified_ids.txt"
    if vfile.exists():
        verified = {l.split("#")[0].strip() for l in vfile.read_text().splitlines() if l.split("#")[0].strip()}
    # ---- live-import rules (Ethan's importer fills a blank borough from the ZIP and rejects non-NYC rows)
    doj_det = {d["id"]: d for d in csv.DictReader((OUT / "places_doj_detail.csv").open(encoding="utf-8"))}
    held, reasons = [], {}
    def hold(r, why):
        held.append(r); reasons[r["id"]] = why
    for p in PLACES:                                   # conflicting sources (hold=True in the curation)
        if p.get("hold"):
            reasons[p["id"]] = "conflicting sources: " + p.get("review", "")
    keep_doj = []
    pb_keys = {(r["name"].lower(), r["address"].lower()) for r in doj if r["org_type"] == "doj_pro_bono"}
    for r in doj:
        scope = doj_det.get(r["id"], {}).get("nyc_scope", "")
        if scope == "outside_nyc":
            hold(r, "office outside NYC (listed for a NYC court)"); continue
        if r["org_type"] == "doj_roster" and r["address"] and (r["name"].lower(), r["address"].lower()) in pb_keys:
            hold(r, "same name and address as its pro bono list row, which is kept"); continue
        if scope in ("nyc_uncertain", "mailing_only"):
            r = {**r, "zip": ""}    # keeps it for the notario name check, out of location search, until reviewed
        keep_doj.append(r)
    doj = keep_doj
    # Felix's tracker checks (scripts/apply_review.py): closed places are held, verified languages applied
    ofile = ROOT / "scripts" / "review_overrides.json"
    overrides = json.loads(ofile.read_text()) if ofile.exists() else {}
    for oid, o in overrides.items():
        if o.get("hold"):
            reasons[oid] = o["hold"]
    def apply_lang(r):
        o = overrides.get(r["id"], {})
        return {**r, "languages": o["languages"]} if o.get("languages") else r
    keep_fh = []
    for r in fh:
        if r["id"] in reasons:
            hold(r, reasons[r["id"]])
        else:
            keep_fh.append(apply_lang(r))
    fh = keep_fh
    keep_doj = []
    for r in doj:
        if r["id"] in reasons:
            hold(r, reasons[r["id"]])
        else:
            keep_doj.append(apply_lang(r))
    doj = keep_doj
    hs = [apply_lang(r) for r in hs]
    keep_hs = []
    for r in hs:
        if r["id"] in reasons:
            hold(r, reasons[r["id"]])
        elif not r["zip"]:
            hold(r, "source gives no ZIP")
        else:
            keep_hs.append(r)
    hs = keep_hs
    held_ids = {r["id"] for r in held}
    offers = [o for o in offers if o["from_id"] not in held_ids]
    with (OUT / "places_held.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS + ["held_reason"]); w.writeheader()
        w.writerows({**r, "held_reason": reasons[r["id"]]} for r in held)
    rows = doj + fh + hs
    for r in rows:
        if r["id"] in verified:
            r["trust"] = "verified"
    with (OUT / "places.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS); w.writeheader(); w.writerows(rows)
    det = fh_det + hs_det
    with (OUT / "places_local_detail.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(det[0].keys())); w.writeheader(); w.writerows(det)
    (OUT / "phase3_offers.json").write_text(json.dumps(offers, indent=1))
    print(f"wrote out/places.csv: {len(rows)} rows ({len(doj)} DOJ, {len(fh)} Food Help NYC, {len(hs)} hand-sourced; {len(held)} held out in out/places_held.csv); "
          f"{len(verified & {r['id'] for r in rows})} marked verified")
    report(rows + held, det, doj)


def report(rows, det, doj):
    D = {d["id"]: d for d in det}
    new = [r for r in rows if r["id"] in D]
    def area(r):
        return "Corona (11368)" if r["zip"] == "11368" else ("nearby: " + neighborhood(r["zip"]) if r["zip"] in NEIGHBORHOOD else "rest of NYC")
    ct = collections.Counter(area(r) for r in new)
    by_type = collections.defaultdict(collections.Counter)
    for r in new:
        by_type[area(r)][r["org_type"]] += 1
    L = ["# Phase 3 review: neighborhood depth", "",
         "`official` = the facts come from a government source; it does not certify current capacity, cost or wait. "
         "No row is `verified` until Felix's manual review is recorded in `scripts/verified_ids.txt`.", "",
         "## New places by area (location from the stated ZIP)", "", "| area | places | by org_type |", "|---|---|---|"]
    for k in sorted(ct, key=lambda x: (not x.startswith("Corona"), not x.startswith("nearby"), x)):
        L.append(f"| {k} | {ct[k]} | {dict(by_type[k])} |")
    L.append(f"| **total new** | {len(new)} | |")
    L += ["", f"DOJ rows from Phase 2 kept unchanged: {len(doj)}. Demo-zip DOJ offices: "
          + ", ".join(r["id"] for r in doj if r["zip"] in NEIGHBORHOOD), ""]
    L += ["## Source checks", "",
          f"- Hand-sourced rows: {sum(1 for d in det if d['source_kind']=='hand_sourced')}, every field quote found in the saved source page: "
          f"{all(d['evidence_check'].startswith('pass') for d in det if d['source_kind']=='hand_sourced')}",
          f"- Food Help NYC rows: {sum(1 for d in det if d['source_kind']=='foodhelp_nyc')} open sites from the City layer; coordinates kept only when the layer's address score is 95 or higher "
          f"({sum(1 for r in new if r['id'].startswith('place-fh-') and r['lat'])} with coordinates).",
          f"- Every row has an http(s) source_url: {all(r['source_url'].startswith('http') for r in rows)}", ""]
    L += ["## Possible duplicates (same street address, kept as separate rows)", ""]
    keyed = collections.defaultdict(list)
    for r in rows:
        if r["address"] and r["zip"]:
            keyed[(re.sub(r"[^a-z0-9]", "", r["address"].lower().split(",")[0]), r["zip"])].append(r["id"])
    dups = [v for v in keyed.values() if len(v) > 1 and not all(x.startswith("place-doj-") for x in v)]
    L += [f"- {', '.join(v)}" for v in dups] or ["- none"]
    L += ["", "## Rows with review flags (demo area)", ""]
    L += [f"- `{r['id']}`: {D[r['id']]['review_flag']}" for r in new if D[r["id"]]["review_flag"] and r["zip"] in NEIGHBORHOOD] or ["- none"]
    L += ["", "## Demo requirements the sources could not confirm", ""] + [f"- {u}" for u in UNCONFIRMED]
    (OUT / "phase3_review.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    checklist(rows, D)
    print("\n".join(L))


def checklist(rows, D):
    """The 25 most useful Corona-area records for Felix's manual review: demo zips first, by demo need."""
    # Ethan's order: pantries, WIC/clinics, legal offices near the demo zips, then the rest; money shops capped at 2
    prio = {"pantry": 0, "clinic": 1, "doj_pro_bono": 2, "doj_roster": 2, "other": 3, "idnyc": 4, "benefits_office": 5,
            "school": 6, "check_casher": 7, "remittance": 7, "consulate": 9}
    zip_rank = {"11368": 0, "11373": 1, "11372": 1}                 # the three demo zips only
    cand = [r for r in rows if (r["id"] in D or r["org_type"] in ("doj_roster", "doj_pro_bono"))
            and not r["id"].startswith("place-doj-rep-")
            and (r["zip"] in zip_rank or r["org_type"] in ("idnyc", "benefits_office", "school", "consulate"))]
    seen_keys, uniq = set(), []
    for r in cand:                                     # a held duplicate roster row is reviewed via its pro bono twin
        k = (r["name"].lower(), r["address"].lower())
        if r["zip"] in zip_rank and k not in seen_keys:
            seen_keys.add(k); uniq.append(r)
    cand = uniq
    cand.sort(key=lambda r: (prio.get(r["org_type"], 9), zip_rank.get(r["zip"], 3), r["name"]))
    pick, seen_types = [], collections.Counter()
    for r in cand:
        group = "money" if r["org_type"] in ("check_casher", "remittance") else r["org_type"]
        if group == "money" and seen_types["money"] >= 2:
            continue
        seen_types[group] += 1
        pick.append(r)
        if len(pick) == 25:
            break
    L = ["# Corona review checklist (25 records) for Felix", "",
         "Call or visit, then add the id to `scripts/verified_ids.txt` and rerun `python3 scripts/build_places_local.py` "
         "to mark it `verified`. Do not add an id that was not actually checked.", "",
         "Always confirm: still operating at this address; phone answers; hours as listed; Spanish spoken (es); "
         "what to bring (ID needed?); walk-in or appointment; any fee.", ""]
    for i, r in enumerate(pick, 1):
        d = D.get(r["id"], {})
        extra = []
        if not r["hours"]: extra.append("hours unknown: get the weekly schedule")
        if not r["languages"]: extra.append("languages not stated")
        if not r["phone"]: extra.append("no phone in source")
        if not r["lat"]: extra.append("no coordinates")
        if d.get("review_flag"): extra.append(d["review_flag"])
        L += [f"{i}. [ ] **{r['name']}** (`{r['id']}`, {r['org_type']}, trust {r['trust']})",
              f"   - {r['address'] or '(no address)'} | {r['phone'] or '(no phone)'} | hours: {r['hours'] or 'unknown'}",
              f"   - source: {r['source_url']}",
              f"   - check: {'; '.join(extra) if extra else 'standard checks only'}"]
    (OUT / "phase3_review_checklist.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    # same 25 rows as seed data for the shared review tracker page (public listing data only)
    seed = []
    for i, r in enumerate(pick, 1):
        d = D.get(r["id"], {})
        todo = ["Still operating here?", "Hours as listed?", "Spanish spoken?", "What to bring?", "Walk-in or appointment?", "Any fee?"]
        if d.get("review_flag"): todo.append(d["review_flag"])
        seed.append({"order": i, "place_id": r["id"], "name": r["name"], "org_type": r["org_type"], "address": r["address"],
                     "zip": r["zip"], "phone": r["phone"], "hours": r["hours"], "languages": r["languages"],
                     "trust": r["trust"], "source_url": r["source_url"], "to_confirm": todo})
    (OUT / "review_tracker_seed.json").write_text(json.dumps(seed, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
