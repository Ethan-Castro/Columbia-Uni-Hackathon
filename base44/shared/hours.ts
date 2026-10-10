// Opening hours: parse human strings and check "open now" in New York time.
//
//   parseHours("Mon-Fri 9am-5pm; Sat 10am-2pm")
//   parseHours("Lun-Vie 9am-5pm"), ("Tue, Thu 17:00-20:00"), ("24/7"), ("By appointment")
//   isOpenAt("Mon-Fri 9am-5pm", new Date()) -> true | false | null (unknown)
//
// Best effort by design: anything we cannot read makes the answer null
// (unknown), never a wrong "closed". Text in parentheses is ignored for
// intervals (it is usually a note like "(WIC office Mon-Fri 9am-4pm)").

export const TIME_ZONE = "America/New_York";

/** One weekly opening interval. day 0=Sun..6=Sat; minutes since midnight; end may be 1440. */
export interface Interval {
  day: number;
  start: number;
  end: number;
  /** "first Saturday of the month" and similar: real but not every week. */
  irregular?: boolean;
}

export interface ParsedHours {
  intervals: Interval[];
  /** 24/7 */
  always: boolean;
  /** Mentions appointments or "call first". */
  byAppointment: boolean;
  /** Nothing usable was found (empty, "varies", "call", ...). */
  unknown: boolean;
}

const DAY_WORDS: Record<string, number> = {
  // No 2-letter forms: "we", "sa", "tu" are ordinary words.
  sun: 0, sunday: 0, sundays: 0, dom: 0, domingo: 0, domingos: 0,
  mon: 1, monday: 1, mondays: 1, lun: 1, lunes: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2, mar: 2, martes: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3, mie: 3, mier: 3, miercoles: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4, jue: 4, jueves: 4,
  fri: 5, friday: 5, fridays: 5, vie: 5, viernes: 5,
  sat: 6, saturday: 6, saturdays: 6, sab: 6, sabado: 6, sabados: 6,
};
const DAY_RE_SRC = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join("|");

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

function clean(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\ba\.\s?m\.?/g, "am").replace(/\bp\.\s?m\.?/g, "pm")
    .replace(/\s+/g, " ").trim();
}

/** Days from a range "mon-fri" (wraps: "fri-mon"). */
function dayRange(a: number, b: number): number[] {
  const out: number[] = [];
  for (let d = a; ; d = (d + 1) % 7) {
    out.push(d);
    if (d === b || out.length > 7) break;
  }
  return out;
}

interface RawTime {
  h: number;
  m: number;
  suffix?: "am" | "pm";
  special?: "noon" | "midnight";
}

function parseTime(s: string): RawTime | null {
  s = s.trim();
  if (/^(noon|mediodia)$/.test(s)) return { h: 12, m: 0, special: "noon" };
  if (/^(midnight|medianoche)$/.test(s)) return { h: 24, m: 0, special: "midnight" };
  const m = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|h|hrs)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  const suffix = m[3] === "am" || m[3] === "pm" ? m[3] : undefined;
  return { h, m: min, suffix };
}

function to24(t: RawTime, pm: boolean): number {
  let h = t.h;
  if (t.suffix === "am") h = h === 12 ? 0 : h;
  else if (t.suffix === "pm" || pm) h = h === 12 ? 12 : h + 12;
  return Math.min(h * 60 + t.m, 1440);
}

/** "9am-5pm", "10-2pm", "9-5", "17:00-20:00" -> [start, end] minutes, with am/pm inference. */
function timeRange(a: RawTime, b: RawTime): [number, number] {
  let end = b.special ? b.h * 60 : to24(b, false);
  let start: number;
  if (a.special) start = a.h === 24 ? 0 : a.h * 60;
  else if (a.suffix) start = to24(a, false);
  else if (b.suffix === "pm" && a.h < 12 && to24(a, true) < end) start = to24(a, true); // "5-8pm"
  else start = to24(a, false);
  if (!b.suffix && !b.special && end <= start && b.h <= 12) end = to24(b, true); // "9-5" -> 9-17
  if (end === 0) end = 1440; // "...-12am"
  return [start, end];
}

