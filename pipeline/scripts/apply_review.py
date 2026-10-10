"""Apply Felix's checks from the "Corona Place Checks" tracker to the pipeline.

Input: the tracker's `checks` collection saved as JSON files (one per place) in raw/review_checks/checks/, e.g. by
Claude's ArtifactData read with out_dir=raw/review_checks. Each check has status, method, languages, hours, bring,
access, fee, notes, checked_at, checked_by.

Rules
  verified   status "confirmed" or "changes" AND method "phone call" or "in person" (a website alone is not a check)
             -> id appended to scripts/verified_ids.txt (existing lines are never removed or rewritten)
  languages  only from a verified check -> scripts/review_overrides.json {id: {"languages": "es|en"}}
  closed     status "closed" -> review_overrides {"hold": "..."}; build_places_local.py keeps it out of places.csv
  hours, bring, fee, access, notes are reported for the data team to apply by hand (they change the source story).
Then run: build_places_local.py -> build_links.py -> validate.py
"""
import datetime, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKS = ROOT / "raw" / "review_checks" / "checks"
VERIFIED = ROOT / "scripts" / "verified_ids.txt"
OVERRIDES = ROOT / "scripts" / "review_overrides.json"
ISO = {"es", "en", "zh", "bn", "ne", "quc", "qu"}


DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def to_min(t):
    import re
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)", t.strip(), re.I)
    if not m:
        return None
    h = int(m[1]) % 12 + (12 if m[3].lower() == "pm" else 0)
    return h * 60 + int(m[2] or 0)


def flags(hours):
    """open_evenings / open_weekends for strings like 'Mon, Fri 8am-5pm; Tue-Thu 10am-6pm'. None if unreadable."""
    import re
    eve = wkd = False
    hours = re.sub(r"\([^)]*\)", "", hours)          # notes in parentheses may contain ";"
    for group in hours.split(";"):
        m = re.match(r"\s*([A-Za-z ,\-]+?)\s+(\d[\d:]*\s*[ap]m)\s*-\s*(\d[\d:]*\s*[ap]m)", group.strip(), re.I)
        if not m:
            return None
        days = set()
        for part in m[1].split(","):
            part = part.strip()[:3].title() if "-" not in part else part.strip()
            if "-" in part:
                a, b = [x.strip()[:3].title() for x in part.split("-")]
                days |= set(DAYS[DAYS.index(a):DAYS.index(b) + 1])
            elif part in DAYS:
                days.add(part)
        close = to_min(m[3])
        if days & set(DAYS[:5]) and close and close > 18 * 60:
            eve = True
        if days & {"Sat", "Sun"}:
            wkd = True
    return str(eve).lower(), str(wkd).lower()


def load_checks():
    out = {}
    for f in sorted(CHECKS.glob("*.json")):
        d = json.loads(f.read_text())
        body = d.get("data", d)                       # ArtifactData out_dir files may wrap the body
        out[body.get("place_id") or f.stem] = body
    return out


def main():
    checks = load_checks()
    existing = VERIFIED.read_text() if VERIFIED.exists() else ""
    have = {l.split("#")[0].strip() for l in existing.splitlines() if l.split("#")[0].strip()}
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    new_lines, manual = [], []
    for pid, c in checks.items():
        st, method = c.get("status"), c.get("method")
        when = (c.get("checked_at") or "")[:10] or datetime.date.today().isoformat()
        if st in ("confirmed", "changes") and method in ("phone call", "in person"):
            if pid not in have:
                new_lines.append(f"{pid}  # {st} by {method}, {when}, tracker check by {c.get('checked_by') or 'unknown'}")
            langs = [l for l in c.get("languages") or [] if l in ISO]
            if langs:
                overrides.setdefault(pid, {})["languages"] = "|".join(langs)
        # hours from a call or the place's own recorded message update the listing (this never verifies a place)
        if st in ("confirmed", "changes") and c.get("hours") and method in ("phone call", "in person", "recorded message"):
            fl = flags(c["hours"])
            if fl:
                overrides.setdefault(pid, {}).update({"hours": c["hours"], "open_evenings": fl[0], "open_weekends": fl[1],
                                                      "note": f"hours from {method} on {when}, entered by the review team"})
            else:
                manual.append((pid, st, {"hours (unreadable, apply by hand)": c["hours"]}))
        if c.get("phone_bad"):
            if pid.startswith("place-doj-"):
                manual.append((pid, st, {"phone": "DOJ-listed number did not work; kept because it is the official listing"}))
            else:
                overrides.setdefault(pid, {})["phone"] = ""
        if st == "closed":
            overrides.setdefault(pid, {})["hold"] = f"reported closed or moved in tracker check {when}: {c.get('notes', '')}".strip()
        extra = {k: c.get(k) for k in ("bring", "access", "fee", "notes") if c.get(k)}
        if extra:
            manual.append((pid, st, extra))
    if new_lines:
        with VERIFIED.open("a", encoding="utf-8") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            f.write("\n".join(new_lines) + "\n")
    OVERRIDES.write_text(json.dumps(overrides, indent=1, ensure_ascii=False) + "\n")
    print(f"checks read: {len(checks)}; newly verified: {len(new_lines)}; overrides: {len(overrides)}")
    for pid, st, extra in manual:
        print(f"  review by hand: {pid} [{st}] {extra}")


if __name__ == "__main__":
    main()
