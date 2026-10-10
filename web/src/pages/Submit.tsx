// Public form: suggest a resource. It becomes a pending Submission; nothing
// is published until a person approves it in the review queue.
import { useState } from "react";
import type { FormEvent } from "react";
import { draftResource, submitResource } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { HREF } from "../router.ts";
import { BOROUGHS, LANGUAGE_CODES, NEEDS, ORG_TYPES } from "../types.ts";

const EMPTY = {
  name: "", org: "", org_type: "", address: "", borough: "", zip: "", hours: "",
  phone: "", source_url: "", notes: "", website: "",
};

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function Submit() {
  const { t, label, lang } = useI18n();
  const [f, setF] = useState(EMPTY);
  const [needs, setNeeds] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["es"]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState("");

  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const AI = lang === "en"
    ? { title: "Have a link or a flyer?", body: "Paste a web link or the text of a flyer or post. AI fills in the form below; you check it before sending.", ph: "https://... or paste the text here", btn: "Fill in the form with AI", busy: "Reading…", ok: "Done. Check every field below before you send it.", err: "We couldn't fill it in. Please type it in below." }
    : { title: "¿Tiene un enlace o un volante?", body: "Pegue un enlace o el texto de un volante o una publicación. La IA llena el formulario de abajo; usted lo revisa antes de enviarlo.", ph: "https://... o pegue el texto aquí", btn: "Llenar el formulario con IA", busy: "Leyendo…", ok: "Listo. Revise cada campo de abajo antes de enviarlo.", err: "No pudimos llenarlo. Escríbalo abajo, por favor." };

  const fillWithAI = async () => {
    const v = aiInput.trim();
    if (!v) return;
    setAiBusy(true);
    setAiMsg("");
    try {
      const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v);
      const { draft } = await draftResource(isUrl ? { url: v, ui_language: lang } : { text: v, ui_language: lang });
      setF({
        ...f,
        name: draft.name || f.name, org: draft.org || f.org, org_type: draft.org_type || f.org_type,
        address: draft.address || f.address, borough: draft.borough || f.borough, zip: draft.zip || f.zip,
        hours: draft.hours || f.hours, phone: draft.phone || f.phone, source_url: draft.source_url || f.source_url,
      });
      if (draft.needs.length) setNeeds(draft.needs);
      if (draft.languages.length) setLanguages(draft.languages);
      setAiMsg(AI.ok);
    } catch (err) {
      setAiMsg(err instanceof Error && err.message && err.message !== "network" ? err.message : AI.err);
    } finally {
      setAiBusy(false);
    }
  };

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.address.trim()) {
      setError(t("sub_missing"));
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await submitResource({ ...f, needs, languages, ui_language: lang });
      setThanks(res.message);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(`${t("sub_error")} ${err instanceof Error && err.message !== "network" ? err.message : ""}`.trim());
    } finally {
      setSending(false);
    }
  };

  if (thanks) {
    return (
      <section className="card thanks" role="status">
        <h1>{t("sub_thanks_title")}</h1>
        <p>{thanks}</p>
        <p className="muted">{t("sub_thanks_human")}</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => {
            setF(EMPTY);
            setNeeds([]);
            setLanguages(["es"]);
            setThanks("");
          }}>{t("sub_another")}</button>
          <a className="btn btn-secondary" href={HREF.directory}>{t("sub_back")}</a>
        </div>
      </section>
    );
  }

  const req = <span className="req"> ({t("sub_required")})</span>;

  return (
    <>
      <section className="intro">
        <h1>{t("sub_title")}</h1>
        <p>{t("sub_intro")}</p>
        <p className="notice">{t("sub_privacy")}</p>
      </section>

      <section className="card ai-fill" aria-labelledby="ai-fill-title">
        <h2 id="ai-fill-title">{AI.title}</h2>
        <p className="muted small">{AI.body}</p>
        <label className="field">
          <span className="sr-only">{AI.ph}</span>
          <textarea value={aiInput} onChange={(e) => setAiInput(e.target.value)} placeholder={AI.ph} rows={3} maxLength={12000} />
        </label>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={fillWithAI} disabled={aiBusy || !aiInput.trim()}>
            {aiBusy ? AI.busy : AI.btn}
          </button>
        </div>
        <p className="hint" role="status" aria-live="polite">{aiMsg}</p>
      </section>

      <form className="card form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>{t("sub_name")}{req}</span>
          <input value={f.name} onChange={set("name")} maxLength={120} required autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("sub_org")}</span>
          <input value={f.org} onChange={set("org")} maxLength={120} autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("sub_org_type")}</span>
          <select value={f.org_type} onChange={set("org_type")}>
            <option value="">{t("sub_borough_pick")}</option>
            {ORG_TYPES.map((o) => <option key={o} value={o}>{label("org", o)}</option>)}
          </select>
        </label>

        <fieldset className="field">
          <legend>{t("sub_needs")}</legend>
          <div className="chips wrap">
            {NEEDS.map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={needs.includes(n)} onClick={() => setNeeds(toggle(needs, n))}>
                {label("need", n)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>{t("sub_address")}{req}</span>
          <input value={f.address} onChange={set("address")} maxLength={200} required autoComplete="off" aria-describedby="addr-hint" />
          <small id="addr-hint" className="hint">{t("sub_address_hint")}</small>
        </label>
        <div className="row">
          <label className="field">
            <span>{t("sub_borough")}</span>
            <select value={f.borough} onChange={set("borough")}>
              <option value="">{t("sub_borough_pick")}</option>
              {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t("sub_zip")}</span>
            <input value={f.zip} onChange={set("zip")} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="off" />
          </label>
        </div>
        <label className="field">
          <span>{t("sub_hours")}</span>
          <input value={f.hours} onChange={set("hours")} maxLength={200} aria-describedby="hours-hint" />
          <small id="hours-hint" className="hint">{t("sub_hours_hint")}</small>
        </label>

        <fieldset className="field">
          <legend>{t("sub_languages")}</legend>
          <div className="chips wrap">
            {LANGUAGE_CODES.map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={languages.includes(l)} onClick={() => setLanguages(toggle(languages, l))}>
                {label("lang", l)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>{t("sub_phone")}</span>
          <input value={f.phone} onChange={set("phone")} type="tel" maxLength={30} autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("sub_source")}</span>
          <input value={f.source_url} onChange={set("source_url")} type="url" inputMode="url" maxLength={500} placeholder="https://" autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("sub_notes")}</span>
          <textarea value={f.notes} onChange={set("notes")} maxLength={1000} rows={3} aria-describedby="notes-hint" />
          <small id="notes-hint" className="hint">{t("sub_notes_hint")}</small>
        </label>

        {/* Honeypot: hidden from people and screen readers; bots fill it. */}
        <div className="hp" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
          </label>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
          {sending ? t("sub_sending") : t("sub_send")}
        </button>
      </form>
    </>
  );
}
