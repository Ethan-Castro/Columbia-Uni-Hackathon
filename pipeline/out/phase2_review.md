# Phase 2 review: DOJ places

Generated from out/places.csv (399 rows). Checks: PASS.

`trust=official` means the listing came from an official DOJ source. It does not mean DOJ endorses the provider, that the provider has openings, or that every service is free. Someone missing from these lists is not evidence of fraud.

## Rows by list

| kind | rows |
|---|---|
| recognized_org_office | 101 |
| pro_bono_listing | 14 |
| accredited_rep | 284 |

## NYC offices by borough (stated city and ZIP agree; where coordinates exist the geocoder county agrees too)

| borough | recognized-org offices | pro bono offices |
|---|---|---|
| Bronx | 13 | 0 |
| Brooklyn | 27 | 3 |
| Manhattan | 41 | 5 |
| Queens | 15 | 2 |
| Staten Island | 2 | 0 |
| **total** | 98 | 10 |

## Pro bono listings by court

| court | listings (offices) |
|---|---|
| New York Immigration Courts | 11 |
| New York Immigration Courts Juvenile Docket | 6 |

## Uncertain NYC records (kept, borough and coordinates left blank, needs manual review)

- `place-doj-ro-jacob-a-riis-neighborhood-settlement`: 10-25 41st Ave, New York, NY 11101. stated city 'New York' (Manhattan) disagrees with ZIP 11101 (Queens)
- `place-doj-ro-urban-justice-center`: 40 Rector Street, 9th Floor, New York, NY 11206. stated city 'New York' (Manhattan) disagrees with ZIP 11206 (Brooklyn)
- `place-doj-pb-safe-horizon`: 2 Lafayette Street, 3rd Floor, Brooklyn, NY 10007. stated city 'Brooklyn' (Brooklyn) disagrees with ZIP 10007 (Manhattan)

## Kept rows that are not counted as NYC places (outside NYC, no address, or mailing-only)

- `place-doj-ro-south-bronx-united-inc-2`: PO Box 1267, Bronx, NY 10451. PO Box mailing address, not a walk-in office
- `place-doj-pb-aba-commission-on-immigration-detention-informat`: 1050 Connecticut Avenue, NW, Unit 400, Washington, DC 20036. office outside NYC; listed for a NYC immigration court, not counted as a NYC place
- `place-doj-pb-sisters-of-st-joseph-long-island-immigration-cli`: 164 3rd Avenue, Brentwood, NY 11717. office outside NYC; listed for a NYC immigration court, not counted as a NYC place
- `place-doj-pb-immigrant-children-advocates-relief-effort-icare`: (no address in listing). no street address in the listing

## Excluded roster offices outside the five boroughs: 69

Long Island ZIPs (11xxx) among them, listed because a ZIP-prefix rule could wrongly count them as Queens:

- Catholic Charities of Long Island (Principal Office), Amityville, NY 11701
- Central American Refugee Center (CARECEN) NY (Brentwood Extension Office), Brentwood, NY 11717
- Make the Road New York (Brentwood Extension Office), Brentwood, NY 11717
- Sisters of St. Joseph - Long Island Immigration Clinic (Principal Office), Brentwood, NY 11717
- Central American Refugee Center (CARECEN) NY (Principal Office), Hempstead, NY 11550
- Immigrant Justice Corps (IJC/CARECEN Extension Office), Hempstead, NY 11550
- The New York Immigration Coalition (NYIC - Hempstead, Long Island Extension Office), Hempstead, NY 11550

## Geocoding coverage (offices only; reps are never geocoded)

