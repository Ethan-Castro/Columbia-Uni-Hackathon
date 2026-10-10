// Strip immigration-status content from text before it leaves the chat
// (WhatsApp/SMS). Status details never go to a phone: a text can be read by
// anyone who picks it up.
//
//   redactStatus("Pantry: Tue 10am-2pm. Bring ID. Talk about your asylum case.")
//   -> { text: "Pantry: Tue 10am-2pm. Bring ID.", removed: 1 }
//
// Works line by line, then sentence by sentence. A sentence that mentions
// status (English or Spanish, case- and accent-insensitive, invisible
// characters ignored) is dropped whole. A status phrase split across two
// lines drops both lines. An intake-summary section is dropped from its
// heading until a blank line followed by a plan step or plan heading.
// Only a count of removed pieces is returned, never what was removed.
//
// One status vocabulary for the whole app:
//   mentionsStatus(s)  any status topic, including "fix my papers" (texts, phones)
//   statesStatus(s)    the same minus the notario "fix papers for $X" phrasing,
//                      which a lawyer needs to hear (make_plan intake summary)

import { stripAccents } from "./text.ts";

/** "Someone will fix your papers": a notario red flag, not a status statement. */
const FIX_PAPERS_PATTERNS: RegExp[] = [
  /\barregl\w*\s+(los\s+|mis\s+|sus\s+|tus\s+)?papeles\b/,
  /\bfix\w*\s+(my\s+|your\s+|the\s+|their\s+)?papers\b/,
];

/** Patterns tested on lowercased, accent-free text with invisible characters removed. */
const STATUS_PATTERNS: RegExp[] = [
  // status words, alone or with a qualifier
  /\be?status\b/,
  /\b(estado|situacion|condicion)\s+(migratori[oa]|legal|de inmigracion)\b/,
  /\b(puede depender de su situacion|may depend on your situation)\b/,
  /\b(undocumented|indocumentad[oa]s?|sin papeles|sin documentos|without papers|no papers)\b/,
  /\b(immigration|inmigracion)\s+papers\b|\bpapeles\s+de\s+inmigracion\b/,
  /\b(tiene|tengo|tienen|tener|no tiene|no tengo|tenemos|no tenemos)\s+(los\s+)?papeles\b/,
  // how someone entered or stayed
  /\boverstay\w*|\bvisa vencida\b|\bse me vencio\b/,
  /\bsin inspeccion\b|\bwithout inspection\b|\bentr[eoa]\w*\s+sin\s+(inspeccion|papeles|documentos|permiso|visa)\b/,
  /\bfrontera\b|\bcross\w*\s+the\s+border\b|\bborder crossing\b/,
  /\b(soy|es|somos|son|estoy|esta|i am|i'm|we are|he is|she is|they are)\s+(un\s+|una\s+|an?\s+)?(ilegal|illegal)\b/,
  /\b(ilegales|illegals|illegal (alien|immigrant)s?|inmigrantes? ilegal(es)?)\b/,
  /\bmojad[oa]s?\b|\bla migra\b/,
  // documents and benefits that depend on status
  /\bvisas?\b/,
  /\bgreen\s?cards?\b|\btarjeta verde\b|\bmica\b/,
  /\bresidencia permanente\b|\bresidente permanente\b|\bpermanent residen\w*|\bresiden\w* status\b|\bestatus de residen\w*/,
  /\bcitizenship\b|\bciudadan\w*|\bcitizens?\b|\bnaturaliz\w*/,
  /\basylum\b|\basilo\b|\basylee\b|\brefugee status\b|\brefugiad[oa]s?\b/,
  /\btps\b|\bdaca\b|\bparole\b|\bvawa\b|\bsijs?\b/,
  /\bwork permit\b|\bwork authorization\b|\bpermiso de trabajo\b|\bead\b/,
  // enforcement, cases and court
  /\bdeport\w*/,
  /\bremoval\b|\bnotice to appear\b|\bnta\b/,
  /\bice\b/,
  /\bcaso de inmigracion\b|\bimmigration case\b|\bmi caso\b|\bmy case\b/,
  /\bimmigration court\b|\bcourt (date|hearing)\b|\bcorte de inmigracion\b|\bcita en (la )?corte\b|\b(tengo|tiene|tenemos) corte\b|\bjuez de inmigracion\b/,
  /\b(immigration )?hearing\b|\baudiencia\b|\beoir\b|\buscis\b/,
  // identifiers and form numbers (I-589, I 589, I589, I94)
  /\ba[\s-]?number\b/,
  /\bnumero a\b|\bnumero de extranjero\b|\balien (registration )?number\b|\ba#/,
  /\ba[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{3}\b|\ba\d{8,9}\b/,
  /\b(i|n|g|ar|ds)-?\s?\d{2,4}[a-z]?\b/,
  /\b(form|formulario)\s+(i|n|g)\s?-?\d{2,4}\b/,
];

/** Headings that start an intake-summary section. */
const INTAKE_HEADING =
  /\b(intake|resumen para (llevar a su cita|el abogado|la abogada|su abogado|su cita)|summary (for the (attorney|lawyer)|to bring to your legal))/;

/** After a blank line, a line like this ends an intake section: a plan step or plan heading. */
const PLAN_RESUME = /^\s*(#{1,6}\s|(paso|step)\s*\d|\d+[.)]\s|(su plan|your plan)\b)/i;

/** Lowercase, no accents, no zero-width / format characters (\p{Cf}). */
function plain(s: string): string {
  return stripAccents(s.replace(/\p{Cf}/gu, "").toLowerCase());
}

/** True when the text mentions immigration status in any way we know (including "fix my papers"). */
export function mentionsStatus(s: string): boolean {
  const p = plain(s) + " ";
  return STATUS_PATTERNS.some((re) => re.test(p)) || FIX_PAPERS_PATTERNS.some((re) => re.test(p));
}

/** Like mentionsStatus, but "someone says they will fix my papers for $X" does not count. */
export function statesStatus(s: string): boolean {
  const p = plain(s) + " ";
  return STATUS_PATTERNS.some((re) => re.test(p));
}

/** Split a line into sentences, keeping their punctuation. */
function sentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=\S)/);
}

