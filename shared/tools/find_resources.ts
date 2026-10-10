// find_resources: top places for one need near a zip, neighborhood, or borough.
//
//   { need: "comida", near: "11368" }  ->  { need: "food", near: "Corona, Queens (11368)", results: [...5], unmet, disclaimer }
//
// Ranking lives in shared/rank.ts (trust, then location, then hours). One LLM
// call writes all summaries (8s cap); if it is slow or off, plain template
// summaries built from the fields are used instead. Logs one RequestLog row.

import { HttpError } from "../http.ts";
import { NEEDS } from "../schema.ts";
import type { Need } from "../schema.ts";
import { requireSpecificNear, resolveNear } from "../geo.ts";
import { similarity } from "../text.ts";
import { disclaimer, needLabel, t } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import {
  bestDojProvider,
  cleanLLMText,
  hasSampleData,
  inAreaAndLanguage,
  languageName,
  llmJson,
  loadCatalog,
  ORG_TYPE_DESCRIPTIONS_EN,
  placeOut,
  programOut,
  rankPlaces,
  SPANISH_TONE,
  templateSummary,
  verifiedProviderOut,
} from "../rank.ts";
import type { Catalog, Ranked } from "../rank.ts";
import { getBool, getLanguage, getString, parseNeed } from "./input.ts";
import type { Tool } from "./types.ts";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
/** Fewer places than this: also list catalog programs for the need (e.g. a bank account for "money"). */
const FEW_RESULTS = 3;
const MAX_RELATED = 3;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, summary: { type: "string" } },
        required: ["id", "summary"],
      },
    },
  },
  required: ["summaries"],
};

/** Facts only, so the model cannot invent anything we do not have. */
function factsFor(r: Ranked) {
  return {
    id: r.place.id,
    name: r.place.name,
    kind_of_place: ORG_TYPE_DESCRIPTIONS_EN[r.place.org_type] ?? ORG_TYPE_DESCRIPTIONS_EN.other,
    zip: r.place.zip,
    borough: r.place.borough,
    hours: r.place.hours,
    open_now: r.openNow,
    open_later_today: r.openToday,
    languages: r.place.languages,
    programs: r.programs.map((p) => ({ name: p.name, summary: p.summary_en, who_can_use: p.who_can_use })),
  };
}

/** One LLM call for all summaries; template for any the model skips. Returns id -> summary. */
export async function writeSummaries(
  req: Request,
  ranked: Ranked[],
  need: Need,
  language: string,
): Promise<{ byId: Map<string, string>; source: "ai" | "template" }> {
  const byId = new Map(ranked.map((r) => [r.place.id, templateSummary(r, language)]));
  if (!ranked.length) return { byId, source: "template" };
  const prompt = [
    `You write short, plain summaries of community services in New York City for immigrant families.`,
    `Write in ${languageName(language)} (language code "${language}"), simple everyday words, warm and direct.`,
    `For EACH place below, write ONE short sentence (max 18 words) saying how it can help with "${need}": what people can get or do there. Hours and address are shown separately: do not repeat them.`,
    `Rules: use ONLY the facts given; if no programs are listed, describe the kind of place; never mention missing information (no "no information about languages"); never say what a place does not offer; never say something is free or that fees are charged unless the facts say so (for money services say to ask the price first); do not invent prices, eligibility or documents; never mention or ask about immigration status; no legal advice; do not repeat the place name.`,
    SPANISH_TONE,
    `Return JSON {"summaries":[{"id","summary"}]} with one entry per place id.`,
    ``,
    `Places:`,
    JSON.stringify(ranked.map(factsFor)),
  ].join("\n");
  const out = await llmJson(req, prompt, SUMMARY_SCHEMA);
  let used = 0;
  const list = Array.isArray(out?.summaries) ? out!.summaries as Array<Record<string, unknown>> : [];
  for (const item of list) {
    const id = typeof item?.id === "string" ? item.id : "";
    const text = cleanLLMText(item?.summary, 400);
    if (byId.has(id) && text) {
      byId.set(id, text);
      used++;
    }
  }
  return { byId, source: used ? "ai" : "template" };
}

/**
 * Programs for this need that none of the returned places offers, with what
 * unlocks them (Links: unlocks / requires / refers_to). Don Luis asks about
 * money: besides the remittance shop he hears that IDNYC opens a bank account.
 */
function relatedPrograms(cat: Catalog, need: Need, top: Ranked[], language: string) {
  const shown = new Set(top.flatMap((r) => r.programs.map((p) => p.id)));
  const nameOf = (id: string) => cat.programById.get(id)?.name ?? cat.placeById.get(id)?.name ?? id;
  return cat.programs
    .filter((p) => (Array.isArray(p.needs) ? p.needs : []).includes(need) && !shown.has(p.id))
    .slice(0, MAX_RELATED)
    .map((p) => {
      const steps = cat.links
        .filter((l) => (l.type === "unlocks" || l.type === "refers_to") && l.to_id === p.id ||
          l.type === "requires" && l.from_id === p.id)
        .map((l) => {
          const other = l.type === "requires" ? l.to_id : l.from_id;
          return { id: other, name: nameOf(other), type: l.type, reason: l.reason };
        });
      return { ...programOut(p, language), ...(steps.length ? { first_get: steps } : {}) };
    });
}

