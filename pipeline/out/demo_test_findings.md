# Live app test before the demo (2026-10-10, about 2:30 PM ET, a Saturday)

Ran the three demo scenarios through the live Immigracion NYC MCP tools against the imported data.

## Works
- **Notario check** ("agencia de viajes notario", near 11368): not found, with the right warning, no fraud accusation, and 3 DOJ-listed options within 1.2 km (Make the Road Corona, La Victoria, World Immigration Center), each with the list name, check date, fee and intake "no sabemos".
- **Rosa's plan** (food, health, ID, school near 11368): IDNYC comes first and "unlocks" the next steps. Each step has its source and check date.
- **Don Luis** (money near 11368): the check cashers show real hours (Payomatic 7am-11pm, PLS 24/7) and the Western Union agents are nearby.

## Fix before the demo (app side)
1. **Summaries invent fees.** Money results say "y se cobran cargos" (and fees are charged). No source states a fee for any of these places. Suggest the summary prompt say fees are unknown unless the data has them.
2. **Unknown hours shown as "closed evenings/weekends".** Places with blank hours come back with `open_evenings: false` and `open_weekends: false`. Blank means unknown in our data; showing false tells a person it's closed. Suggest `null`.
3. **The verified pantry loses to an unchecked one.** On a Saturday, Rosa's food step picks Corona SDA (Mon 9am-11:30am, Sun soup kitchen; we couldn't reach it by phone) over Bethany Pantry (the only `verified` place: Sat 9-10am, call ahead for a prepared bag, 2 km away). Suggest ranking `verified` above `official`, or preferring places open today.

## Data notes (ours)
- La Victoria's DOJ-listed phone (347) 985-4079 did not work when Felix called. It stays because it is the official listing; the app shows it as the first legal option with Spanish.
- Make the Road Corona was closed when called (Saturday), not confirmed closed for good.
- The nearest IDNYC enrollment center is in Jamaica (7.3 km); there is none in the Corona-area ZIPs.
