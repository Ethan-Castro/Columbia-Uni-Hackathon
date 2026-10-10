"""Phase 2 parsers for the three DOJ EOIR PDFs. Each returns plain dicts with only fields the PDF states,
plus the 1-based PDF page each record came from.

  parse_state_roster()  -> recognized-organization offices in the NEW YORK section of the "by State and City" roster
  parse_alpha_roster()  -> accredited representatives grouped by organization (alphabetical roster)
  parse_pro_bono(courts)-> listings under the named immigration courts in the pro bono list (two-column pages)

Run directly to dump what was parsed: python3 scripts/parse_doj.py
"""
import collections, pathlib, re
import pdfplumber

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
DATE = r"\d\d/\d\d/\d\d\*?"
CITYLINE = re.compile(r"^(?P<city>[^,]+),\s*(?P<state>[A-Z]{2})\.?\s+(?P<zip>\d{5})(?:-\d{4})?$")
PHONE = re.compile(r"^\(?\d{3}\)?[\s.-]*\d{3}-\d{4}(\s*(ext\.?|x)\s*\d+)?$", re.I)


def _lines(page):
    out = []
    for l in page.extract_text_lines(return_chars=True):
        bold = sum("Bold" in c["fontname"] for c in l["chars"]) > len(l["chars"]) / 2
        out.append({"x0": l["x0"], "top": l["top"], "text": l["text"].strip(), "bold": bold})
    return out


# ---------------------------------------------------------------- roster by state and city
def parse_state_roster(path=RAW / "doj_eoir_roster_by_state.pdf", state="NEW YORK"):
    pdf = pdfplumber.open(path)
    seq, inside = [], False
    for pn, page in enumerate(pdf.pages, 1):
        first = True
        for l in _lines(page):
            t = l["text"]
            if l["bold"] and t.isupper() and l["x0"] > 150:      # state header
                inside = (t == state)
                continue
            if not inside:
                continue
            if t.startswith(("Recognized", "Organization", "Report Last Updated")) and l["x0"] < 60 and not re.search(DATE, t):
                continue                                          # repeated column header
            seq.append({**l, "page": pn, "page_start": first})
            first = False
    pdf.close()

    records, city, i = [], None, 0
    org = dates = None
    while i < len(seq):
        l = seq[i]
        if l["bold"]:                                             # city header
            city = l["text"]; i += 1; continue
        # ---- header: org line (optionally with dates), continuation lines, "(Pending Renewal)"
        m = re.match(rf"^(?P<name>.*?)\s+(?P<rec>{DATE})\s+(?P<exp>{DATE})\s+(?P<status>[A-Za-z]+)$", l["text"])
        if m:
            org = m.group("name").strip()
            dates = {"date_recognized": m["rec"], "recognition_expires": m["exp"], "org_status": m["status"]}
        else:
            org = l["text"]
            dates = dict(dates or {}) if org == (records[-1]["org"] if records else None) else {}
        header_page = l["page"]
        name_top = l["top"]
        i += 1
        while i < len(seq):
            n = seq[i]
            gap = n["top"] - name_top                              # measured from the last name line, not "(Pending Renewal)"
            if n["bold"]:
                break
            if n["text"].startswith("(Pending Renewal)") or n["x0"] > 300:
                if "Pending" in n["text"]:
                    dates["recognition_expires"] = dates.get("recognition_expires", "") + " (Pending Renewal)"
                i += 1; continue
            if n["page_start"] or gap >= 15:                      # blank line -> office block starts
                break
            org += " " + n["text"]; name_top = n["top"]; i += 1    # wrapped org name
        # ---- office block: office name, address lines, "City, ST 12345", optional phone
        body = []
        while i < len(seq) and not seq[i]["bold"]:
            body.append(seq[i]["text"]); i += 1
            if CITYLINE.match(body[-1]):
                break
        phone = ""
        if i < len(seq) and PHONE.match(seq[i]["text"]):
            phone = seq[i]["text"]; i += 1
        cm = CITYLINE.match(body[-1]) if body else None
        records.append({
            "org": re.sub(r"\s+", " ", org).strip(), "office": body[0] if len(body) > 1 else "",
            "street": ", ".join(body[1:-1]) if cm else "", "city": cm["city"] if cm else "",
            "state": cm["state"] if cm else "", "zip": cm["zip"] if cm else "", "phone": phone,
            "city_header": city, "page": header_page, "raw_block": " / ".join(body), **dates,
        })
    return records


