// explore: walk the knowledge graph (shared/graph.ts) from one place or program.
//
//   { place_id: "place-doj-ro-bronxworks" }          -> organization, its other locations, programs,
//                                                      DOJ accredited representatives (a count, never names)
//   { program: "WIC", near: "Corona" }                -> documents it asks for and where to get each one,
//                                                      what to do first, what it opens up, places nearby
//
// Every connection says where it comes from: "official" (a curated Link from an
// official source), "record" (a field on the record) or "inferred" (one of the
// graph's written rules, with its reason). Read-only; logs one RequestLog row.

import { HttpError } from "../http.ts";
import type { Need, Place, Program } from "../schema.ts";
import { resolveNear } from "../geo.ts";
import type { NearResult } from "../geo.ts";
import { disclaimer, langOf, needLabel } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import { docLabel, isSensitiveDoc } from "../graph.ts";
import type { KEdge } from "../graph.ts";
import { bestMatch } from "../text.ts";
import { loadCatalog, programOut, rankPlaces, sourceOf } from "../rank.ts";
import type { Catalog } from "../rank.ts";
import { getLanguage, getString } from "./input.ts";
import type { Tool } from "./types.ts";

const MAX_LIST = 3;

const SOURCE_LABEL: Record<string, Record<KEdge["source"], string>> = {
  es: { link: "fuente oficial", data: "del registro", inferred: "deducido" },
  en: { link: "official source", data: "from the record", inferred: "inferred" },
};

const TEXT: Record<string, Record<string, string>> = {
  es: {
    reps: "La lista del DOJ registra {n} representantes acreditados en esta organización.",
    get_it: "Dónde conseguirlo",
    none_known: "No tenemos un lugar para conseguirlo; pregunte en el programa.",
    nationals: "Un consulado solo atiende a ciudadanos de su país.",
  },
  en: {
    reps: "The DOJ roster lists {n} accredited representatives at this organization.",
    get_it: "Where to get it",
    none_known: "We don't have a place for this; ask the program.",
    nationals: "A consulate only serves its own country's citizens.",
  },
};

type Lang = "es" | "en";

function brief(p: Place, lang: Lang, near?: NearResult) {
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    address: p.address ?? "",
    phone: p.phone ?? "",
    hours: p.hours ?? "",
    ...sourceOf(p, lang),
    last_checked: p.last_checked ?? "",
  };
  if (near?.lat !== undefined && typeof p.lat === "number" && typeof p.lng === "number") {
    const dLat = (p.lat - near.lat) * 111, dLng = (p.lng - near.lng!) * 84;
    out.distance_km = Math.round(Math.hypot(dLat, dLng) * 10) / 10;
  }
  return out;
}

/** Places sorted nearest-first to `near` (or to the reference place). */
function nearest(places: Place[], from: { lat?: number; lng?: number } | undefined): Place[] {
  if (from?.lat === undefined || from.lng === undefined) return places;
  const d = (p: Place) => typeof p.lat === "number" && typeof p.lng === "number"
    ? Math.hypot(p.lat - from.lat!, (p.lng - from.lng!) * 0.76)
    : 99;
  return [...places].sort((a, b) => d(a) - d(b));
}

/** Documents a program asks for, each with where to get it. Nothing about immigration status. */
function documents(cat: Catalog, prog: Program, lang: Lang, from: { lat?: number; lng?: number } | undefined, near?: NearResult) {
  return cat.graph.docsFor(prog.id).filter((d) => !isSensitiveDoc(d)).map((d) => {
    const src = cat.graph.whereToGet(d);
    const doc: Record<string, unknown> = { id: d, label: docLabel(d, lang) };
    if (src) {
      doc.where_to_get = {
        why: src.why,
        programs: src.programs.map((p) => ({ id: p.id, name: p.name })),
        // The nearest place of each kind, in DOC_SOURCES order: an IDNYC desk before a consulate,
        // which only serves its own nationals.
        nearest_places: src.orgTypes.flatMap((type) => nearest(src.places.filter((p) => p.org_type === type), from).slice(0, 1))
          .map((p) => ({ ...brief(p, lang, near), ...(p.org_type === "consulate" ? { note: TEXT[lang].nationals } : {}) })),
        source: SOURCE_LABEL[lang].inferred,
      };
    }
    return doc;
  });
}

function programEdges(cat: Catalog, prog: Program, lang: Lang) {
  const g = cat.graph;
  const id = `program:${prog.id}`;
  const nameOf = (nodeId: string) => g.nodes.get(nodeId)?.label ?? nodeId;
  const conn = (e: KEdge, other: string) => ({
    id: other.replace(/^(program|place):/, ""),
    name: nameOf(other),
    why: e.why ?? "",
    source: SOURCE_LABEL[lang][e.source],
  });
  const before: unknown[] = [], after: unknown[] = [], pairs: unknown[] = [];
  for (const e of g.neighbors(id)) {
    const out = e.from === id;
    const other = out ? e.to : e.from;
    if (!other.startsWith("program:")) continue;
    if (e.rel === "unlocks") (out ? after : before).push(conn(e, other));
    else if (e.rel === "requires") (out ? before : after).push(conn(e, other));
    else if (e.rel === "refers_to") (out ? after : before).push(conn(e, other));
    else if (e.rel === "pairs_with") pairs.push(conn(e, other));
  }
  return { do_first: before.slice(0, 6), opens_up: after.slice(0, 6), goes_with: pairs.slice(0, 4) };
}

