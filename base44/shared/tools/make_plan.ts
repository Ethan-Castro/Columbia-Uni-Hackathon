// make_plan: one best place per need, ordered so the step that unlocks others comes first.
//
//   { needs: ["food","health","id"], near: "Corona" }
//   -> { steps: [{ step: 1, need: "id", place, program, why_this_order, bring }, ...], plan_text, disclaimer }
//
// Each need reuses find_resources' ranking (shared/rank.ts), preferring places
// whose own type serves the need (a pantry for food, a clinic for health).
// Steps are ordered by Links (unlocks / pairs_with / refers_to go first,
// requires goes after what it requires) plus one data rule: an ID step comes
// before any step whose "bring" list asks for an ID. One LLM call (8s cap)
// writes titles, summaries, the order reasons and, when legal is included, the
// intake summary; templates cover everything if it is slow or off.
// `situation` is used only for the intake summary: never logged, never stored.

import { NEEDS } from "../schema.ts";
import type { Need, Program } from "../schema.ts";
import { resolveNear } from "../geo.ts";
import type { NearResult } from "../geo.ts";
import { disclaimer, langOf, needLabel, t } from "../i18n.ts";
import { logRequest } from "../logRequest.ts";
import {
  bestDojProvider,
  bringOf,
  cleanLLMText,
  hasSampleData,
  inAreaAndLanguage,
  isSensitive,
  languageName,
  llmJson,
  loadCatalog,
  ORG_TYPE_DESCRIPTIONS_EN,
  placeOut,
  programOut,
  rankPlaces,
  SPANISH_TONE,
  templateSummary,
  templateTitle,
  verifiedProviderOut,
} from "../rank.ts";
import type { Catalog, PlaceOut, Ranked } from "../rank.ts";
import { statesStatus } from "../redact.ts";
import { getLanguage, getNeeds, getString } from "./input.ts";
import type { Tool } from "./types.ts";

interface Draft {
  need: Need;
  /** Order the person asked in (tie-break). */
  index: number;
  best?: Ranked;
  /** Relevant programs at the chosen place, or the best catalog program when no place serves the need. */
  programs: Program[];
  /** Place + program ids, for matching Links. */
  nodes: Set<string>;
  met: boolean;
}

interface Edge {
  from: number; // draft index that goes first
  to: number;
  reason: string; // English (data is English)
}

const ID_WORDS_RE = /\bID\b|IDNYC|identif|photo/i;

/** Steps for each need: the best place, its relevant programs. */
function draftSteps(cat: Catalog, needs: Need[], near: NearResult, language: string): Draft[] {
  return needs.map((need, index) => {
    const best = rankPlaces(cat, need, near, { language, preferPrimary: true })[0];
    let programs = best?.programs ?? [];
    // No place for this need yet: still show the program (e.g. library card) if we have one.
    if (!best) programs = cat.programs.filter((p) => (p.needs ?? []).includes(need)).slice(0, 1);
    const nodes = new Set<string>([...(best ? [best.place.id] : []), ...programs.map((p) => p.id)]);
    return { need, index, best, programs, nodes, met: best ? inAreaAndLanguage(best, near) : false };
  });
}

/** Order edges between steps from Links and the ID-before-"bring ID" rule. Same-step pairs become notes. */
function buildEdges(cat: Catalog, drafts: Draft[]): { edges: Edge[]; notes: Map<number, string[]> } {
  const edges: Edge[] = [];
  const notes = new Map<number, string[]>();
  const add = (from: number, to: number, reason: string) => {
    if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, reason });
  };
  for (const l of cat.links) {
    if (l.type === "offers") continue;
    for (const a of drafts) {
      for (const b of drafts) {
        if (l.type === "requires") {
          // b requires a -> a first
          if (b.nodes.has(l.from_id) && a.nodes.has(l.to_id)) add(a.index, b.index, l.reason);
          continue;
        }
        if (!a.nodes.has(l.from_id)) continue;
        if (a === b) {
          if (l.type === "pairs_with" && a.nodes.has(l.to_id)) notes.set(a.index, [...(notes.get(a.index) ?? []), l.reason]);
          continue;
        }
        if (b.nodes.has(l.to_id)) add(a.index, b.index, l.reason);
        else if (l.type === "unlocks") {
          // IDNYC unlocks "bank account": counts for a money step even if that program was not chosen.
          const target = cat.programById.get(l.to_id);
          if (target && (target.needs ?? []).includes(b.need)) add(a.index, b.index, l.reason);
        }
      }
    }
  }
  for (const a of drafts) {
    if (a.need !== "id" || !a.best) continue;
    for (const b of drafts) {
      if (b === a) continue;
      for (const prog of b.programs) {
        const item = (prog.bring ?? []).find((x) => ID_WORDS_RE.test(x));
        if (item) {
          add(a.index, b.index, `${prog.name} asks for "${item}". Getting your ID first makes this step easier.`);
          break;
        }
      }
    }
  }
  return { edges, notes };
}

