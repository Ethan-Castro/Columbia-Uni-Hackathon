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
import { resolveNear } from "../geo.ts";
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
  rankPlaces,
  SPANISH_TONE,
  templateSummary,
  verifiedProviderOut,
} from "../rank.ts";
import type { Ranked } from "../rank.ts";
import { getBool, getLanguage, getString, parseNeed } from "./input.ts";
import type { Tool } from "./types.ts";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

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
    `You write short, plain summaries of free community services in New York City for immigrant families.`,
    `Write in ${languageName(language)} (language code "${language}"), simple everyday words, warm and direct.`,
    `For EACH place below, write 1 or 2 sentences (max 35 words) saying what it offers for "${need}", when it is open, and which languages are spoken.`,
    `Rules: use ONLY the facts given; if no programs are listed, describe the kind of place; never say what a place does not offer; do not invent prices, eligibility or documents; never mention or ask about immigration status; no legal advice; do not repeat the place name.`,
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
      "date. Never ask about immigration status. For several needs at once, use make_plan instead.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string", enum: [...NEEDS], description: "The kind of help needed." },
        near: {
          type: "string",
          description: "Zip code, neighborhood, or borough, e.g. '11368', 'Corona', 'Queens', 'El Bronx'.",
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

    const near = resolveNear(nearText);
    const cat = await loadCatalog(req);
    const ranked = rankPlaces(cat, need, near, { language, openNow });
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
    if (need === "legal" && provider) response.verified_free_provider = verifiedProviderOut(provider, language);
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
