// RFC 4180 CSV parser with line numbers and recovery from broken quotes.
// Used only by scripts/import.ts (not copied to Base44). No deps.
//
//   parseCsv('id,name\r\nplace-a,"Corona, Queens"\r\n')
//   -> { records: [{ line: 1, endLine: 1, fields: ["id","name"] },
//                  { line: 2, endLine: 2, fields: ["place-a","Corona, Queens"] }], problems: [] }
//
// Handles: quoted fields, "" escapes, commas and newlines inside quotes,
// CRLF / LF / CR line endings, a UTF-8 BOM, and blank lines (skipped).
//
// Broken quotes never crash the parse. A record that hits end-of-file inside
// quotes, or that spans several lines and then ends up with the wrong number
// of fields or a misplaced quote (a stray quote swallowed the following
// rows), is reported as a
// problem for its first line, and parsing resumes on the next physical line.
// So one bad quote costs one row, not the rest of the file.

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  line: number;
  /** 1-based physical line where it ends (> line when a quoted field has newlines). */
  endLine: number;
  fields: string[];
  /** Set when a quote appeared somewhere RFC 4180 does not allow it (kept as text). */
  looseQuote?: boolean;
}

export interface CsvProblem {
  line: number;
  message: string;
  /** Text of the bad line up to its first comma (usually the row id). */
  firstField: string;
}

export interface CsvResult {
  records: CsvRecord[];
  problems: CsvProblem[];
}

interface Scan {
  fields: string[];
  end: number; // offset just past the record's line ending
  endLine: number;
  unclosed: boolean; // hit EOF inside quotes
  looseQuote: boolean;
}

/** Scan one record starting at `pos` (which is at the start of a line). */
function scanRecord(text: string, pos: number, line: number): Scan {
  const fields: string[] = [];
  let field = "";
  let i = pos;
  let curLine = line;
  let looseQuote = false;
  let inQuotes = false;
  let fieldStart = true; // at the first char of a field
  let closedQuote = false; // just closed a quoted section in this field

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { // escaped quote
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        closedQuote = true;
        i++;
        continue;
      }
      if (c === "\r" || c === "\n") {
        // newline inside quotes is data; normalize CRLF / CR to \n
        field += "\n";
        i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
        curLine++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    // not in quotes
    if (c === ",") {
      fields.push(field);
      field = "";
      fieldStart = true;
      closedQuote = false;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      fields.push(field);
      return { fields, end: i, endLine: curLine, unclosed: false, looseQuote };
    }
    if (c === '"') {
      if (fieldStart) {
        inQuotes = true;
        fieldStart = false;
        i++;
        continue;
      }
      // a quote in the middle of an unquoted field, or after a closing quote:
      // not RFC 4180, but keep it as text and flag it
      looseQuote = true;
      field += c;
      i++;
      continue;
    }
    if (closedQuote && c !== " " && c !== "\t") looseQuote = true; // "abc"def
    field += c;
    fieldStart = false;
    i++;
  }
  // end of file
  fields.push(field);
  return { fields, end: text.length, endLine: curLine, unclosed: inQuotes, looseQuote };
}

/** Offset of the start of the line after the one starting at `pos`. */
function nextLineStart(text: string, pos: number): number {
  for (let i = pos; i < text.length; i++) {
    if (text[i] === "\n") return i + 1;
    if (text[i] === "\r") return text[i + 1] === "\n" ? i + 2 : i + 1;
  }
  return text.length;
}

function isBlank(fields: string[]): boolean {
  return fields.length === 1 && fields[0].trim() === "";
}

/**
 * Parse CSV text. `expectedFields` (normally the header's length, learned
 * from the first record when omitted) is used to detect stray quotes.
 */
export function parseCsv(input: string, expectedFields?: number): CsvResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // BOM
  const records: CsvRecord[] = [];
  const problems: CsvProblem[] = [];
  let pos = 0;
  let line = 1;
  let expected = expectedFields;

  while (pos < text.length) {
    const scan = scanRecord(text, pos, line);
    const multiLine = scan.endLine > line;
    const wrongCount = expected !== undefined && scan.fields.length !== expected;
    // A multi-line record that ends with the wrong width, or with a quote in
    // a place quotes cannot be, almost always means a stray quote.
    const strayQuote = multiLine && (wrongCount || scan.looseQuote) && !isBlank(scan.fields);
    if (scan.unclosed || strayQuote) {
      const firstField = text.slice(pos, nextLineStart(text, pos)).split(",")[0].replace(/^"|[\r\n]+$/g, "").trim();
      problems.push({
        line,
        firstField,
        message: scan.unclosed
          ? "unclosed quote: a field opens with \" but never closes (row skipped)"
          : `stray quote: a quoted field ran from line ${line} to line ${scan.endLine}${wrongCount ? ` and the row ended up with ${scan.fields.length} values instead of ${expected}` : ""} (row skipped, parsing resumed at line ${line + 1})`,
      });
      // resume on the next physical line
      pos = nextLineStart(text, pos);
      line++;
      continue;
    }
    if (!isBlank(scan.fields)) {
      records.push({
        line,
        endLine: scan.endLine,
        fields: scan.fields,
        ...(scan.looseQuote ? { looseQuote: true } : {}),
      });
      if (expected === undefined) expected = scan.fields.length; // header
    }
    pos = scan.end;
    line = scan.endLine + 1;
  }
  return { records, problems };
}

/** Quote a value for CSV output if needed. */
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