# ---------------------------------------------------------------- alphabetical roster (reps)
# Column left edges (pt) read from the header row on page 1: org 38, date recognized 126, recognition
# expiration 192, org status 276, representative 348, accreditation expiration 434, rep status 506.
ALPHA_COLS = [("org", 0), ("date_recognized", 122), ("recognition_expires", 188), ("org_status", 272),
              ("rep", 344), ("accreditation_expires", 430), ("rep_status", 502)]


def _cells(words):
    cells = {k: [] for k, _ in ALPHA_COLS}
    for w in sorted(words, key=lambda w: w["x0"]):
        col = [k for k, x in ALPHA_COLS if w["x0"] >= x][-1]
        cells[col].append(w["text"])
    return {k: " ".join(v) for k, v in cells.items()}


def parse_alpha_roster(path=RAW / "doj_eoir_roster.pdf"):
    """Accredited representatives by organization. Stops at the address section that follows the roster table."""
    pdf = pdfplumber.open(path)
    orgs, cur_org, cur_rep = [], None, None
    for pn, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ""
        if "Recognized Organization Address" in text[:200]:
            break
        words = sorted(page.extract_words(x_tolerance=1.5), key=lambda w: (w["top"], w["x0"]))
        if pn == 1:                                                # title + disclaimer above the first header
            first_hdr = min(w["top"] for w in words if w["text"] == "Accreditation")
            words = [w for w in words if w["top"] >= first_hdr - 1]
        rows, row_top = [], None
        for w in words:                                           # cluster words into visual rows (3pt tolerance)
            if row_top is None or w["top"] - row_top > 3:
                rows.append([]); row_top = w["top"]
            rows[-1].append(w)
        for row in rows:
            c = _cells(row)
            if not any(c.values()) or (len(c["org"]) == 1 and c["org"].isupper() and not c["rep"]):
                continue                                           # letter divider
            if c["org"] in ("Recognized", "Organization") and c["rep"] in ("Accredited", "Representative"):
                continue                                           # column header (repeats at each letter)
            if c["org"] in ("", ) and c["rep"] == "" and c["accreditation_expires"] == "" and "Pending" in c["recognition_expires"]:
                cur_org["recognition_expires"] += " (Pending Renewal)"
                continue
            new_org = bool(re.match(DATE, c["date_recognized"]))
            if new_org and not c["org"] and cur_org and cur_org["date_recognized"] == c["date_recognized"] \
                    and cur_org["recognition_expires"].split(" ")[0] == c["recognition_expires"].split(" ")[0]:
                new_org = False                                    # same org split across report rows (name hidden)
            if new_org:
                # the report hides a repeated org name: a dated row with a blank name repeats the previous name
                name = c["org"] or (cur_org["org"] if cur_org else "")
                cur_org = {"org": name, "date_recognized": c["date_recognized"],
                           "recognition_expires": c["recognition_expires"].replace("(Pending", "").strip(),
                           "org_status": c["org_status"], "page": pn, "reps": []}
                if "(Pending" in c["recognition_expires"]:
                    cur_org["recognition_expires"] += " (Pending Renewal)"
                orgs.append(cur_org)
                cur_rep = None
            elif c["org"] and cur_org:
                cur_org["org"] += " " + c["org"]                     # wrapped org name
                if "(Pending" in c["recognition_expires"] and "Pending" not in cur_org["recognition_expires"]:
                    cur_org["recognition_expires"] += " (Pending Renewal)"
            if cur_org is None:
                continue
            if re.match(DATE, c["accreditation_expires"]):
                exp = re.match(DATE, c["accreditation_expires"]).group(0)
                cur_rep = {"name": c["rep"], "accreditation_expires": exp, "rep_status": c["rep_status"], "page": pn}
                if "(Pending" in c["accreditation_expires"]:
                    cur_rep["accreditation_expires"] += " (Pending Renewal)"
                cur_org["reps"].append(cur_rep)
            elif cur_rep is not None:
                if c["rep"]:
                    cur_rep["name"] += " " + c["rep"]
                if "Pending" in c["accreditation_expires"] and "Pending" not in cur_rep["accreditation_expires"]:
                    cur_rep["accreditation_expires"] += " (Pending Renewal)"
                if c["rep_status"] and not cur_rep["rep_status"]:
                    cur_rep["rep_status"] = c["rep_status"]
    pdf.close()
    # an org's rows can be split and interleaved (hidden repeated name); merge by (name, recognized, expires)
    merged = collections.OrderedDict()
    for o in orgs:
        o["org"] = re.sub(r"\s+", " ", o["org"]).strip()
        key = (o["org"], o["date_recognized"], o["recognition_expires"].split(" ")[0])
        if key in merged:
            merged[key]["reps"] += o["reps"]
            merged[key]["org_status"] = merged[key]["org_status"] or o["org_status"]
        else:
            merged[key] = o
    orgs = list(merged.values())
    for o in orgs:
        o["recognition_expires"] = o["recognition_expires"].replace("Renewal)", "").replace("  ", " ").strip()
        for r in o["reps"]:
            n = re.sub(r"\s+", " ", r["name"]).strip()
            r["dhs_only"] = bool(re.search(r"\(DHS\s*only\)", n))
            r["name"] = re.sub(r"\s*\(DHS\s*only\)", "", n).strip()
    return orgs


