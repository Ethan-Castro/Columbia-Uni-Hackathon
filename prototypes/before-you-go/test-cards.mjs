// Opens index.html from disk, checks two cards' "What we know" panels, and saves screenshot.png.
// Run from the repo root:  node prototypes/before-you-go/test-cards.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PKG || "playwright"); // PLAYWRIGHT_PKG=$(npm root -g)/playwright when not installed locally
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = "file://" + path.join(dir, "index.html");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto(fileUrl);

const failures = [];
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures.push(msg); };

const version = await page.locator("#version").innerText();
check(version.includes("661 places from pipeline/hf_release/places.csv"), "data-version label: " + version);

// Card A: stated hours (Bethany Pantry, the one row confirmed by phone). Card B: unknown language and unknown hours (HANAC, DOJ roster, official).
await page.fill("#q", "11373");
await page.selectOption("#type", "pantry");
const a = page.locator('article[data-place-id="place-fh-bethany-pantry"]');
check(await a.count() === 1, "card A (Bethany Pantry) rendered");
await a.locator("details.know summary").click();
const aText = await a.locator("details.know").innerText();
check(/Hours.*Stated \/ Indicado: Sat 9am-10am/s.test(aText), "card A hours shown as stated");
check(/Language.*Unknown, ask when you call/s.test(aText), "card A language shown as unknown");
check(aText.includes("confirmed this by phone"), "card A trust reads confirmed by phone");
check(aText.includes("services6.arcgis.com") && aText.includes("2026-10-10"), "card A shows source host and last-checked date");
check(aText.includes("¿Están abiertos hoy") && aText.includes("Are you open today"), "card A has bilingual call questions");
check(await a.locator('a[href="https://inmigracion-nyc.com/#/submit"]').count() === 1, "card A has Report a change link");
const aShot = path.join(dir, "screenshot-card-a.png");
await a.screenshot({ path: aShot });

await page.fill("#q", "HANAC");
await page.selectOption("#type", "");
const b = page.locator('article[data-place-id="place-doj-ro-hanac-inc"]');
check(await b.count() === 1, "card B (HANAC) rendered");
await b.locator("details.know summary").click();
const bText = await b.locator("details.know").innerText();
check(/Language.*Unknown, ask when you call/s.test(bText), "card B language shown as unknown");
check(/Hours.*Unknown, ask when you call/s.test(bText), "card B hours shown as unknown");
check(/Phone.*Stated \/ Indicado: \(212\) 840-8005/s.test(bText), "card B phone shown as stated");
check(bText.includes("Listed by an official source") && bText.includes("An official listing is not a hand-verified listing"), "card B trust reads official listing, explicitly not hand-verified");
check(!bText.includes("confirmed this by phone") && !bText.includes("Confirmed by phone"), "card B never claims phone confirmation");
check(bText.includes("justice.gov"), "card B shows DOJ source host");
await b.screenshot({ path: path.join(dir, "screenshot-card-b.png") });

// Full-page screenshot with both demo cards expanded (shortlist via #ids=).
await page.goto(fileUrl + "#ids=place-fh-bethany-pantry,place-doj-ro-hanac-inc");
await page.fill("#q", ""); await page.selectOption("#type", "");
check(await page.locator("article.card").count() === 2, "shortlist hash shows exactly the two demo cards");
for (const s of await page.locator("details.know summary").all()) await s.click();
await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true });

await browser.close();
if (failures.length) { console.error(failures.length + " check(s) failed"); process.exit(1); }
console.log("all checks passed; screenshots written");
