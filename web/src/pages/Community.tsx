// Community page: neighbors ask local questions (including housing) and point
// out directory corrections. Discussion only: a post never becomes a directory
// result. Tips go through "Suggest a resource" -> pending review -> a person
// approves -> directory. Built-in examples are clearly labeled synthetic.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getAdminToken, hideCommunityPost, listCommunityPosts, postToCommunity } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import type { Lang } from "../i18n.tsx";
import { HREF } from "../router.ts";
import { NEEDS } from "../types.ts";
import type { CommunityPost, Need } from "../types.ts";

const STR = {
  es: {
    title: "Comunidad de Corona",
    intro: "Haga preguntas sobre su barrio (vivienda, comida, escuela, trabajo) y avise si algo del directorio está mal. Sus vecinos responden.",
    pin_title: "Cómo funcionan los datos de recursos",
    pin_body: "¿Conoce una despensa, clínica u oficina de ayuda legal que falta en el directorio, o un lugar con horario o dirección equivocada?",
    pin_cta: "Sugerir un recurso",
    pin_steps: [
      "Su dato entra en la lista de revisión como pendiente.",
      "Una persona lo revisa con una fuente.",
      "Solo un dato revisado y aprobado puede salir en el directorio.",
    ],
    pin_note: "Los mensajes de esta página son conversación entre vecinos. No se agregan a la búsqueda del directorio.",
    privacy: "No escriba nombres, teléfonos ni nada sobre estatus migratorio. Quitamos teléfonos y correos antes de publicar.",
    new_title: "Escribir un mensaje",
    kind_question: "Pregunta",
    kind_correction: "Corrección",
    kind_reply: "Respuesta",
    need: "Tema (opcional)",
    need_none: "Sin tema",
    zip: "Código postal (opcional)",
    body: "Su mensaje",
    body_ph_question: "Ej.: ¿Dónde dan ayuda gratis con problemas de vivienda en Queens?",
    body_ph_correction: "Ej.: La despensa de la Roosevelt Ave ahora abre los sábados de 9 a 11am.",
    correction_hint: "Para cambiar el directorio, mande también el dato en",
    send: "Publicar",
    sending: "Publicando…",
    reply: "Responder",
    reply_ph: "Escriba una respuesta",
    cancel: "Cancelar",
    synthetic: "Ejemplo sintético: no es una persona real",
    replies: (n: number) => (n === 1 ? "1 respuesta" : `${n} respuestas`),
    hide: "Ocultar",
    unavailable: "Por ahora solo se ven los ejemplos. Los mensajes nuevos se abren cuando la función de comunidad esté publicada.",
    error: "No pudimos publicar.",
  },
  en: {
    title: "Corona community",
    intro: "Ask questions about your neighborhood (housing, food, school, work) and tell us when something in the directory is wrong. Neighbors answer.",
    pin_title: "How resource tips work",
    pin_body: "Know a food pantry, clinic or legal help office that is missing from the directory, or a place with the wrong hours or address?",
    pin_cta: "Suggest a resource",
    pin_steps: [
      "Your tip goes into the review queue as pending.",
      "A person checks it against a source.",
      "Only a reviewed, approved tip can become a directory result.",
    ],
    pin_note: "Posts on this page are conversations between neighbors. They are not added to directory search.",
    privacy: "Don't include names, phone numbers or anything about immigration status. We remove phone numbers and emails before posting.",
    new_title: "Write a post",
    kind_question: "Question",
    kind_correction: "Correction",
    kind_reply: "Reply",
    need: "Topic (optional)",
    need_none: "No topic",
    zip: "Zip code (optional)",
    body: "Your post",
    body_ph_question: "E.g.: Where can I get free help with a housing problem in Queens?",
    body_ph_correction: "E.g.: The pantry on Roosevelt Ave now opens Saturdays 9 to 11am.",
    correction_hint: "To change the directory, also send it through",
    send: "Post",
    sending: "Posting…",
    reply: "Reply",
    reply_ph: "Write a reply",
    cancel: "Cancel",
    synthetic: "Synthetic example: not a real person",
    replies: (n: number) => (n === 1 ? "1 reply" : `${n} replies`),
    hide: "Hide",
    unavailable: "Only the examples show for now. New posts open once the community function is published.",
    error: "We couldn't post that.",
  },
};

