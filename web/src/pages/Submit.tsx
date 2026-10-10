// Public form: suggest a resource. It becomes a pending Submission; nothing
// is published until a person approves it in the review queue.
import { useState } from "react";
import type { FormEvent } from "react";
import { submitResource } from "../api.ts";
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