/** Topological sort, stable: among ready steps, ones that unlock others first, then the order asked. */
function orderSteps(drafts: Draft[], edges: Edge[]): Draft[] {
  const remaining = new Set(drafts.map((d) => d.index));
  const out: Draft[] = [];
  const unlocks = (i: number) => edges.some((e) => e.from === i && remaining.has(e.to));
  while (remaining.size) {
    const ready = [...remaining].filter((i) => !edges.some((e) => e.to === i && remaining.has(e.from)));
    // A cycle (bad data): fall back to the order asked.
    const pool = ready.length ? ready : [...remaining];
    pool.sort((x, y) => Number(unlocks(y)) - Number(unlocks(x)) || x - y);
    const next = pool[0];
    remaining.delete(next);
    out.push(drafts[next]);
  }
  return out;
}

// Statements about a person's status are dropped before the text reaches the
// LLM or the template intake (the lawyer asks in private). One vocabulary for
// the whole app: shared/redact.ts statesStatus. It deliberately lets "someone
// says he can fix my papers for $3,000" through: that is exactly what the
// lawyer needs to hear.
function withoutStatusStatements(text: string): string {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim() && !statesStatus(s)).join(" ").trim();
}

/** LLM intake text, unless it is missing, too long, or states a status. */
function safeIntake(v: unknown): string | null {
  const text = cleanLLMText(v, 1500, true);
  return text && !statesStatus(text) ? text : null;
}

function templateIntake(needs: Need[], near: NearResult, words: string) {
  const others = needs.filter((n) => n !== "legal");
  const lawyer = [
    "Intake summary, prepared only from what the person shared. Not verified. No legal advice was given.",
    "- Looking for: a free immigration legal consultation.",
    `- Area: ${near.label || "not given"}.`,
    others.length ? `- Other needs mentioned: ${others.join(", ")}.` : "",
    words ? `- In their own words: "${words}"` : "",
    "- Immigration status was not asked.",
  ].filter(Boolean).join("\n");
  const person = [
    "Resumen para su cita legal, solo con lo que usted nos contó:",
    "- Busca: una consulta con un abogado con licencia o un representante acreditado por el DOJ.",
    `- Zona: ${near.label || "no indicada"}.`,
    others.length ? `- Otras necesidades: ${others.map((n) => needLabel("es", n)).join(", ")}.` : "",
    words ? `- Lo que usted contó: "${words}"` : "",
    "Lleve los documentos que tenga y sus preguntas. No firme ni pague nada antes de hablar con un abogado con licencia o un representante acreditado por el DOJ.",
  ].filter(Boolean).join("\n");
  return { for_lawyer_en: lawyer, for_person_es: person };
}

/** WhatsApp-ready text: places, hours, what to bring. Fixed templates only; nothing about status or cases. */
function planText(steps: Array<{ need: Need; place: PlaceOut | null; bring: string[] }>, near: NearResult, language: string): string {
  const en = langOf(language) === "en";
  const lines = [en ? `Your plan near ${near.label}:` : `Su plan cerca de ${near.label}:`];
  steps.forEach((s, i) => {
    lines.push("", `${i + 1}. ${templateTitle(s.need, s.place?.name, language)}`);
    if (!s.place) {
      lines.push(en ? "   No place found yet. Call 311." : "   Todavía no hay un lugar. Llame al 311.");
      return;
    }
    if (s.place.address) lines.push(`   ${t(language, "label_address")}: ${s.place.address}`);
    if (s.place.hours) lines.push(`   ${t(language, "label_hours")}: ${s.place.hours}`);
    if (s.place.phone) lines.push(`   ${t(language, "label_phone")}: ${s.place.phone}`);
    const bring = s.bring.filter((b) => !isSensitive(b));
    if (bring.length) lines.push(`   ${t(language, "label_bring")}: ${bring.join("; ")}`);
    if (s.place.last_checked) lines.push(`   ${t(language, "label_last_checked")}: ${s.place.last_checked}`);
  });
  return lines.join("\n");
}

/** The LLM's translation of a bring list, only if it kept every item (same count, short strings). */
function translatedBring(v: unknown, original: string[], language: string): string[] {
  if (langOf(language) === "en") return original;
  if (!Array.isArray(v) || v.length !== original.length) return original;
  const out = v.map((x) => cleanLLMText(x, 200));
  return out.every((x): x is string => x !== null) ? out : original;
}