export interface Redacted {
  text: string;
  /** How many sentences or lines were removed. Never what they said. */
  removed: number;
}

export function redactStatus(input: string): Redacted {
  const lines = String(input ?? "").replace(/\r\n?/g, "\n").split("\n");
  const hit = lines.map((l) => mentionsStatus(l));

  // A phrase split across two lines ("immigration\nstatus: pending"): drop both lines.
  const drop = new Set<number>();
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!hit[i] && !hit[i + 1] && lines[i].trim() && lines[i + 1].trim() && mentionsStatus(`${lines[i]} ${lines[i + 1]}`)) {
      drop.add(i).add(i + 1);
    }
  }

  const out: string[] = [];
  let removed = 0;
  let inIntake = false;
  let prevBlank = false;

  lines.forEach((line, i) => {
    const blank = !line.trim();
    const wasBlank = prevBlank;
    prevBlank = blank;

    if (INTAKE_HEADING.test(plain(line))) {
      inIntake = true;
      removed++;
      return;
    }
    if (inIntake) {
      // Only a blank line followed by a plan step/heading ends the section; a "Label:" line does not.
      if (!blank && wasBlank && PLAN_RESUME.test(line) && !mentionsStatus(line)) inIntake = false;
      else {
        if (!blank) removed++;
        return;
      }
    }
    if (blank) {
      out.push("");
      return;
    }
    if (drop.has(i)) {
      removed++;
      return;
    }
    const parts = sentences(line);
    const kept = parts.filter((s) => !mentionsStatus(s));
    removed += parts.length - kept.length;
    if (kept.length) {
      // Keep the line's indentation / bullet when the first sentence survives.
      const lead = kept[0] === parts[0] ? "" : (line.match(/^\s*([-*•]\s+)?/)?.[0] ?? "");
      out.push(lead + kept.join(" "));
    }
  });

  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}
