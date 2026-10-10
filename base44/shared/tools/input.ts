// Input helpers shared by the tools. Each throws HttpError(400) with a plain
// message on bad input, which MCP shows to the model as a tool error.

import { HttpError } from "../http.ts";
import { NEEDS } from "../schema.ts";
import type { Need } from "../schema.ts";
import { normalize } from "../text.ts";

type Input = Record<string, unknown>;

/** A trimmed string field. Throws when required and missing; caps length. */
export function getString(input: Input, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = input[key];
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s && opts.required) throw new HttpError(400, `"${key}" is required`);
  return s.slice(0, opts.max ?? 500);
}

/** A boolean field; accepts true/false and "true"/"false". */
export function getBool(input: Input, key: string, fallback = false): boolean {
  const v = input[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/** Language code like "es", "en", "es-MX", "qu". Default "es". */
export function getLanguage(input: Input, key = "language"): string {
  const v = typeof input[key] === "string" ? (input[key] as string).trim() : "";
  if (/^[a-zA-Z]{2,3}(-[A-Za-z]{2,4})?$/.test(v)) {
    const [base, region] = v.split("-");
    return region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
  }
  const word = normalize(v);
  if (["spanish", "espanol", "castellano"].includes(word)) return "es";
  if (["english", "ingles"].includes(word)) return "en";
  return "es";
}

/** English and Spanish words (normalized) that map to a need. */
export const NEED_SYNONYMS: Record<string, Need> = {
  food: "food", comida: "food", pantry: "food", despensa: "food", alimentos: "food", groceries: "food",
  snap: "food", "food stamps": "food", cupones: "food", wic: "food", hambre: "food", meals: "food",
  legal: "legal", lawyer: "legal", abogado: "legal", abogada: "legal", attorney: "legal", notario: "legal",
  immigration: "legal", inmigracion: "legal", papers: "legal", papeles: "legal", asylum: "legal", asilo: "legal",
  consultant: "legal",
  health: "health", salud: "health", clinic: "health", clinica: "health", doctor: "health", medico: "health",
  "child health plus": "health", medicaid: "health", seguro: "health", vacunas: "health",
  benefits: "benefits", beneficios: "benefits", ayuda: "benefits", "cash assistance": "benefits",
  money: "money", dinero: "money", bank: "money", banco: "money", remesas: "money", remittance: "money",
  remittances: "money", envios: "money", taxes: "money", impuestos: "money", itin: "money", cuenta: "money",
  school: "school", escuela: "school", colegio: "school", enroll: "school", inscribir: "school", esl: "school",
  ingles: "school", english: "school", classes: "school", clases: "school",
  id: "id", idnyc: "id", identificacion: "id", identification: "id", "consular id": "id", matricula: "id",
  pasaporte: "id", passport: "id",
  housing: "housing", vivienda: "housing", rent: "housing", renta: "housing", shelter: "housing",
  refugio: "housing", albergue: "housing", eviction: "housing", desalojo: "housing", casa: "housing",
  work: "work", trabajo: "work", job: "work", jobs: "work", empleo: "work", salario: "work", wages: "work",
  transit: "transit", transporte: "transit", metrocard: "transit", omny: "transit", subway: "transit",
  metro: "transit", bus: "transit", "fair fares": "transit",
};

/** One word or phrase -> Need, or undefined. "comida" -> "food", "Legal" -> "legal". */
export function parseNeed(word: unknown): Need | undefined {
  const n = normalize(word, { dropSuffixes: false });
  if ((NEEDS as readonly string[]).includes(n)) return n as Need;
  return NEED_SYNONYMS[n];
}

/**
 * Needs from a string ("food"), a pipe/comma list ("food|legal"), or an array.
 * Accepts synonyms in English and Spanish. De-duplicated, input order kept.
 * Throws when required and nothing valid is found.
 */
export function getNeeds(input: Input, key = "needs", opts: { required?: boolean } = {}): Need[] {
  const v = input[key];
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[|,;/]+/) : [];
  const out: Need[] = [];
  for (const p of parts) {
    const need = parseNeed(p);
    if (need && !out.includes(need)) out.push(need);
  }
  if (!out.length && opts.required) {
    throw new HttpError(400, `"${key}" must be one or more of: ${NEEDS.join(", ")}`);
  }
  return out;
}
