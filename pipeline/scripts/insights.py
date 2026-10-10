"""Phase 6: two evidence-backed insights from our own output files -> out/insights.md + out/insight_*.png

1. Food pantry and soup kitchen hours (Food Help NYC rows): share with NO weekday hours after 6 PM and share with
   NO Sunday hours, demo zips vs the rest of NYC. Denominator = sites whose City listing has structured hours.
2. DOJ-listed immigration legal offices per borough (Phase 2 rows whose NYC location is confirmed), split into
   recognized-organization offices and pro bono list offices.
Run: python3 scripts/insights.py
"""
import collections, csv, pathlib, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DEMO = {"11368", "11373", "11372"}
BLUE, ORANGE = "#2a78d6", "#eb6834"                         # categorical slots 1-2 (validated, light surface)
SURFACE, INK, INK2, MUTED = "#fcfcfb", "#0b0b0b", "#52514e", "#898781"

places = list(csv.DictReader((OUT / "places.csv").open(encoding="utf-8")))
doj_det = {d["id"]: d for d in csv.DictReader((OUT / "places_doj_detail.csv").open(encoding="utf-8"))}


def style(ax):
    ax.set_facecolor(SURFACE)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTED)
    ax.tick_params(colors=INK2, length=0)
    ax.grid(axis="x", color="#e6e5e1", linewidth=0.8)
    ax.set_axisbelow(True)


# ---------------------------------------------------------------- insight 1
fh = [r for r in places if r["id"].startswith("place-fh-")]
def stats(rows):
    known = [r for r in rows if r["hours"]]
    no_eve = sum(r["open_evenings"] == "false" for r in known)
    no_sun = sum(not re.search(r"\bSun\b|-Sun\b|Sat-Sun|Fri-Sun|Thu-Sun|Wed-Sun|Tue-Sun|Mon-Sun", r["hours"]) for r in known)
    return len(rows), len(known), no_eve, no_sun
demo = stats([r for r in fh if r["zip"] in DEMO])
rest = stats([r for r in fh if r["zip"] not in DEMO])
pct = lambda a, b: round(100 * a / b) if b else 0

fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
fig.patch.set_facecolor(SURFACE); style(ax)
cats = ["No weekday hours\nafter 6 PM", "No Sunday hours"]
y = [1, 0]
h = 0.34
vals_demo = [pct(demo[2], demo[1]), pct(demo[3], demo[1])]
vals_rest = [pct(rest[2], rest[1]), pct(rest[3], rest[1])]
b1 = ax.barh([v + h / 2 + 0.01 for v in y], vals_demo, height=h, color=BLUE, label=f"Corona / Elmhurst / Jackson Heights (n={demo[1]})")
b2 = ax.barh([v - h / 2 - 0.01 for v in y], vals_rest, height=h, color=ORANGE, label=f"Rest of NYC (n={rest[1]})")
for bars in (b1, b2):
    for bar in bars:
        ax.text(bar.get_width() + 1.2, bar.get_y() + bar.get_height() / 2, f"{bar.get_width():.0f}%",
                va="center", ha="left", color=INK, fontsize=9)
ax.set_yticks(y, cats, color=INK, fontsize=9.5)
ax.set_xlim(0, 108); ax.set_xticks([0, 25, 50, 75, 100], ["0%", "25%", "50%", "75%", "100%"], fontsize=8.5)
ax.set_title("Most food pantries close before 6 PM and on Sundays", loc="left", color=INK, fontsize=11.5, fontweight="bold", pad=22)
ax.text(0, 1.06, "Share of open Food Help NYC sites with listed hours", transform=ax.transAxes, color=INK2, fontsize=8.5)
ax.legend(loc="lower center", bbox_to_anchor=(0.45, -0.38), ncol=2, frameon=False, fontsize=8.5, labelcolor=INK2)
fig.text(0.01, 0.01, "Source: NYC Food Help finder (City EFAP/Food Help layer), retrieved 2026-10-10. Pantry and soup kitchen hours only.",
         color=MUTED, fontsize=7)
fig.tight_layout(rect=(0, 0.04, 1, 1))
fig.savefig(OUT / "insight_pantry_hours.png", facecolor=SURFACE)

# ---------------------------------------------------------------- insight 2
bor = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]
ro = collections.Counter(); pb = collections.Counter()
for r in places:
    d = doj_det.get(r["id"])
    if d and d["nyc_scope"] == "nyc":
        (ro if r["org_type"] == "doj_roster" else pb)[r["borough"]] += 1
fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
fig.patch.set_facecolor(SURFACE); style(ax)
yy = list(range(len(bor)))[::-1]
r_vals = [ro[b] for b in bor]; p_vals = [pb[b] for b in bor]
ax.barh(yy, r_vals, height=0.56, color=BLUE, label="Recognized-organization office (DOJ roster)")
ax.barh(yy, p_vals, left=[v + 0.35 for v in r_vals], height=0.56, color=ORANGE, label="Pro bono list office (free legal services)")
for yv, rv, pv in zip(yy, r_vals, p_vals):
    ax.text(rv + pv + 1.2, yv, f"{rv + pv}" + (f"  ({pv} pro bono)" if pv else ""), va="center", color=INK, fontsize=9)
ax.set_yticks(yy, bor, color=INK, fontsize=9.5)
ax.set_xlim(0, max(a + b for a, b in zip(r_vals, p_vals)) * 1.3)
ax.set_title("DOJ-listed immigration legal offices by borough", loc="left", color=INK, fontsize=11.5, fontweight="bold", pad=22)
ax.text(0, 1.06, f"Offices with a confirmed NYC borough, n={sum(r_vals) + sum(p_vals)}", transform=ax.transAxes, color=INK2, fontsize=8.5)
ax.legend(loc="lower center", bbox_to_anchor=(0.45, -0.38), ncol=2, frameon=False, fontsize=8.5, labelcolor=INK2)
fig.text(0.01, 0.01, "Source: DOJ EOIR R&A roster by state and city (10/04/26) and pro bono list (Oct 2026), NYC court lists.",
         color=MUTED, fontsize=7)
fig.tight_layout(rect=(0, 0.04, 1, 1))
fig.savefig(OUT / "insight_legal_offices_by_borough.png", facecolor=SURFACE)

# ---------------------------------------------------------------- markdown
q_ro, q_pb = ro["Queens"], pb["Queens"]
md = f"""# Insights (data as of 2026-10-10)

## 1. Food pantries mostly close before 6 PM and on Sundays

In Corona, Elmhurst and Jackson Heights (ZIPs 11368, 11373, 11372), **{demo[2]} of {demo[1]} food pantry and soup kitchen sites ({pct(demo[2], demo[1])}%) list no weekday hours after 6 PM, and {demo[3]} of {demo[1]} ({pct(demo[3], demo[1])}%) list no Sunday hours.** Across the rest of NYC the shares are {pct(rest[2], rest[1])}% ({rest[2]} of {rest[1]}) and {pct(rest[3], rest[1])}% ({rest[3]} of {rest[1]}).

- **Denominator:** open Food Help NYC sites whose City listing includes structured hours. Sites with no listed hours are excluded ({demo[0] - demo[1]} in the demo zips, {rest[0] - rest[1]} elsewhere).
- **Source:** NYC Food Help finder's public data layer (Food_Help_Programs_PROD_view), retrieved 2026-10-10. `out/places.csv` rows `place-fh-*`.
- **Caveat:** these are listed hours, not visits. The small demo-zip count ({demo[1]}) makes its percentages sensitive to one site. Some sites run only certain weeks of the month, and 5 demo-area listings conflict with the City's own free-text schedule; they are flagged for manual review. Other food sources (WIC, SNAP retailers) are not counted.

![Pantry hours](insight_pantry_hours.png)

## 2. DOJ-listed immigration legal offices are concentrated in Manhattan; Queens has {q_ro + q_pb}

**NYC has {sum(r_vals) + sum(p_vals)} DOJ-listed immigration legal offices with a confirmed borough: {', '.join(f'{b} {ro[b] + pb[b]}' for b in bor)}. Only {sum(p_vals)} are offices on the DOJ pro bono list for the NYC immigration courts ({', '.join(f'{b} {pb[b]}' for b in bor if pb[b])}).**

- **Denominator:** offices (not organizations) whose stated city and ZIP agree on a borough, with the geocoder's county agreeing wherever an address could be geocoded (102 of 108). Offices with conflicting location data (3), out-of-NYC pro bono offices, and individual accredited representatives are excluded.
- **Source:** DOJ EOIR Recognized Organizations and Accredited Representatives Roster by State and City (updated 10/04/26) and List of Pro Bono Legal Service Providers (October 2026). `out/places.csv` rows `place-doj-ro-*` and `place-doj-pb-*`.
- **Caveat:** "listed" is not "available". The roster does not say services are free, and neither list shows capacity, languages or wait times. Counts are not adjusted for population. Private immigration attorneys and organizations not on these DOJ lists are not counted.

![Legal offices by borough](insight_legal_offices_by_borough.png)
"""
(OUT / "insights.md").write_text(md, encoding="utf-8")
print(md)