export const explore: Tool = {
  definition: {
    name: "explore",
    description:
      "Show how one place or program connects to everything else in our map of NYC services. For a place " +
      "(place_id from earlier results): its organization, how many other locations it has and the nearest ones, " +
      "the programs it offers, and for legal organizations how many DOJ-accredited representatives the roster " +
      "lists. For a program (name like 'WIC', 'IDNYC', 'SNAP', 'Child Health Plus', or its id): what documents it " +
      "asks for and where to get each one (e.g. a photo ID from IDNYC), what to do first, what it opens up, and " +
      "places that offer it near the person. Use it for 'what do I need to bring', 'how do I get that ID', " +
      "'does this place have other offices', 'qué papeles necesito', 'dónde saco la identificación'. Each " +
      "connection says if it comes from an official source, the record, or is inferred. Never ask about " +
      "immigration status.",
    inputSchema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "A place id from find_resources or make_plan results (place-...)." },
        program: { type: "string", description: "A program name or id, e.g. 'WIC', 'IDNYC', 'prog-snap'." },
        near: { type: "string", description: "Optional zip, neighborhood or borough, to list the nearest places." },
        language: { type: "string", description: "Language code for the answer, 'es' (default) or 'en'.", default: "es" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },

  async run(req, input, ctx) {
    const language = getLanguage(input);
    const lang: Lang = langOf(language);
    const placeId = getString(input, "place_id", { max: 120 });
    const programQ = getString(input, "program", { max: 120 });
    const nearText = getString(input, "near", { max: 200 });
    if (!placeId && !programQ) throw new HttpError(400, `Give "place_id" (from results) or "program" (a name like WIC)`);
    const near = nearText ? resolveNear(nearText) : undefined;
    const cat = await loadCatalog(req);
    const g = cat.graph;
    const response: Record<string, unknown> = { language };
    const needs = new Set<Need>();

    if (placeId) {
      const place = cat.placeById.get(placeId);
      if (!place || g.people.has(placeId)) throw new HttpError(404, `No place with id ${placeId}`);
      const orgId = g.orgOf.get(placeId)!;
      const org = g.nodes.get(orgId)!;
      const others = nearest(g.branches(orgId).filter((p) => p.id !== placeId), near ?? place);
      const offers = (g.out.get(`place:${placeId}`) ?? []).filter((e) => e.rel === "offers");
      response.place = brief(place, lang, near);
      response.organization = {
        name: org.label,
        locations: g.branches(orgId).length,
        other_locations: others.slice(0, MAX_LIST).map((p) => brief(p, lang, near)),
        ...(org.accredited_reps ? { accredited_reps: org.accredited_reps, note: TEXT[lang].reps.replace("{n}", String(org.accredited_reps)) } : {}),
      };
      response.programs = offers.map((e) => {
        const prog = cat.programById.get(e.to.slice("program:".length))!;
        return { ...programOut(prog, language), documents: documents(cat, prog, lang, place, near), source: SOURCE_LABEL[lang][e.source], why: e.why ?? "" };
      });
      for (const e of g.out.get(`place:${placeId}`) ?? []) if (e.rel === "serves") needs.add(e.to.slice(5) as Need);
      response.serves = [...needs].map((n) => needLabel(language, n));
    } else {
      const byId = cat.programById.get(programQ) ?? cat.programById.get(`prog-${programQ.toLowerCase()}`);
      const match = byId ? { item: byId } : bestMatch(programQ, cat.programs, (p) => [p.name, p.id.slice(5).replace(/-/g, " ")], 0.5);
      if (!match) throw new HttpError(404, `No program matches "${programQ}". Try a name like WIC, IDNYC, SNAP or Medicaid.`);
      const prog = match.item;
      for (const n of prog.needs ?? []) needs.add(n);
      response.program = programOut(prog, language);
      response.documents = documents(cat, prog, lang, near, near);
      Object.assign(response, programEdges(cat, prog, lang));
      // Places that offer it, nearest first when a location was given.
      const offering = (g.in.get(`program:${prog.id}`) ?? [])
        .filter((e) => e.rel === "offers" && e.from.startsWith("place:"))
        .map((e) => cat.placeById.get(e.from.slice(6)))
        .filter((p): p is Place => !!p);
      let places = offering;
      if (near?.matched) {
        const ranked = rankPlaces(cat, (prog.needs ?? [])[0] as Need, near, { language });
        const order = new Map(ranked.map((r, i) => [r.place.id, i]));
        places = [...offering].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
      }
      response.offered_at = places.slice(0, MAX_LIST).map((p) => brief(p, lang, near));
      response.offered_at_total = offering.length;
    }
    response.disclaimer = disclaimer(language);

    void logRequest(req, {
      needs: [...needs],
      zip: near?.zip ?? "",
      language,
      channel: ctx.channel,
      results_found: 1,
      unmet: false,
    });
    return response;
  },
};