# ---------------------------------------------------------------- pro bono list
def parse_pro_bono(courts, path=RAW / "doj_eoir_pro_bono_full_list.pdf"):
    """Returns raw text blocks per provider under each named court. Pages are two columns; providers start with a
    line ending in the list's markers (* non-profit, ** referral service, *** private attorney)."""
    pdf = pdfplumber.open(path)
    out = []
    for pn, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ""
        court = next((c for c in courts if re.search(rf"^\s*{re.escape(c)}\s*$", text, re.M)), None)
        if not court:
            continue
        # columns: left text starts at x~34 and ends before x~278; right column starts at x~286
        split = 281
        head_bottom = 0
        for l in page.extract_text_lines():
            if l["text"].strip() == court or re.search(r"\(page \d of \d\)$", l["text"]) or re.match(r"^[A-Z][a-z]+.*, New York$", l["text"].strip()):
                head_bottom = max(head_bottom, l["bottom"])
        words = [w for w in page.extract_words(x_tolerance=1.5) if w["top"] > head_bottom]
        for col, ws in enumerate([[w for w in words if w["x0"] < split], [w for w in words if w["x0"] >= split]]):
            lines, top = [], None
            for w in sorted(ws, key=lambda w: (w["top"], w["x0"])):
                if top is None or w["top"] - top > 3:
                    lines.append([]); top = w["top"]
                lines[-1].append(w["text"])
            block = None
            for t in (" ".join(l) for l in lines):
                if re.search(r"\*{1,3}$", t) and not t.startswith("•"):
                    if block:
                        out.append(block)
                    block = {"court": court, "page": pn, "column": col, "lines": [t]}
                elif block:
                    block["lines"].append(t)
                elif out and out[-1]["court"] == court:           # name wrapped onto the next line, e.g. "Information Hotline**"
                    out[-1]["lines"].append(t)
                else:
                    block = {"court": court, "page": pn, "column": col, "lines": [t]}
            if block:
                out.append(block)
    pdf.close()
    return out


if __name__ == "__main__":
    recs = parse_state_roster()
    print(f"state roster NEW YORK records: {len(recs)}")
    for r in recs[:5]:
        print(r)
