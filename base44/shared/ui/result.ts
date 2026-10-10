// tools/call result shape for MCP hosts with and without UI.
//
//   { content: [summary text, compact JSON?], structuredContent?: { kind, ...data }, _meta? }
//
// - summary: short, Spanish-first (English when language is "en"): names, hours,
//   source + checked date and the disclaimer, so a text-only host still shows them.
// - compact JSON: the full tool output for hosts that pass only `content` to the
//   model (claude.ai is unconfirmed; Claude Code shows structuredContent instead).
//   Dropped when the call comes from ChatGPT (openai/* keys in params._meta),
//   whose model already reads structuredContent.
// - structuredContent: only for the three UI tools; the widget renders it. It
//   must match OUTPUT_SCHEMA (loose on purpose so validation cannot fail).
//
// The summary is built from the tool's JSON only, defensively: check_provider's
// field names are still changing.

import { disclaimer, langOf, needLabel } from "../i18n.ts";
import type { Lang } from "../i18n.ts";

export const UI_KIND: Record<string, string> = {
  find_resources: "resources",
  make_plan: "plan",
  check_provider: "provider_check",
};

/** Loose outputSchema for the UI tools: structuredContent always has `kind`. */
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: Object.values(UI_KIND) },
    language: { type: "string" },
  },
  required: ["kind"],
  additionalProperties: true,
};

type Data = Record<string, unknown>;
const MAX_LINES = 10;