/** Built-in demo posts, always labeled synthetic. Ids start with "demo-" so real replies can attach to them. */
const DEMO: Array<{ id: string; kind: CommunityPost["kind"]; need?: Need; zip?: string; parent_id?: string; text: Record<Lang, string> }> = [
  {
    id: "demo-housing",
    kind: "question",
    need: "housing",
    zip: "11368",
    text: {
      es: "Mi casero en Corona dice que me tengo que ir a fin de mes, pero nunca me dio ningún aviso por escrito. ¿Alguien sabe dónde dan ayuda gratis en Queens? Hablo español.",
      en: "My landlord in Corona says I have to leave by the end of the month, but he never gave me any written notice. Does anyone know where I can get free help in Queens? I speak Spanish.",
    },
  },
  {
    id: "demo-housing-r1",
    kind: "reply",
    parent_id: "demo-housing",
    text: {
      es: "En \"Buscar\" > Vivienda salen lugares con ayuda gratis. También puede llamar al 311 y pedir ayuda para inquilinos.",
      en: "Under \"Search\" > Housing you'll find places with free help. You can also call 311 and ask for tenant help.",
    },
  },
  {
    id: "demo-correction",
    kind: "correction",
    need: "food",
    zip: "11368",
    text: {
      es: "La despensa de la Roosevelt Ave parece tener nuevo horario los sábados (¿de 9 a 11am?). Lo mandé en \"Sugerir un recurso\" para que alguien lo revise antes de cambiar el directorio.",
      en: "The pantry on Roosevelt Ave seems to have new Saturday hours (9 to 11am?). I sent it through \"Suggest a resource\" so someone checks it before the directory changes.",
    },
  },
  {
    id: "demo-school",
    kind: "question",
    need: "school",
    zip: "11368",
    text: {
      es: "¿Alguien sabe de clases de inglés gratis para adultos en la noche cerca de Junction Blvd?",
      en: "Does anyone know of free evening English classes for adults near Junction Blvd?",
    },
  },
];

function demoPosts(lang: Lang): CommunityPost[] {
  return DEMO.map(({ text, ...p }) => ({ ...p, body: text[lang], synthetic: true }));
}

