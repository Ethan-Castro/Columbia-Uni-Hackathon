// Unit tests for the shared helpers. Run: deno task test
// (Not copied to Base44; no deps.)
import { isOpenAt, isOpenLaterToday, nyClock, opensEvenings, opensWeekends, parseHours } from "../shared/hours.ts";
import { nearRank, normalizeBorough, resolveNear, zipToBorough } from "../shared/geo.ts";
import { bestMatch, normalize, similarity } from "../shared/text.ts";
import { langOf, t } from "../shared/i18n.ts";
import { timingSafeEqual } from "../shared/auth.ts";
import { getLanguage, getNeeds } from "../shared/tools/input.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(`assertion failed ${msg}`);
}

// Saturday 2026-10-10 in New York (EDT, UTC-4).
const SAT_1030 = new Date("2026-10-10T14:30:00Z");
const SAT_1300 = new Date("2026-10-10T17:00:00Z");
const TUE_1700 = new Date("2026-10-13T21:00:00Z");
const WED_1800 = new Date("2026-10-14T22:00:00Z");
const SUN_0300 = new Date("2026-10-11T07:00:00Z");

Deno.test("nyClock uses New York time", () => {
  eq(nyClock(SAT_1030), { day: 6, minutes: 630, date: "2026-10-10" });
  eq(nyClock(new Date("2026-10-11T03:30:00Z")), { day: 6, minutes: 1410, date: "2026-10-10" }, "Sat 23:30 local, Sun in UTC");
  eq(nyClock(new Date("2026-01-10T15:00:00Z")).minutes, 600, "EST in winter");
});

Deno.test("parseHours basic formats", () => {
  const p = parseHours("Mon-Fri 09:00-17:00; Sat 10:00-14:00");
  eq(p.intervals.length, 6);
  eq(p.intervals.find((i) => i.day === 6), { day: 6, start: 600, end: 840 });
  eq(parseHours("Lun-Vie 9am-5pm").intervals.map((i) => i.day), [1, 2, 3, 4, 5]);
  eq(parseHours("Tue, Thu 17:00-20:00").intervals, [{ day: 2, start: 1020, end: 1200 }, { day: 4, start: 1020, end: 1200 }]);
  eq(parseHours("24/7").always, true);
  const appt = parseHours("By appointment");
  eq([appt.unknown, appt.byAppointment], [true, true]);
  eq(parseHours("").unknown, true);
  eq(parseHours("Every day 9am-9pm").intervals.length, 7);
  eq(parseHours("Wed and Fri 5pm-8pm").intervals.map((i) => [i.day, i.start, i.end]), [[3, 1020, 1200], [5, 1020, 1200]]);
  eq(parseHours("Lunes a viernes 9 a.m. a 5 p.m.").intervals.length, 5);
  eq(parseHours("Mon-Fri 9-5").intervals[0], { day: 1, start: 540, end: 1020 });
  eq(parseHours("Sat 10-2pm").intervals[0], { day: 6, start: 600, end: 840 });
  eq(parseHours("Fri 10pm-2am").intervals, [{ day: 5, start: 1320, end: 1440 }, { day: 6, start: 0, end: 120 }]);
  eq(parseHours("Mon-Sun 8am-6pm; Sun closed").intervals.some((i) => i.day === 0), false);
  eq(parseHours("Mon-Fri 8:30am-5pm").intervals[0].start, 510);
});

Deno.test("parseHours sample data quirks", () => {
  // parenthetical ignored, appointment noted
  const a = parseHours("Mon-Fri 9am-5pm (call for an appointment)");
  eq([a.intervals.length, a.byAppointment], [5, true]);
  // "until 6pm" extends existing days
  const b = parseHours("Mon-Fri 8am-3pm; Tue and Thu until 6pm");
  eq(b.intervals.filter((i) => i.end === 1080).map((i) => i.day), [2, 4]);
  // irregular Saturday
  const c = parseHours("Mon-Fri 8am-2pm; first Saturday of the month 9am-1pm");
  eq(c.intervals.find((i) => i.day === 6), { day: 6, start: 540, end: 780, irregular: true });
  eq(isOpenAt(c, SAT_1030), null, "irregular -> unknown");
  eq(opensWeekends(c), true);
});

Deno.test("isOpenAt / evenings / weekends", () => {
  const h = "Tue and Thu 10am-2pm; Sat 9am-12pm";
  eq(isOpenAt(h, SAT_1030), true);
  eq(isOpenAt(h, SAT_1300), false);
  eq(isOpenAt(h, TUE_1700), false);
  eq(isOpenAt("24/7", SUN_0300), true);
  eq(isOpenAt("By appointment", SAT_1030), null);
  eq(isOpenAt("Wed and Fri 5pm-8pm", WED_1800), true);
  eq(isOpenLaterToday("Sat 2pm-5pm", SAT_1030), true);
  eq(isOpenLaterToday("Sat 9am-10am", SAT_1030), false);
  eq(opensEvenings("Mon-Fri 8:30am-5pm"), false);
  eq(opensEvenings("Mon-Thu 10am-7pm; Sat 10am-1pm walk-in screening"), true);
  eq(opensEvenings("Mon-Fri 8am-3pm; Tue and Thu until 6pm"), true);
  eq(opensWeekends("Mon-Fri 9am-5pm"), false);
  eq(opensEvenings("call us"), null);
});