const L = {
  es: {
    found: "Encontré {n} lugares de {need} cerca de {near}",
    open: "abiertos ahora: {n}",
    none: "No encontré lugares de {need} cerca de {near}.",
    hours: "Horario",
    openNow: "abierto ahora",
    langs: "Idiomas",
    bring: "Traer",
    trust: "Confianza",
    source: "Fuente",
    checked: "revisado el",
    noSource: "sin enlace de fuente",
    plan: "Plan de {n} pasos",
    why: "Por qué primero",
    intake: "Resumen para la cita legal",
    options: "Opciones en las listas del DOJ",
    phone: "Tel.",
  },
  en: {
    found: "Found {n} places for {need} near {near}",
    open: "open now: {n}",
    none: "No places found for {need} near {near}.",
    hours: "Hours",
    openNow: "open now",
    langs: "Languages",
    bring: "Bring",
    trust: "Trust",
    source: "Source",
    checked: "checked",
    noSource: "no source link",
    plan: "{n}-step plan",
    why: "Why first",
    intake: "Summary for the legal appointment",
    options: "Options on the DOJ lists",
    phone: "Phone",
  },
} as const;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const list = (v: unknown): Data[] =>
  Array.isArray(v) ? v.filter((x): x is Data => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
/** First present field among `keys` (old and new names). */
const pick = (o: Data, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v != null && v !== "");

/** "Name — address. Horario: ... Fuente: url (revisado el 2026-09-30)." */
function placeLine(p: Data, l: Lang): string {
  const s = L[l];
  const parts = [str(p.name) || str(p.org)];
  if (str(p.address)) parts[0] += ` — ${str(p.address)}`;
  if (str(p.hours)) parts.push(`${s.hours}: ${str(p.hours)}${p.open_now === true ? ` (${s.openNow})` : ""}`);
  if (str(p.phone)) parts.push(`${s.phone} ${str(p.phone)}`);
  const langs = Array.isArray(p.languages) ? p.languages.join(", ") : "";
  if (langs) parts.push(`${s.langs}: ${langs}`);
  if (str(p.trust_label)) parts.push(`${s.trust}: ${str(p.trust_label)}`);
  for (const k of ["fee", "cost", "intake"]) if (str(p[k])) parts.push(`${k}: ${str(p[k])}`);
  const url = str(p.source_url) || str(p.source_label) || s.noSource;
  const date = str(pick(p, ["last_checked", "checked_on"]));
  parts.push(`${s.source}: ${url}${date ? ` (${s.checked} ${date})` : ""}`);
  return parts.join(". ") + ".";
}

function summarizeResources(d: Data, l: Lang): string[] {
  const s = L[l];
  const results = list(d.results);
  const need = needLabel(l, str(d.need));
  const near = str(d.near);
  if (!results.length) return [fill(s.none, { need, near })];
  const open = results.filter((r) => r.open_now === true).length;
  const lines = [
    fill(s.found, { n: results.length, need, near }) + (open ? `; ${fill(s.open, { n: open })}` : "") + ".",
  ];
  results.slice(0, MAX_LINES).forEach((r, i) => lines.push(`${i + 1}. ${placeLine(r, l)}`));
  const fp = d.free_legal_provider as Data | undefined;
  if (fp && str(fp.note)) lines.push(str(fp.note));
  return lines;
}

function summarizePlan(d: Data, l: Lang): string[] {
  const s = L[l];
  const steps = list(d.steps);
  const lines = [fill(s.plan, { n: steps.length }) + "."];
  steps.slice(0, MAX_LINES).forEach((st, i) => {
    const place = st.place && typeof st.place === "object" ? placeLine(st.place as Data, l) : "";
    const bring = Array.isArray(st.bring) && st.bring.length ? ` ${s.bring}: ${st.bring.join(", ")}.` : "";
    const why = str(st.why_this_order) ? ` ${s.why}: ${str(st.why_this_order)}` : "";
    lines.push(`${str(st.step) || i + 1}) ${str(st.title) || str(st.need_label)}. ${place}${bring}${why}`.trim());
  });
  const intake = d.intake_summary as Data | undefined;
  if (intake && str(intake.for_person_es)) lines.push(`${s.intake}:\n${str(intake.for_person_es)}`);
  const fp = d.free_legal_provider as Data | undefined;
  if (fp && str(fp.note)) lines.push(str(fp.note));
  return lines;
}

function summarizeProvider(d: Data, l: Lang): string[] {
  const s = L[l];
  const lines = [str(d.what_this_means), str(d.warning)].filter(Boolean);
  const listName = str(pick(d, ["list_name", "doj_list_name"]));
  const listDate = str(pick(d, ["list_checked", "list_last_checked", "checked_on"]));
  if (listName || listDate) {
    lines.push([listName, listDate ? `${s.checked} ${listDate}` : ""].filter(Boolean).join(", ") + ".");
  }
  const options = list(pick(d, ["doj_listed_options", "free_legal_providers", "options", "providers"]));
  if (options.length) {
    lines.push(`${str(pick(d, ["options_title", "free_providers_title"])) || s.options}`);
    options.slice(0, MAX_LINES).forEach((p, i) => lines.push(`${i + 1}. ${placeLine(p, l)}`));
  } else if (str(d.free_providers_title)) lines.push(str(d.free_providers_title));
  if (str(d.trust_note)) lines.push(str(d.trust_note));
  return lines;
}

/** Short plain-text summary for the model. */
export function summarize(name: string, data: unknown, language?: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return typeof data === "string" ? data : JSON.stringify(data);
  }
  const d = data as Data;
  const l = langOf(language ?? d.language);
  let lines: string[];
  if (name === "find_resources") lines = summarizeResources(d, l);
  else if (name === "make_plan") lines = summarizePlan(d, l);
  else if (name === "check_provider") lines = summarizeProvider(d, l);
  else if (name === "ping") return "pong";
  else return str(d.message) || JSON.stringify(d);
  for (const k of ["message", "note"]) if (str(d[k])) lines.push(str(d[k]));
  // Every UI result ends with the trust line: information and referrals, not legal advice.
  lines.push(str(d.disclaimer) || disclaimer(l));
  return lines.filter(Boolean).join("\n");
}

/** True when the tools/call came from ChatGPT (it sends openai/* keys in params._meta). */
export function fromChatGPT(params: Record<string, unknown>): boolean {
  const meta = params._meta;
  return !!meta && typeof meta === "object" && Object.keys(meta).some((k) => k.startsWith("openai/"));
}

/** Successful tools/call result. */
export function toolResult(name: string, data: unknown, opts: { compactJson?: boolean } = {}) {
  const content = [{ type: "text", text: summarize(name, data) }];
  if (opts.compactJson !== false) content.push({ type: "text", text: JSON.stringify(data) });
  const kind = UI_KIND[name];
  if (!kind || !data || typeof data !== "object" || Array.isArray(data)) return { content };
  const d = data as Data;
  const extra: Data = {};
  // Localized need label for the widget header (find_resources returns the need code).
  if (typeof d.need === "string" && !d.need_label) extra.need_label = needLabel(d.language, d.need);
  return { content, structuredContent: { ...d, ...extra, kind } };
}