function when(iso: string | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Community() {
  const { lang } = useI18n();
  const s = STR[lang];
  const [live, setLive] = useState<CommunityPost[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const isAdmin = !!getAdminToken();

  const load = useCallback(() => {
    listCommunityPosts()
      .then((r) => {
        setLive(r.posts);
        setAvailable(true);
      })
      .catch(() => setAvailable(false))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const all = [...live, ...demoPosts(lang)];
  const top = all.filter((p) => p.kind !== "reply");
  const repliesTo = (id: string) =>
    all.filter((p) => p.kind === "reply" && p.parent_id === id)
      .sort((a, b) => (a.synthetic === b.synthetic ? (a.created_date ?? "").localeCompare(b.created_date ?? "") : a.synthetic ? -1 : 1));

  const hide = async (id: string) => {
    await hideCommunityPost(id).catch(() => {});
    load();
  };

  return (
    <>
      <section className="intro">
        <h1>{s.title}</h1>
        <p>{s.intro}</p>
      </section>

      <section className="card community-pin" aria-labelledby="pin-title">
        <h2 id="pin-title"><span aria-hidden="true">📌 </span>{s.pin_title}</h2>
        <p>{s.pin_body}</p>
        <div className="actions">
          <a className="btn btn-primary" href={HREF.submit}>{s.pin_cta}</a>
        </div>
        <ol className="community-steps">
          {s.pin_steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p className="muted small">{s.pin_note}</p>
      </section>

      {!loading && !available && <p className="notice">{s.unavailable}</p>}
      {available && !loading && <Composer onPosted={load} />}

      <section className="community-feed" aria-label={s.title}>
        {top.map((p) => (
          <PostCard key={p.id} post={p} replies={repliesTo(p.id)} canReply={available} isAdmin={isAdmin} onHide={hide} onPosted={load} />
        ))}
      </section>
    </>
  );
}

function KindPill({ kind }: { kind: CommunityPost["kind"] }) {
  const { lang } = useI18n();
  const s = STR[lang];
  const text = kind === "correction" ? s.kind_correction : kind === "reply" ? s.kind_reply : s.kind_question;
  return <span className={`pill ${kind === "correction" ? "pill-later" : ""}`}>{text}</span>;
}

function PostCard({ post, replies, canReply, isAdmin, onHide, onPosted }: {
  post: CommunityPost;
  replies: CommunityPost[];
  canReply: boolean;
  isAdmin: boolean;
  onHide: (id: string) => void;
  onPosted: () => void;
}) {
  const { lang, label } = useI18n();
  const s = STR[lang];
  const [replying, setReplying] = useState(false);

  return (
    <article className="card community-post">
      {post.synthetic && <p className="community-synthetic">{s.synthetic}</p>}
      <div className="community-meta">
        <KindPill kind={post.kind} />
        {post.need && <span className="pill">{label("need", post.need)}</span>}
        {post.zip && <span className="pill">{post.zip}</span>}
        {!post.synthetic && <span className="muted small">{when(post.created_date, lang)}</span>}
        {isAdmin && !post.synthetic && (
          <button type="button" className="btn btn-link small" onClick={() => onHide(post.id)}>{s.hide}</button>
        )}
      </div>
      <p className="community-body">{post.body}</p>
      {post.kind === "correction" && (
        <p className="hint">{s.correction_hint} <a href={HREF.submit}>{s.pin_cta}</a>.</p>
      )}

      {replies.length > 0 && (
        <div className="community-replies" aria-label={s.replies(replies.length)}>
          {replies.map((r) => (
            <div key={r.id} className="community-reply">
              {r.synthetic && <p className="community-synthetic">{s.synthetic}</p>}
              <p className="community-body">{r.body}</p>
              <div className="community-meta">
                {!r.synthetic && <span className="muted small">{when(r.created_date, lang)}</span>}
                {isAdmin && !r.synthetic && (
                  <button type="button" className="btn btn-link small" onClick={() => onHide(r.id)}>{s.hide}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canReply && (replying
        ? <Composer parentId={post.id} onPosted={() => { setReplying(false); onPosted(); }} onCancel={() => setReplying(false)} />
        : <button type="button" className="btn btn-link" onClick={() => setReplying(true)}>{s.reply}</button>)}
    </article>
  );
}

function Composer({ parentId, onPosted, onCancel }: { parentId?: string; onPosted: () => void; onCancel?: () => void }) {
  const { lang, label } = useI18n();
  const s = STR[lang];
  const [kind, setKind] = useState<"question" | "correction">("question");
  const [need, setNeed] = useState("");
  const [zip, setZip] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isReply = !!parentId;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await postToCommunity(isReply
        ? { body, parent_id: parentId, website, ui_language: lang }
        : { kind, body, need: need || undefined, zip: zip.trim() || undefined, website, ui_language: lang });
      setBody("");
      setNeed("");
      setZip("");
      setMsg({ ok: true, text: res.message });
      onPosted();
    } catch (err) {
      setMsg({ ok: false, text: `${s.error} ${err instanceof Error && err.message !== "network" ? err.message : ""}`.trim() });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={isReply ? "community-reply-form form" : "card form community-compose"} onSubmit={onSubmit} noValidate>
      {!isReply && <h2>{s.new_title}</h2>}
      {!isReply && (
        <div className="chips wrap" role="group" aria-label={s.new_title}>
          {(["question", "correction"] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "question" ? s.kind_question : s.kind_correction}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span className={isReply ? "sr-only" : undefined}>{isReply ? s.reply_ph : s.body}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={isReply ? 2 : 4}
          maxLength={1000}
          placeholder={isReply ? s.reply_ph : kind === "correction" ? s.body_ph_correction : s.body_ph_question}
        />
      </label>
      {!isReply && kind === "correction" && (
        <p className="hint">{s.correction_hint} <a href={HREF.submit}>{s.pin_cta}</a>.</p>
      )}
      {!isReply && (
        <div className="community-row">
          <label className="field">
            <span>{s.need}</span>
            <select value={need} onChange={(e) => setNeed(e.target.value)}>
              <option value="">{s.need_none}</option>
              {NEEDS.map((n) => <option key={n} value={n}>{label("need", n)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{s.zip}</span>
            <input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" maxLength={5} autoComplete="off" />
          </label>
        </div>
      )}
      {/* Honeypot: hidden from people, bots fill it in. */}
      <label className="sr-only" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      {!isReply && <p className="hint">{s.privacy}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={sending || !body.trim()}>{sending ? s.sending : isReply ? s.reply : s.send}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{s.cancel}</button>}
      </div>
      {msg && <p className={msg.ok ? "notice success" : "error"} role="status" aria-live="polite">{msg.text}</p>}
    </form>
  );
}
