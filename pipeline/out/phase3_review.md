# Phase 3 review: neighborhood depth

`official` = the facts come from a government source; it does not certify current capacity, cost or wait. No row is `verified` until Felix's manual review is recorded in `scripts/verified_ids.txt`.

## New places by area (location from the stated ZIP)

| area | places | by org_type |
|---|---|---|
| Corona (11368) | 17 | {'pantry': 4, 'clinic': 4, 'other': 1, 'check_casher': 5, 'remittance': 3} |
| nearby: East Elmhurst | 3 | {'pantry': 3} |
| nearby: Elmhurst | 7 | {'pantry': 4, 'clinic': 2, 'check_casher': 1} |
| nearby: Jackson Heights | 6 | {'pantry': 5, 'clinic': 1} |
| rest of NYC | 523 | {'pantry': 508, 'idnyc': 2, 'benefits_office': 5, 'school': 3, 'consulate': 5} |
| **total new** | 556 | |

DOJ rows from Phase 2 kept unchanged: 399. Demo-zip DOJ offices: place-doj-ro-make-the-road-new-york-corona, place-doj-ro-world-immigration-center, place-doj-ro-la-victoria-foundation, place-doj-pb-la-victoria-foundation

## Source checks

- Hand-sourced rows: 33, every field quote found in the saved source page: True
- Food Help NYC rows: 523 open sites from the City layer; coordinates kept only when the layer's address score is 95 or higher (519 with coordinates).
- Every row has an http(s) source_url: True

## Possible duplicates (same street address, kept as separate rows)

- place-doj-ro-jacob-a-riis-neighborhood-settlement, place-fh-city-harvest-mobile-market-queensbridge-hous
- place-fh-cathedral-of-st-john-the-divine, place-fh-cathedral-community-cares
- place-fh-calvarys-mission, place-fh-evangelical-free-church-of-america-community
- place-fh-eastchester-presbyterian-church-sk, place-fh-eastchester-presbyterian-church-fp
- place-fh-coalition-for-the-homeless, place-fh-crossroads-community-services-inc
- place-fh-church-of-god-prophecy-sk, place-fh-church-of-god-prophecy-fp
- place-fh-ministerio-la-luz-de-la-esperanza-para-las-n, place-nyc-hh-elmhurst-hospital
- place-hra-benefits-access-center-queens, place-hra-queens-snap-center
- place-hra-benefits-access-center-jamaica, place-hra-jamaica-snap-center

## Rows with review flags (demo area)

- `place-fh-corona-seventh-day-adventist-church`: confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says 'pantry: MON 9-11AM / soup kitchen: SUN 12-2PM'
- `place-fh-the-salvation-army-queens-temple-corp`: confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says 'pantry: WED 10-11:30AM / soup kitchen: MON-FRI 11:30AM-1PM'
- `place-fh-make-the-road-new-york-qn`: address ZIP 11372 differs from layer ZIP 11373; using the address ZIP; confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says 'pantry: WED,THUR(APPT ONLY) 9:30AM-2:30PM'
- `place-fh-northeast-conference-community-center-sda`: confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says 'pantry: TUE(SR ONLY)/WED 11AM-1PM/4-6PM'
- `place-fh-st-mark-ame-church-the-voice-of-hagar`: confirm hours: shown hours come from the structured fields the City finder displays; the layer's free-text schedule says 'pantry: TUE (1,2,3,4) 12-2:45PM'
- `place-nyc-hh-elmhurst-hospital`: geocoder: no_match; coordinates withheld, borough from stated city and ZIP
- `place-nyc-hh-gotham-womens-health-corona`: geocoder: no_match; coordinates withheld, borough from stated city and ZIP
- `place-travel-multiservices-express`: geocoder: no_match; coordinates withheld, borough from stated city and ZIP
- `place-new-life-cdc-food-pantry`: HELD from live import. Provider page lists hours; the City's Food Help NYC layer lists this program as Inactive. Address is from the City record (provider page gives none). Confirm it is running.

## Demo requirements the sources could not confirm

- Spanish spoken at any demo-zip food pantry: no City or provider source states the language; ask during the manual review call.
- What to bring to a food pantry: only New Life CDC's page says 'ID not required' (a place fact; the contract has no place-level 'bring'), so no pantry program 'bring' text was added.
- Fees or current availability at any place: not stated by the sources; left blank.
- Full weekly hours for Western Union agent locations: the locator shows only today's closing time, so hours are blank.
- Hours at the two NYS-listed WIC sites in Corona (PHS 103-24 Roosevelt Ave, Urban Health Plan 104-01 Corona Ave): the NYS list gives address and phone only.
- Consulates of Guatemala and Honduras: Guatemala's site blocked our requests, and Honduras's page lists its UN mission, not a consulate. Not added.
- IDNYC accepted for a bank account: needs a named bank's own rule before any 'unlocks' link; none sourced yet.
- A Family Welcome Center serving Corona specifically: the source lists centers by district number; it does not say which district Corona is in.