const TIME_SRC = String.raw`(?:noon|mediodia|midnight|medianoche|\d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm|hrs|h)?)`;
const TOKEN_RE = new RegExp(
  [
    String.raw`(?<always>24\s*/\s*7|24\s*(?:hours|hrs|horas|h)\b|open 24)`,
    String.raw`(?<range>${TIME_SRC})\s*(?:-|to|a|hasta|until|till)\s*(?<range2>${TIME_SRC})`,
    String.raw`\b(?:until|till|hasta)\s+(?:las\s+)?(?<until>${TIME_SRC})`,
    String.raw`\b(?<daily>daily|every ?day|7 days(?: a week)?|todos los dias|diario|diariamente)\b`,
    String.raw`\b(?<weekdays>weekdays|entre semana|dias de semana|dias laborables)\b`,
    String.raw`\b(?<weekends>weekends?|fines? de semana)\b`,
    String.raw`\b(?<d1>${DAY_RE_SRC})\b\.?\s*(?:-|to|a|al|through|thru|hasta)\s*(?<d2>${DAY_RE_SRC})\b\.?`,
    String.raw`\b(?<day>${DAY_RE_SRC})\b\.?`,
    String.raw`\b(?<closed>closed|cerrado)\b`,
    String.raw`\b(?<irregular>first|second|third|fourth|last|1st|2nd|3rd|4th|primer|primero|segundo|tercer|ultimo)\b`,
  ].join("|"),
  "g",
);

const APPOINTMENT_RE = /appointment|appt|por cita|con cita|\bcita\b|call (first|ahead|for)|llame|llamar/;

/** Parse an hours string into weekly intervals. Never throws. */
export function parseHours(hours: unknown): ParsedHours {
  const raw = typeof hours === "string" ? clean(hours) : "";
  const result: ParsedHours = { intervals: [], always: false, byAppointment: APPOINTMENT_RE.test(raw), unknown: false };
  if (!raw) return { ...result, unknown: true };

  // Drop parenthetical notes for intervals (still scanned for "appointment" above).
  const text = raw.replace(/\([^)]*\)/g, " ");

  // Walk tokens left to right. A group = days followed by time ranges; a new
  // day token after a time range starts a new group.
  let days: number[] = [];
  let daysAreNew = false; // days added since the last time range
  let irregular = false; // "first Saturday...": applies to the current group
  let sawDays = false;
  const add = (ds: number[], start: number, end: number) => {
    const list = ds.length ? ds : ALL_DAYS; // times with no days: assume every day
    for (const day of list) {
      if (end > start) result.intervals.push({ day, start, end, ...(irregular ? { irregular: true } : {}) });
      else if (end < start) { // overnight: 10pm-2am
        result.intervals.push({ day, start, end: 1440, ...(irregular ? { irregular: true } : {}) });
        result.intervals.push({ day: (day + 1) % 7, start: 0, end, ...(irregular ? { irregular: true } : {}) });
      }
    }
  };
  const endGroup = () => {
    daysAreNew = false;
    irregular = false;
  };
  const addDays = (ds: number[]) => {
    if (!daysAreNew) days = [];
    for (const d of ds) if (!days.includes(d)) days.push(d);
    daysAreNew = true;
    sawDays = true;
  };

  for (const segment of text.split(/[;\n|]+/)) {
    days = [];
    daysAreNew = false;
    irregular = false;
    for (const m of segment.matchAll(TOKEN_RE)) {
      const g = m.groups ?? {};
      if (g.always) {
        if (!sawDays && !days.length) result.always = true;
        else add(days, 0, 1440);
        endGroup();
      } else if (g.range && g.range2) {
        const a = parseTime(g.range);
        const b = parseTime(g.range2);
        if (!a || !b) continue;
        const [start, end] = timeRange(a, b);
        add(days, start, end);
        endGroup();
      } else if (g.until) {
        const b = parseTime(g.until);
        if (!b) continue;
        // A closing time with no am/pm ("hasta las 6") is afternoon.
        const end = b.special ? b.h * 60 : to24(b, !b.suffix && b.h >= 1 && b.h <= 9);
        // "Tue and Thu until 6pm": extend that day's existing interval, if any.
        for (const day of days.length ? days : ALL_DAYS) {
          const same = result.intervals.filter((i) => i.day === day);
          if (same.length) {
            const last = same.reduce((x, y) => (y.end > x.end ? y : x));
            if (end > last.end) last.end = end;
          }
        }
        endGroup();
      } else if (g.daily) addDays(ALL_DAYS);
      else if (g.weekdays) addDays(WEEKDAYS);
      else if (g.weekends) addDays(WEEKEND);
      else if (g.d1 && g.d2) addDays(dayRange(DAY_WORDS[g.d1], DAY_WORDS[g.d2]));
      else if (g.day) addDays([DAY_WORDS[g.day]]);
      else if (g.closed) {
        // "Sun closed": drop those days' intervals.
        if (days.length) result.intervals = result.intervals.filter((i) => !days.includes(i.day));
        days = [];
        endGroup();
      } else if (g.irregular) {
        irregular = true;
      }
    }
  }

  result.intervals.sort((a, b) => a.day - b.day || a.start - b.start);
  if (!result.always && !result.intervals.length) result.unknown = true;
  return result;
}

