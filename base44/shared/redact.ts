// Strip immigration-status content from text before it leaves the chat
// (WhatsApp/SMS). Status details never go to a phone: a text can be read by
// anyone who picks it up.
//
//   redactStatus("Pantry: Tue 10am-2pm. Bring ID. Talk about your asylum case.")
//   -> { text: "Pantry: Tue 10am-2pm. Bring ID.", removed: 1 }
//
// Works line by line, then sentence by sentence. A sentence that mentions
// status (English or Spanish, case- and accent-insensitive) is dropped whole.
// An intake-summary section is dropped from its heading to the next heading.
// Only a count of removed pieces is returned, never what was removed.

import { stripAccents } from "./text.ts";

/** Patterns tested on lowercased, accent-free text. */
const STATUS_PATTERNS: RegExp[] = [
  // status words
  /\b(immigration|migratory|legal|your|my|his|her|their)\s+status\b/,
  /\bstatus\s+(migratorio|legal|de inmigracion)\b/,
  /\b(estatus|estado|situacion|condicion)\s+(migratori[oa]|legal|de inmigracion)\b/,
  /\b(puede depender de su situacion|may depend on your situation)\b/,
  /\b(undocumented|indocumentad[oa]s?|sin papeles|sin documentos|without papers|no papers)\b/,
  // "papers" only when about status
  /\barregl\w*\s+(los\s+|mis\s+|sus\s+|tus\s+)?papeles\b/,
  /\bfix\w*\s+(my\s+|your\s+|the\s+|their\s+)?papers\b/,
  /\b(immigration|inmigracion)\s+papers\b|\bpapeles\s+de\s+inmigracion\b/,
  /\b(tiene|tengo|tienen|tener|no tiene|no tengo)\s+papeles\b/,
  // documents and benefits that depend on status
  /\bvisas?\b/,
  /\bgreen\s?cards?\b|\btarjeta verde\b|\bmica\b/,
  /\bresidencia permanente\b|\bresidente permanente\b|\bpermanent residen\w*|\bresiden\w* status\b|\bestatus de residen\w*/,
  /\bcitizenship\b|\bciudadan\w*|\bcitizens?\b|\bnaturaliz\w*/,
  /\basylum\b|\basilo\b|\basylee\b|\brefugee status\b|\brefugiad[oa]s?\b/,
  /\btps\b|\bdaca\b|\bparole\b|\bvawa\b|\bsijs?\b/,
  /\bwork permit\b|\bwork authorization\b|\bpermiso de trabajo\b|\bead\b/,
  // enforcement and court
  /\bdeport\w*/,
  /\bremoval\b|\bnotice to appear\b|\bnta\b/,
  /\bice\b/,
  /\bimmigration court\b|\bcourt date\b|\bcorte de inmigracion\b|\bcita en (la )?corte\b|\bjuez de inmigracion\b/,
  /\b(immigration )?hearing\b|\baudiencia\b|\beoir\b|\buscis\b/,
  // identifiers and form numbers
  /\ba[\s-]?number\b/,
  /\bnumero a\b|\bnumero de extranjero\b|\balien (registration )?number\b|\ba#/,
  /\ba[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{3}\b|\ba\d{8,9}\b/,
  /\b(i|n|g|ar|ds)-\s?\d{2,4}[a-z]?\b/,
  /\b(form|formulario)\s+(i|n|g)\s?-?\d{2,4}\b/,
];

/** Headings that start an intake-summary section (dropped until the next heading). */
const INTAKE_HEADING =
  /\b(intake|resumen para (llevar a su cita|el abogado|la abogada|su abogado|su cita)|summary (for the (attorney|lawyer)|to bring to your legal))/;

/** A line that looks like the start of a new section. */
const HEADING = /^\s*(#{1,6}\s|\*\*|__|(paso|step)\s*\d|\d+[.)]\s|[A-ZÁÉÍÓÚÑ][^.!?]{0,60}:\s*$)/i;

function plain(s: string): string {
  return stripAccents(s.toLowerCase());
}

/** True when the text mentions immigration status in any way we know. */
export function mentionsStatus(s: string): boolean {
  const p = plain(s);
  return STATUS_PATTERNS.some((re) => re.test(p + " "));
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
  const out: string[] = [];
  let removed = 0;
  let inIntake = false;

  for (const line of String(input ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (INTAKE_HEADING.test(plain(line))) {
      inIntake = true;
      removed++;
      continue;
    }
    if (inIntake) {
      if (HEADING.test(line) && !mentionsStatus(line)) inIntake = false;
      else {
        if (line.trim()) removed++;
        continue;
      }
    }
    if (!line.trim()) {
      out.push("");
      continue;
    }
    const parts = sentences(line);
    const kept = parts.filter((s) => !mentionsStatus(s));
    removed += parts.length - kept.length;
    if (kept.length) {
      // Keep the line's indentation / bullet when the first sentence survives.
      const lead = kept[0] === parts[0] ? "" : (line.match(/^\s*([-*•]\s+)?/)?.[0] ?? "");
      out.push(lead + kept.join(" "));
    }
  }

  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}
