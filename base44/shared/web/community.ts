// Community page: neighbors ask local questions (housing, food, school...) and
// point out directory corrections. Discussion only: a post never becomes a
// directory result. A resource tip only reaches the directory through the
// "suggest a resource" form, as a pending Submission a person approves.
//
//   community(req, { action: "list" })                                   // public
//   community(req, { action: "post", kind, body, need?, zip?, parent_id? }) // public
//   community(req, { action: "hide", id })                                // admin
//
// Privacy: no names, accounts, phones or emails. Phone numbers and emails in a
// post are replaced before it is stored, and posts about immigration status
// are refused (not stored) with a pointer to free legal help.

import { requireAdmin } from "../auth.ts";
import { getDb } from "../db.ts";
import { HttpError } from "../http.ts";
import { langOf } from "../i18n.ts";
import { mentionsStatus } from "../redact.ts";
import { NEEDS } from "../schema.ts";
import type { CommunityKind, CommunityPost, Need } from "../schema.ts";
import type { Body } from "./handler.ts";

const MAX_BODY = 1000;
const MIN_BODY = 10;
const MAX_PER_HOUR = 60; // simple flood guard for the whole page
const LIST_LIMIT = 200;

/** Replies may answer a built-in example post (web/src/pages/Community.tsx). */
const DEMO_PARENT = /^demo-[a-z0-9-]{1,40}$/;

const MSG = {
  es: {
    posted: "Publicado. Gracias por ayudar a sus vecinos.",
    status: "Por su seguridad, no publicamos mensajes sobre estatus migratorio, casos o documentos de inmigración. Para eso, hable gratis con un abogado o un representante acreditado por el DOJ: búsquelo en \"Buscar\" > Legal.",
    short: "Escriba un poco más (al menos 10 letras).",
    busy: "Hay muchos mensajes ahora mismo. Intente de nuevo más tarde.",
  },
  en: {
    posted: "Posted. Thank you for helping your neighbors.",
    status: "For your safety, we don't publish posts about immigration status, cases or immigration documents. For that, talk to a free lawyer or a DOJ-accredited representative: find one under \"Search\" > Legal.",
    short: "Please write a little more (at least 10 characters).",
    busy: "There are a lot of posts right now. Please try again later.",
  },
};

/** What the page gets: no internal fields. */
export interface PublicPost {
  id: string;
  kind: CommunityKind;
  body: string;
  need?: Need;
  zip?: string;
  parent_id?: string;
  created_date?: string;
}

/** Trim, drop control characters except newlines, cap length. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Replace emails and phone numbers so no one's contact details get stored. */
export function removeContacts(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[…]")
    .replace(/(\+?\(?\d[\d\s().-]{6,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[…]" : m));
}

function toPublic(p: CommunityPost): PublicPost {
  return {
    id: p.id,
    kind: p.kind,
    body: p.body,
    ...(p.need ? { need: p.need } : {}),
    ...(p.zip ? { zip: p.zip } : {}),
    ...(p.parent_id ? { parent_id: p.parent_id } : {}),
    created_date: p.created_date,
  };
}

export async function community(req: Request, body: Body) {
  const action = typeof body.action === "string" ? body.action : "list";
  const db = getDb(req);

  if (action === "list") {
    const rows = await db.CommunityPost.filter({ status: "published" }, "-created_date", LIST_LIMIT);
    return { posts: rows.map(toPublic) };
  }

  if (action === "post") {
    const lang = langOf(body.ui_language ?? "es");
    // Honeypot: people never see "website". Bots get a normal-looking answer and nothing is stored.
    if (typeof body.website === "string" && body.website.trim()) return { ok: true, message: MSG[lang].posted };

    const text = cleanText(body.body, MAX_BODY);
    if (text.length < MIN_BODY) throw new HttpError(400, MSG[lang].short);
    if (mentionsStatus(text)) throw new HttpError(400, MSG[lang].status);

    let kind: CommunityKind = body.kind === "correction" ? "correction" : "question";
    let parent_id: string | undefined;
    if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== "") {
      const pid = String(body.parent_id).slice(0, 64);
      if (!DEMO_PARENT.test(pid)) {
        const parent = await db.CommunityPost.get(pid).catch(() => null);
        if (!parent || parent.status !== "published" || parent.kind === "reply") {
          throw new HttpError(400, "parent_id must be a published post");
        }
      }
      parent_id = pid;
      kind = "reply";
    }

    let need: Need | undefined;
    if (typeof body.need === "string" && body.need) {
      if (!(NEEDS as readonly string[]).includes(body.need)) throw new HttpError(400, `need must be one of: ${NEEDS.join(", ")}`);
      need = body.need as Need;
    }
    let zip: string | undefined;
    if (typeof body.zip === "string" && body.zip.trim()) {
      zip = body.zip.trim();
      if (!/^\d{5}$/.test(zip)) throw new HttpError(400, "zip must be 5 digits");
    }

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    if ((await db.CommunityPost.count({ created_date: { $gte: hourAgo } })) >= MAX_PER_HOUR) {
      throw new HttpError(503, MSG[lang].busy);
    }

    const created = await db.CommunityPost.create({
      kind,
      body: removeContacts(text),
      status: "published",
      ...(need && kind !== "reply" ? { need } : {}),
      ...(zip && kind !== "reply" ? { zip } : {}),
      ...(parent_id ? { parent_id } : {}),
    });
    return { ok: true, message: MSG[lang].posted, post: toPublic(created) };
  }

  if (action === "hide") {
    await requireAdmin(req);
    const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
    if (!id) throw new HttpError(400, "id is required");
    await db.CommunityPost.update(id, { status: "hidden" });
    return { ok: true };
  }

  throw new HttpError(400, "action must be list, post or hide");
}