/** Day of week (0=Sun) and minutes since midnight in New York for a Date. */
export function nyClock(date: Date = new Date()): { day: number; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

function asParsed(hours: string | ParsedHours): ParsedHours {
  return typeof hours === "string" ? parseHours(hours) : hours;
}

/**
 * Is the place open at `date` (New York time)? true / false / null (unknown:
 * no readable hours, appointment-only, or only an irregular interval matches).
 */
export function isOpenAt(hours: string | ParsedHours, date: Date = new Date()): boolean | null {
  const p = asParsed(hours);
  if (p.always) return true;
  if (p.unknown) return null;
  const { day, minutes } = nyClock(date);
  const hits = p.intervals.filter((i) => i.day === day && minutes >= i.start && minutes < i.end);
  if (hits.some((i) => !i.irregular)) return true;
  if (hits.length) return null;
  return false;
}

/**
 * Open at some point during the rest of today (New York time), including now?
 * Good for "pantry open today". true / false / null (unknown).
 */
export function isOpenLaterToday(hours: string | ParsedHours, date: Date = new Date()): boolean | null {
  const p = asParsed(hours);
  if (p.always) return true;
  if (p.unknown) return null;
  const { day, minutes } = nyClock(date);
  const hits = p.intervals.filter((i) => i.day === day && i.end > minutes);
  if (hits.some((i) => !i.irregular)) return true;
  if (hits.length) return null;
  return false;
}

/** Open after 6 pm on some day (derived from the hours string). null when unknown. */
export function opensEvenings(hours: string | ParsedHours): boolean | null {
  const p = asParsed(hours);
  if (p.always) return true;
  if (p.unknown) return null;
  return p.intervals.some((i) => i.end >= 18 * 60 || i.start >= 17 * 60);
}

/** Open on Saturday or Sunday (derived). null when unknown. */
export function opensWeekends(hours: string | ParsedHours): boolean | null {
  const p = asParsed(hours);
  if (p.always) return true;
  if (p.unknown) return null;
  return p.intervals.some((i) => i.day === 0 || i.day === 6);
}

/** Place booleans win; fall back to the hours string when they are missing. */
export function placeOpenEvenings(place: { open_evenings?: unknown; hours?: unknown }): boolean {
  if (typeof place.open_evenings === "boolean") return place.open_evenings;
  return opensEvenings(String(place.hours ?? "")) === true;
}

export function placeOpenWeekends(place: { open_weekends?: unknown; hours?: unknown }): boolean {
  if (typeof place.open_weekends === "boolean") return place.open_weekends;
  return opensWeekends(String(place.hours ?? "")) === true;
}