export const findResources: Tool = {
  definition: {
    name: "find_resources",
    description:
      "Find free services near a zip code, neighborhood, or borough in New York City, for one kind of help. " +
      "Use when someone asks where to get help: food (comida, pantry, despensa, groceries, WIC), legal help " +
      "(lawyer, abogado, papers, papeles, immigration, inmigracion, notario, consultant), health (clinic, clinica, " +
      "doctor, salud, Child Health Plus), benefits (beneficios), money (dinero, bank, banco, remesas, send money " +
      "home), school (escuela, enroll), ID (IDNYC, identificacion, ID card), housing (rent, renta, vivienda, " +
      "shelter), work (trabajo), transit (transporte, MetroCard). Example: 'where can I get food in Corona' / " +
      "'donde hay una despensa cerca de 11368'. Returns up to 5 places, best first (official and verified first, " +
      "then closest), each with hours, open now, languages, what to bring, trust level, source link and " +
      "last-checked date, and a 1-2 sentence summary in the person's language. Show the source and last-checked " +
      "date. When few places match, related_programs lists programs for that need and what to get first " +
      "(for example IDNYC before a bank account). Legal answers include a DOJ-listed option (free_legal_provider field): end with it, naming its list and check date; cost and intake are unknown. " +
      "Never ask about immigration status. For several needs at once, use make_plan instead.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string", enum: [...NEEDS], description: "The kind of help needed." },
        near: {
          type: "string",
          description: "Zip code, neighborhood, or borough, e.g. '11368', 'Bushwick', 'Washington Heights', 'El Bronx', 'Staten Island'. Any NYC borough works. If the person has not said where they are, ask for their zip code or neighborhood first; never guess.",
        },
        language: {
          type: "string",
          description: "Language code for the answer, e.g. 'es' (default) or 'en'. Use the language the person writes in.",
          default: "es",
        },
        open_now: {
          type: "boolean",
          description: "Put places open right now first, then ones with evening and weekend hours.",
          default: false,
        },
        name: {
          type: "string",
          description: "Optional: the name of a specific place the person asks about, e.g. 'Iglesia San Pablo'. " +
            "Matching places come first, including new community places a person approved.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          default: DEFAULT_LIMIT,
          description: "How many places to return (default 5, max 10).",
        },
      },
      required: ["need", "near"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },

  async run(req, input, ctx) {
    const rawNeed = getString(input, "need", { required: true, max: 60 });
    const need = parseNeed(rawNeed);
    if (!need) throw new HttpError(400, `"need" must be one of: ${NEEDS.join(", ")}`);
    const nearText = getString(input, "near", { required: true, max: 200 });
    const language = getLanguage(input);
    const openNow = getBool(input, "open_now", false);
    const n = Number(input.limit);
    const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

    const wanted = getString(input, "name", { max: 200 });

    const near = resolveNear(nearText);
    requireSpecificNear(near);
    const cat = await loadCatalog(req);
    // Among equally near places, ones whose own type serves the need first (pantry before a WIC clinic for food).
    let ranked = rankPlaces(cat, need, near, { language, openNow, preferPrimary: "within_area" });
    // A named place ("¿está la despensa de la Iglesia San Pablo?") goes first when it matches; the rest keep their order.
    if (wanted) {
      const named = ranked.filter((r) => Math.max(similarity(wanted, r.place.name), similarity(wanted, r.place.org ?? "")) >= 0.6);
      ranked = [...named, ...ranked.filter((r) => !named.includes(r))];
    }
    let top = ranked.slice(0, limit);

    // Legal: make sure a DOJ-listed provider (official/verified first) is in the list when one exists.
    let provider: Ranked | undefined;
    if (need === "legal") {
      provider = bestDojProvider(cat, near, language);
      const inBorough = provider && (!near.borough || provider.near <= 2);
      if (provider && inBorough && !top.some((r) => r.place.id === provider!.place.id)) {
        top = [...top.slice(0, Math.max(0, limit - 1)), provider];
      }
    }

    const { byId, source } = await writeSummaries(req, top, need, language);
    const results = top.map((r) => placeOut(r, language, byId.get(r.place.id) ?? ""));

    // unmet: nothing in the result list is BOTH in the asked area (the zip or
    // neighborhood zips; the whole borough if only a borough was given) AND
    // lists the requested language. See rank.inAreaAndLanguage.
    const unmet = !top.some((r) => inAreaAndLanguage(r, near));

    let message: string | undefined;
    const label = needLabel(language, need);
    if (!ranked.length) message = t(language, "no_results_anywhere", { need: label });
    else if (!near.matched) message = t(language, "unknown_location", { near: nearText });
    else if ((near.zip || near.borough) && !top.some((r) => r.near <= 2)) {
      message = t(language, "no_results", { need: label, near: near.label });
    }

    const response: Record<string, unknown> = {
      need,
      near: near.label,
      language,
      open_now: openNow,
      results,
      unmet,
    };
    if (message) response.message = message;
    if (need === "legal" && provider) response.free_legal_provider = verifiedProviderOut(provider, language);
    const related = results.length < FEW_RESULTS ? relatedPrograms(cat, need, top, language) : [];
    if (related.length) response.related_programs = related;
    if (hasSampleData(results)) response.note = t(language, "sample_data_note");
    response.summaries_by = source;
    response.disclaimer = disclaimer(language);

    void logRequest(req, {
      needs: [need],
      zip: near.zip ?? "",
      language,
      channel: ctx.channel,
      results_found: results.length,
      unmet,
    });
    return response;
  },
};
