// Knowledge graph (shared/graph.ts), freshness and feedback helpers. Pure functions, no data writes.
//   deno test --allow-read --allow-env tests/graph_test.ts
import { buildGraph, extractDocs, isPerson, orgKey } from "../shared/graph.ts";
import { checkFirst, onePerOrg, placeCode } from "../shared/rank.ts";
import type { Catalog, Ranked } from "../shared/rank.ts";
import type { Link, Place, Program } from "../shared/schema.ts";
import { parseFeedback } from "../shared/whatsapp.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id, name: id, org: "", org_type: "other", address: "1 Main St", borough: "Queens", zip: "11368", lat: 40.75, lng: -73.86,
    hours: "", open_evenings: false, open_weekends: false, languages: [], phone: "", trust: "official",
    source_url: "https://example.org", last_checked: "2026-10-10", ...over,
  };
}

function program(id: string, over: Partial<Program> = {}): Program {
  return {
    id, name: id, needs: [], who_can_use: "", status_note: "", bring: [], how_to_apply: "", summary_es: "", summary_en: "",
    source_url: "https://example.org", last_checked: "2026-10-10", ...over,
  };
}

const places: Place[] = [
  place("place-bronxworks", { name: "BronxWorks", org: "BronxWorks", org_type: "doj_roster", zip: "10456", borough: "Bronx" }),
  place("place-bronxworks-townsend", { name: "BronxWorks (Townsend Avenue - Bronx Extension Office)", org: "BronxWorks", org_type: "doj_roster", zip: "10452", borough: "Bronx" }),
  place("place-doj-rep-doe-jane-bronxworks", { name: "Doe, Jane", org: "BronxWorks", org_type: "doj_roster", address: "" }),
  place("place-idnyc-jamaica", { name: "IDNYC Enrollment Center - Jamaica", org_type: "idnyc", zip: "11435" }),
  place("place-wic-corona", { name: "Urban Health Plan WIC (Corona Ave)", org_type: "clinic" }),
  place("place-legal-clinic", { name: "Citizenship Clinic", org_type: "clinic", needs: ["legal"] } as Partial<Place>),
];
const programs: Program[] = [
  program("prog-idnyc", { name: "IDNYC", needs: ["id"] }),
  program("prog-wic", {
    name: "WIC",
    needs: ["food", "health"],
    bring: ["Examples include: Identification (ID); Proof of where you live; Proof of income; Proof of pregnancy."],
  }),
];
const links: Link[] = [];
const g = buildGraph({ places, programs, links });

Deno.test("graph: people are counted on their organization, never nodes", () => {
  eq(isPerson(places[2]), true);
  eq(g.people.has("place-doj-rep-doe-jane-bronxworks"), true);
  eq(g.nodes.has("place:place-doj-rep-doe-jane-bronxworks"), false);
  eq(g.nodes.get("org:bronxworks")?.accredited_reps, 1);
});

Deno.test("graph: branches group under one organization", () => {
  eq(orgKey(places[1]), "bronxworks");
  eq(orgKey({ name: "AARP Foundation Tax-Aide - Hollis", org: "" }), "aarp-foundation-tax-aide");
  eq(g.branches("org:bronxworks").map((p) => p.id), ["place-bronxworks", "place-bronxworks-townsend"]);
});

Deno.test("graph: documents from bring text, and IDNYC inferred before WIC", () => {
  eq(extractDocs(programs[1].bring), ["photo_id", "proof_of_address", "proof_of_income", "proof_of_pregnancy"]);
  eq(g.inferredUnlocks.map((u) => `${u.from}>${u.to}:${u.doc}`), ["prog-idnyc>prog-wic:photo_id"]);
  eq(g.whereToGet("photo_id")?.places.map((p) => p.id), ["place-idnyc-jamaica"]);
});

Deno.test("graph: inferred offers restate the record (IDNYC desk, WIC site)", () => {
  eq(g.inferredOffers.get("place-idnyc-jamaica")?.map((o) => o.program), ["prog-idnyc"]);
  eq(g.inferredOffers.get("place-wic-corona")?.map((o) => o.program), ["prog-wic"]);
});

Deno.test("graph: a place's own needs replace its org_type default", () => {
  const serves = (id: string) => (g.out.get(`place:${id}`) ?? []).filter((e) => e.rel === "serves").map((e) => e.to);
  eq(serves("place-legal-clinic"), ["need:legal"]);
});

Deno.test("onePerOrg keeps the best location of each organization", () => {
  const cat = { graph: g } as unknown as Catalog;
  const r = (id: string) => ({ place: places.find((p) => p.id === id)! }) as Ranked;
  const out = onePerOrg(cat, [r("place-bronxworks"), r("place-bronxworks-townsend"), r("place-legal-clinic")]);
  eq(out.map((x) => x.place.id), ["place-bronxworks", "place-legal-clinic"]);
  // A place the person named stays even if its organization already appeared.
  const named = onePerOrg(cat, [r("place-bronxworks"), r("place-bronxworks-townsend")], new Set(["place-bronxworks-townsend"]));
  eq(named.length, 2);
});

Deno.test("checkFirst: reports, stale checks and seasonal hours", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  eq(checkFirst({ last_checked: "2026-10-10", hours: "Tue 9am-11am" }, 0, "en", now), undefined);
  eq(typeof checkFirst({ last_checked: "2026-10-10", hours: "" }, 1, "en", now), "string");
  eq(checkFirst({ last_checked: "2026-05-01", hours: "" }, 0, "en", now)?.startsWith("We last checked"), true);
  eq(checkFirst({ last_checked: "2026-10-10", hours: "Thursdays, February 2, 9, 16" }, 0, "en", now)?.includes("seasonal"), true);
});

Deno.test("placeCode is stable, 4 characters, no ambiguous letters", () => {
  const c = placeCode("place-bronxworks");
  eq(c, placeCode("place-bronxworks"));
  eq(/^[A-HJ-NP-Z2-9]{4}$/.test(c), true, c);
});

Deno.test("parseFeedback: SI / NO / MAL code, nothing else", () => {
  eq(parseFeedback("Sí"), { helpful: true, code: "", language: "es" });
  eq(parseFeedback("no wh9u"), { helpful: false, code: "WH9U", language: "es" });
  eq(parseFeedback("MAL WH9U"), { issue: "other", code: "WH9U", language: "es" });
  eq(parseFeedback("closed K7Q2"), { issue: "closed", code: "K7Q2", language: "en" });
  eq(parseFeedback("necesito comida en Corona"), null);
  eq(parseFeedback("no tengo comida"), null);
});
