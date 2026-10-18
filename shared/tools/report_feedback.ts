// report_feedback: "did this help?" and "this information is wrong", from any door.
//
//   { place_id: "place-...", helpful: true }                  -> { ok, message }
//   { code: "K7Q2", issue: "wrong_hours", language: "es" }    -> { ok, message, place }
//
// One anonymous Feedback row: place, need, helpful, issue (a fixed choice), channel,
// language, zip. Never names, phones or free text. A row with an issue stays "open"
// until a person re-checks the place; meanwhile that place's answers say "call before
// you go" (rank.checkFirst), and the admin queue lists it (shared/web/feedback.ts).

import { getDb } from "../db.ts";
import { HttpError } from "../http.ts";
import { langOf } from "../i18n.ts";
import type { Lang } from "../i18n.ts";
import { placeCode } from "../rank.ts";
import { FEEDBACK_ISSUES, NEEDS } from "../schema.ts";
import type { Feedback, FeedbackIssue, Need, Place } from "../schema.ts";
import { getLanguage, getString, parseNeed } from "./input.ts";
import type { Tool } from "./types.ts";

/** Open reports one place can collect before more are ignored (a flood stays one banner). */
const MAX_OPEN_PER_PLACE = 5;

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    thanks_helpful: "¡Gracias! Nos alegra que le haya servido.",
    thanks_not_helpful: "Gracias por decirnos. Lo usamos para mejorar las respuestas.",
    thanks_issue: "Gracias. Una persona de nuestro equipo va a revisar {name}. Mientras tanto avisamos a los demás que llamen antes de ir.",
    unknown_place: "No encontramos ese lugar. Revise el código e intente de nuevo.",
  },
  en: {
    thanks_helpful: "Thank you! We're glad it helped.",
    thanks_not_helpful: "Thanks for telling us. We use it to make the answers better.",
    thanks_issue: "Thank you. A person on our team will re-check {name}. Meanwhile we tell others to call before they go.",
    unknown_place: "We couldn't find that place. Check the code and try again.",
  },
};

export function issueOf(v: unknown): FeedbackIssue | undefined {
  return (FEEDBACK_ISSUES as readonly unknown[]).includes(v) ? v as FeedbackIssue : undefined;
}

/** Place by id, or by its 4-character code (unique codes only). */
export async function findPlace(req: Request, id: string, code: string): Promise<Place | null> {
  const db = getDb(req);
  if (id) {
    try {
      return await db.Place.get(id);
    } catch {
      return null;
    }
  }
  if (!code) return null;
  const want = code.toUpperCase();
  const hits = (await db.Place.list("name", 5000, 0, ["id", "name", "zip"])).filter((p) => placeCode(p.id) === want);
  return hits.length === 1 ? hits[0] : null;
}

export async function recordFeedback(
  req: Request,
  input: Record<string, unknown>,
  channel: Feedback["channel"],
): Promise<{ ok: true; message: string; place?: { id: string; name: string } }> {
  const lang = langOf(getLanguage(input));
  const s = TEXT[lang];
  const id = getString(input, "place_id", { max: 120 });
  const code = getString(input, "code", { max: 8 }).replace(/[^A-Za-z0-9]/g, "");
  const issue = issueOf(input.issue);
  const helpful = typeof input.helpful === "boolean" ? input.helpful : issue ? false : undefined;
  if (helpful === undefined && !issue) throw new HttpError(400, `Give "helpful" (true/false) or "issue" (${FEEDBACK_ISSUES.join(", ")})`);
  if (id && !/^place-[a-z0-9-]+$/.test(id)) throw new HttpError(400, `"place_id" must be a place id from the results`);
  const need = parseNeed(getString(input, "need", { max: 40 })) as Need | undefined;
  const zipIn = getString(input, "zip", { max: 10 });

  const place = id || code ? await findPlace(req, id, code) : null;
  if ((id || code) && !place) {
    if (issue) throw new HttpError(404, s.unknown_place);
  }
  if (issue && !place) throw new HttpError(400, `An "issue" needs the place: pass "place_id" (or its code)`);

  const db = getDb(req);
  if (issue && place) {
    const open = await db.Feedback.count({ place_id: place.id, status: "open" }).catch(() => 0);
    if (open >= MAX_OPEN_PER_PLACE) return { ok: true, message: s.thanks_issue.replace("{name}", place.name), place: { id: place.id, name: place.name } };
  }
  const row: Omit<Feedback, "id"> = {
    place_id: place?.id ?? "",
    ...(need && (NEEDS as readonly string[]).includes(need) ? { need } : {}),
    ...(helpful !== undefined ? { helpful } : {}),
    ...(issue ? { issue } : {}),
    channel,
    language: lang,
    // 5 digits only, the same rule as RequestLog: never an address or phone.
    zip: /^\d{5}$/.test(zipIn) ? zipIn : /^\d{5}$/.test(place?.zip ?? "") ? place!.zip : "",
    // Only reports need a person to look; a plain helpful / not helpful is closed at once.
    status: issue ? "open" : "resolved",
    created_at: new Date().toISOString(),
  };
  await db.Feedback.create(row);
  const message = issue
    ? s.thanks_issue.replace("{name}", place!.name)
    : helpful
    ? s.thanks_helpful
    : s.thanks_not_helpful;
  return { ok: true, message, ...(place ? { place: { id: place.id, name: place.name } } : {}) };
}

export const reportFeedback: Tool = {
  definition: {
    name: "report_feedback",
    description:
      "Record whether a place we suggested helped, or that its information is wrong. Use when the person says " +
      "it helped / me sirvió / gracias funcionó, it did not help / no me sirvió, or that a place was closed " +
      "(cerrado, ya no existe), had different hours (otro horario), a wrong phone or address, or turned them " +
      "away (no me atendieron). Pass the place_id from the earlier results. Anonymous: never pass names, phone " +
      "numbers or the person's words. Wrong-information reports go to a person on our team to re-check, and " +
      "until then that place's answers tell people to call first. Ask before sending if the person only hinted.",
    inputSchema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "The id of the place from find_resources or make_plan results (place-...)." },
        helpful: { type: "boolean", description: "true if it helped, false if it did not." },
        issue: {
          type: "string",
          enum: [...FEEDBACK_ISSUES],
          description: "What is wrong, if anything: closed, wrong_hours, wrong_phone, wrong_address, turned_away, other.",
        },
        need: { type: "string", enum: [...NEEDS], description: "The kind of help they were looking for." },
        language: { type: "string", description: "Language code for the reply, e.g. 'es' (default) or 'en'.", default: "es" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },

  run(req, input, ctx) {
    return recordFeedback(req, input, ctx.channel);
  },
};