Deno.test("hours derivations match sample Place booleans", async () => {
  const places = JSON.parse(await Deno.readTextFile(new URL("./fixtures/sample-data/Place.json", import.meta.url)));
  for (const p of places) {
    eq(opensEvenings(p.hours), p.open_evenings, `${p.id} evenings`);
    eq(opensWeekends(p.hours), p.open_weekends, `${p.id} weekends`);
  }
});

Deno.test("geo resolveNear", () => {
  const z = resolveNear("11368");
  eq([z.zip, z.borough, z.neighborhood, z.matched], ["11368", "Queens", "Corona", true]);
  ok(z.zips[0] === "11368" && z.zips.includes("11373") && z.zips.includes("11372"), "adjacent zips");
  eq(resolveNear("Corona, Queens").zip, "11368");
  eq(resolveNear("11368 Corona").zip, "11368");
  eq(resolveNear("  CORONA ").zip, "11368");
  eq(resolveNear("East Elmhurst").zip, "11369");
  eq(resolveNear("Elmhurst").zip, "11373");
  eq(resolveNear("jackson heights").zip, "11372");
  eq(resolveNear("El Bronx"), { input: "El Bronx", matched: true, borough: "Bronx", primaryZips: [], zips: [], label: "Bronx" });
  eq(resolveNear("Brooklin").borough, "Brooklyn");
  eq(resolveNear("Staten Island").borough, "Staten Island");
  eq(resolveNear("Washington Heights").borough, "Manhattan");
  eq(resolveNear("El Barrio").neighborhood, "East Harlem");
  eq(resolveNear("Mott Haven").borough, "Bronx");
  eq(resolveNear("Port Richmond").borough, "Staten Island");
  eq(resolveNear("Nueva York").label, "NYC");
  eq(resolveNear("Atlantis").matched, false);
  eq(resolveNear(undefined).matched, false);
  eq(resolveNear("Corona").label, "Corona, Queens (11368)");
});

Deno.test("geo helpers", () => {
  eq([zipToBorough("10001"), zipToBorough("10301"), zipToBorough("10451"), zipToBorough("11201"), zipToBorough("11368"), zipToBorough("11691"), zipToBorough("07030")],
    ["Manhattan", "Staten Island", "Bronx", "Brooklyn", "Queens", "Queens", undefined]);
  eq(normalizeBorough("the bronx"), "Bronx");
  const near = resolveNear("11368");
  eq([nearRank({ zip: "11368" }, near), nearRank({ zip: "11373" }, near), nearRank({ zip: "11432", borough: "Queens" }, near), nearRank({ zip: "11201" }, near)], [0, 1, 2, 3]);
});

Deno.test("text normalize and similarity", () => {
  eq(normalize("The Catholic Charities, Inc."), "catholic charities");
  eq(normalize("Clínica Médica"), "clinica medica");
  ok(similarity("Catholic Charities", "Catholic Charities Community Services") >= 0.7, "subset");
  ok(similarity("Catolic Charitis", "Catholic Charities") >= 0.6, "typo");
  ok(similarity("Jose Perez Notario", "Queens Immigrant Legal Clinic (sample)") < 0.35, "unrelated");
  ok(similarity("Legal Services", "Family Services") < 0.6, "generic words");
  ok(similarity("Jose Perez Notario", "Jose Martinez Law") < 0.5, "shared first name only");
  eq(similarity("", "x"), 0);
  const items = [{ name: "Queens Immigrant Legal Clinic (sample)" }, { name: "Roosevelt Avenue Pro Bono Project (sample)" }];
  eq(bestMatch("Roosevelt Pro Bono", items, (i) => [i.name])?.item.name, items[1].name);
  eq(bestMatch("Jose Perez Notario", items, (i) => [i.name]), null);
});

Deno.test("i18n", () => {
  eq(langOf("es-MX"), "es");
  eq(langOf("EN"), "en");
  eq(langOf("qu"), "es");
  ok(t("en", "disclaimer").includes("not legal advice"));
  ok(t("es", "notario_warning").includes("notarios no pueden"));
  eq(t("en", "label_step", { n: 2 }), "Step 2");
  eq(t("es", "no_results", { need: "comida", near: "Corona" }).includes("Corona"), true);
});

Deno.test("auth + input", () => {
  eq([timingSafeEqual("abc", "abc"), timingSafeEqual("abc", "abd"), timingSafeEqual("abc", "abcd")], [true, false, false]);
  eq(getNeeds({ needs: ["comida", "legal", "food", "nonsense"] }), ["food", "legal"]);
  eq(getNeeds({ needs: "food|id" }), ["food", "id"]);
  eq(getLanguage({}), "es");
  eq(getLanguage({ language: "EN" }), "en");
  eq(getLanguage({ language: "Español" }), "es");
  eq(getLanguage({ language: "es-mx" }), "es-MX");
});