- offices with coordinates: 103 of 115
- verified NYC offices with coordinates: 102 of 108
- geocoder status: {'matched': 105, 'not_geocoded_po_box': 1, 'no_match': 1, 'matched_other_zip': 6, 'not_geocoded_out_of_state': 1, 'n/a': 1}
- NYC office without coordinates: `place-doj-ro-safe-horizon-jamaica` (geocoder: no_match; coordinates withheld, borough from stated city and ZIP)
- NYC office without coordinates: `place-doj-ro-church-world-service-new-york` (geocoder matched a different ZIP (475 RIVERSIDE DR, CLAYTON, NY, 13624; 475 RIVERSIDE DR, FALLSBURG, NY, 12733; 475 RIVERSIDE DR, JOHNSON CITY, NY, 13790); coordinates withheld, borough from stated city and ZIP)
- NYC office without coordinates: `place-doj-ro-her-justice` (geocoder matched a different ZIP (100 E BROADWAY, NEW YORK, NY, 10002; 100 W BROADWAY, NEW YORK, NY, 10013); coordinates withheld, borough from stated city and ZIP)
- NYC office without coordinates: `place-doj-ro-immigration-law-and-justice-new-york` (geocoder matched a different ZIP (475 RIVERSIDE DR, CLAYTON, NY, 13624; 475 RIVERSIDE DR, FALLSBURG, NY, 12733; 475 RIVERSIDE DR, JOHNSON CITY, NY, 13790); coordinates withheld, borough from stated city and ZIP)
- NYC office without coordinates: `place-doj-ro-international-rescue-committee-inc` (geocoder matched a different ZIP (122 E 42ND ST, NEW YORK, NY, 10017); coordinates withheld, borough from stated city and ZIP)
- NYC office without coordinates: `place-doj-ro-the-new-york-legal-assistance-group` (geocoder matched a different ZIP (100 PEARL ST, NEW YORK, NY, 10005); coordinates withheld, borough from stated city and ZIP)

## Same address on both lists (kept as separate listings)

- `place-doj-ro-brooklyn-defender-services` / `place-doj-ro-brooklyn-defender-services-livingston-street-5th-fl`: 177 Livingston Street, 7th Floor, Brooklyn, NY 11201
- `place-doj-ro-catholic-migration-services` / `place-doj-pb-catholic-migration-services-brooklyn`: 191 Joralemon Street, 4th Floor, Brooklyn, NY 11201
- `place-doj-ro-central-american-legal-assistance` / `place-doj-pb-central-american-legal-assistance-cala`: 240 Hooper Street, Brooklyn, NY 11211
- `place-doj-ro-la-victoria-foundation` / `place-doj-pb-la-victoria-foundation`: 3753 90th Street, Suite 13B, Jackson Heights, NY 11372
- `place-doj-ro-church-world-service-new-york` / `place-doj-ro-immigration-law-and-justice-new-york`: 475 Riverside Drive, Suite 700, New York, NY 10115
- `place-doj-ro-cuny-citizenship-now` / `place-doj-ro-northern-manhattan-coalition-for-immigra`: 5030 Broadway, Room H201, New York, NY 10034
- `place-doj-ro-hebrew-immigrant-aid-society-hias-new-york` / `place-doj-pb-hias-new-york`: 1359 Broadway, Suite 810, New York, NY 10018
- `place-doj-ro-legal-services-nyc` / `place-doj-ro-the-center-for-family-representation`: 40 Worth Street, Suite 606, New York, NY 10013
- `place-doj-ro-the-door-a-center-of-alternatives` / `place-doj-pb-the-door`: 121 Avenue of the Americas, Suite 308, New York, NY 10013
- `place-doj-ro-the-legal-aid-society` / `place-doj-pb-the-legal-aid-society`: 49 Thomas Street, 5th Floor, New York, NY 10013

## Parser reconciliation

- Alphabetical roster: 951 organizations parsed vs 951 stated on page 1; 2638 representatives (matches an independent count: dates in the table minus two per organization row).
- State/city roster, NEW YORK section: 170 office records (one per City, NY ZIP line in the text).
- NYC organizations not found in the alphabetical roster: none. A name not found by the parser is not proof that the organization or person is not accredited.

## Demo zips (11368, 11373, 11372): DOJ rows to verify by hand

- `place-doj-ro-make-the-road-new-york-corona`: Make the Road New York (Corona Extension Office), 104-19 Roosevelt Avenue, Corona, NY 11368, (718) 565-8500
- `place-doj-ro-world-immigration-center`: World Immigration Center, 40-06 Case Street, 2nd Floor, Elmhurst, NY 11373, (718) 429-6345
- `place-doj-ro-la-victoria-foundation`: La Victoria Foundation, 3753 90th Street, Suite 13B, Jackson Heights, NY 11372, (347) 985-4079
- `place-doj-pb-la-victoria-foundation`: La Victoria Foundation, 3753 90th Street, Suite 13B, Jackson Heights, NY 11372, (347) 985-4079