/** Trimmed place for a plan step. */
function stepPlace(p: PlaceOut) {
  const { org: _o, org_type: _t, programs: _p, bring: _b, open_evenings: _e, open_weekends: _w, summary: _s, ...rest } = p;
  return rest;
}

export const makePlan: Tool = {
  definition: {
    name: "make_plan",
    description:
      "Make a step-by-step plan when someone has several needs at once, or says 'I just arrived' / 'acabo de " +
      "llegar', 'what do I do first', 'que hago primero', 'plan', 'pasos'. For example a new arrival with kids who " +
      "needs food (comida, despensa, pantry, WIC), health care (clinic, clinica, Child Health Plus), ID (IDNYC, " +
      "identificacion), school (escuela), money (dinero, banco, remesas), rent (renta, vivienda), or legal help " +
      "(lawyer, abogado, papers, papeles, notario). Picks the best nearby place for each need and orders the steps " +
      "so the one that unlocks the others comes first (for example IDNYC before a bank account or WIC). Each step " +
      "has the place, hours, what to bring, source and last-checked date. If legal is included, adds a short " +
      "intake summary to bring to a free lawyer, built only from what the person said (pass it as 'situation'; it " +
      "is never stored). Returns plan_text ready to send with send_to_phone (ask permission first). Information " +
      "and referrals only, not legal advice. Never ask about immigration status. For one need, use find_resources.",
    inputSchema: {
      type: "object",
      properties: {
        needs: {
          type: "array",
          items: { type: "string", enum: [...NEEDS] },
          minItems: 1,
          maxItems: NEEDS.length,
          description: "All the kinds of help needed, in the order the person mentioned them.",
        },
        near: {
          type: "string",
          description: "Zip code, neighborhood, or borough, e.g. '11368', 'Corona, Queens'.",
        },
        language: {
          type: "string",
          description: "Language code for the answer, e.g. 'es' (default) or 'en'. Use the language the person writes in.",
          default: "es",
        },
        situation: {
          type: "string",
          description:
            "Optional short description of the situation in the person's words, used only for the legal intake summary. Never stored. Do not ask for immigration status.",
        },
      },
      required: ["needs", "near"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },

  async run(req, input, ctx) {
    const needs = getNeeds(input, "needs", { required: true });
    const nearText = getString(input, "near", { required: true, max: 200 });
    const language = getLanguage(input);
    // Status statements are dropped before anything else sees the text.
    const situation = withoutStatusStatements(getString(input, "situation", { max: 1500 }));
    const near = resolveNear(nearText);
    const cat = await loadCatalog(req);

    const drafts = draftSteps(cat, needs, near, language);
    const { edges, notes } = buildEdges(cat, drafts);
    const ordered = orderSteps(drafts, edges);
    const hasLegal = needs.includes("legal");

    // ---- the one LLM call: titles, summaries, order reasons, intake ----
    const facts = ordered.map((d, i) => ({
      step: i + 1,
      need: d.need,
      place: d.best
        ? {
          name: d.best.place.name,
          kind_of_place: ORG_TYPE_DESCRIPTIONS_EN[d.best.place.org_type] ?? ORG_TYPE_DESCRIPTIONS_EN.other,
          hours: d.best.place.hours,
          languages: d.best.place.languages,
        }
        : null,
      programs: d.programs.map((p) => ({ name: p.name, summary: p.summary_en })),
      bring: bringOf(d.programs),
      comes_first_because: edges.filter((e) => e.from === d.index).map((e) => e.reason).join(" ") || "",
    }));
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "integer" },
              title: { type: "string" },
              summary: { type: "string" },
              why_this_order: { type: "string" },
              bring: { type: "array", items: { type: "string" } },
            },
            required: ["step", "title", "summary", "why_this_order", "bring"],
          },
        },
        ...(hasLegal
          ? {
            intake_summary: {
              type: "object",
              properties: { for_lawyer_en: { type: "string" }, for_person_es: { type: "string" } },
              required: ["for_lawyer_en", "for_person_es"],
            },
          }
          : {}),
      },
      required: hasLegal ? ["steps", "intake_summary"] : ["steps"],
    };
    const prompt = [
      `You help immigrant families in New York City follow a short plan of free services.`,
      `Write in ${languageName(language)} (language code "${language}"), simple everyday words, warm and direct.`,
      `For EACH step below write: title (max 8 words, plain action, e.g. "Get your free city ID"), summary (1-2 sentences, max 35 words: what to do there and why it helps), why_this_order (rewrite "comes_first_because" in one plain sentence, or "" if it is empty), bring (the step's "bring" list translated into the answer language: same items, same order, short; copy unchanged if already in that language).`,
      `Rules: use ONLY the facts given; never mention, guess or ask about immigration status; no legal advice; do not invent documents, prices or eligibility.`,
      SPANISH_TONE,
      ...(hasLegal
        ? [
          `Also write intake_summary from ONLY the person's input below. Use exactly these bullets, one per line, each starting with "- ": needs (as listed), area, then 1-3 bullets that faithfully restate what the person said in their own words (translated to English for for_lawyer_en). for_lawyer_en is for a free immigration attorney; for_person_es is the same in plain Spanish (usted) for the person to bring. Every bullet must be directly stated in the input: no guesses about what the person wants, knows, has done or will do; no places, referrals or advice. Never state or guess immigration status. If they mention someone charging money to fix papers (a notario), restate that plainly. If own_words is "(none given)", write only the needs and area bullets.`,
          `Person's input: ${JSON.stringify({ needs, area: near.label, own_words: situation || "(none given)" })}`,
        ]
        : []),
      ``,
      `Steps (already in order): ${JSON.stringify(facts)}`,
    ].join("\n");
    const ai = await llmJson(req, prompt, schema);
    const aiSteps = new Map<number, Record<string, unknown>>();
    for (const s of Array.isArray(ai?.steps) ? ai!.steps as Array<Record<string, unknown>> : []) {
      if (typeof s?.step === "number") aiSteps.set(s.step, s);
    }

    // ---- assemble ----
    const steps = ordered.map((d, i) => {
      const fromAI = aiSteps.get(i + 1);
      const reasons = edges.filter((e) => e.from === d.index);
      const fallbackWhy = reasons.length
        ? (langOf(language) === "en"
          ? reasons.map((e) => e.reason).join(" ")
          : `Hágalo primero: le ayuda con ${reasons.map((e) => needLabel("es", drafts[e.to].need)).join(" y ")}.`)
        : null;
      const place = d.best ? placeOut(d.best, language, "") : null;
      const programsOut = d.programs.map((p) => programOut(p, language));
      const bring = translatedBring(fromAI?.bring, bringOf(d.programs), language);
      const title = cleanLLMText(fromAI?.title, 120) ?? templateTitle(d.need, d.best?.place.name, language);
      const summary = cleanLLMText(fromAI?.summary, 400) ??
        (d.best ? templateSummary(d.best, language) : t(language, "no_results_anywhere", { need: needLabel(language, d.need) }));
      const step: Record<string, unknown> = {
        step: i + 1,
        need: d.need,
        need_label: needLabel(language, d.need),
        title,
        summary,
        place: place ? stepPlace(place) : null,
        program: programsOut[0] ?? null,
        why_this_order: reasons.length ? (cleanLLMText(fromAI?.why_this_order, 400) ?? fallbackWhy) : null,
        bring,
      };
      if (programsOut.length > 1) step.also = programsOut.slice(1);
      if (notes.get(d.index)?.length) step.notes = notes.get(d.index);
      return { step, need: d.need, place, bring };
    });

    const response: Record<string, unknown> = {
      needs,
      near: near.label,
      language,
      intro: t(language, "plan_intro"),
      steps: steps.map((s) => s.step),
    };
    if (!near.matched) response.message = t(language, "unknown_location", { near: nearText });
    if (hasLegal) {
      const tmpl = templateIntake(needs, near, situation);
      const aiIntake = ai?.intake_summary as Record<string, unknown> | undefined;
      response.intake_summary = {
        title_lawyer: t("en", "intake_title_lawyer"),
        title_person: t("es", "intake_title_person"),
        for_lawyer_en: safeIntake(aiIntake?.for_lawyer_en) ?? tmpl.for_lawyer_en,
        for_person_es: safeIntake(aiIntake?.for_person_es) ?? tmpl.for_person_es,
      };
      const provider = bestDojProvider(cat, near, language);
      if (provider) response.free_legal_provider = verifiedProviderOut(provider, language);
    }
    response.plan_text = planText(steps, near, language);
    const unmet = drafts.some((d) => !d.met);
    response.unmet = unmet;
    if (hasSampleData(steps.flatMap((s) => (s.place ? [s.place] : [])))) response.note = t(language, "sample_data_note");
    response.written_by = ai ? "ai" : "template";
    response.disclaimer = disclaimer(language);

    // Only needs/zip/language/channel/counts. Never the situation text.
    void logRequest(req, {
      needs,
      zip: near.zip ?? "",
      language,
      channel: ctx.channel,
      results_found: drafts.filter((d) => d.best).length,
      unmet,
    });
    return response;
  },
};
