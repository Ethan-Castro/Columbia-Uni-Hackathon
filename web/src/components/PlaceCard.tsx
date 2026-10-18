// One place in the directory: what it is, when it is open, what to bring,
// how much to trust it, and where the information came from.
import { useState } from "react";
import { reportFeedback } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import type { DirectoryPlace, FeedbackIssue } from "../types.ts";

export function TrustBadge({ trust }: { trust: string }) {
  const { label } = useI18n();
  return <span className={`badge trust-${trust}`}>{label("trust", trust)}</span>;
}

function isWebUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

export function PlaceCard({ place }: { place: DirectoryPlace }) {
  const { t, label, date, lang } = useI18n();
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`;
  const tel = place.phone.replace(/[^\d+]/g, "");

  let openPill: { text: string; cls: string } | null = null;
  if (place.open_now === true) openPill = { text: t("open_now"), cls: "pill-open" };
  else if (place.open_today === true) openPill = { text: t("open_today"), cls: "pill-later" };
  else if (place.open_now === false) openPill = { text: t("closed_now"), cls: "pill-closed" };

  return (
    <article className="card place">
      <div className="place-head">
        <div>
          <h3>{place.name}</h3>
          <p className="muted">
            {label("org", place.org_type)}
            {place.org && place.org !== place.name ? ` · ${place.org}` : ""}
            {place.org_locations ? ` · ${lang === "en" ? `${place.org_locations} locations` : `${place.org_locations} sedes`}` : ""}
          </p>
        </div>
        <TrustBadge trust={place.trust} />
      </div>

      {place.check_first && <p className="small status-advice" role="note">⚠ {place.check_first}</p>}

      <p className="place-address">
        {place.address}
        {place.address && (
          <>
            {" "}
            <a href={mapUrl} target="_blank" rel="noopener noreferrer">{t("card_map")}</a>
          </>
        )}
      </p>

      <dl className="facts">
        <div>
          <dt>{t("card_hours")}</dt>
          <dd>
            {place.hours || t("hours_unknown")}
            <span className="pills">
              {openPill && <span className={`pill ${openPill.cls}`}>{openPill.text}</span>}
              {place.open_evenings && <span className="pill">{t("open_evenings")}</span>}
              {place.open_weekends && <span className="pill">{t("open_weekends")}</span>}
            </span>
          </dd>
        </div>
        {place.languages.length > 0 && (
          <div>
            <dt>{t("card_languages")}</dt>
            <dd>{place.languages.map((l) => label("lang", l)).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>{t("card_bring")}</dt>
          <dd>
            {/* Spanish: the document list the graph reads from the (English) source text; the full text stays one tap away. */}
            {lang !== "en" && place.documents?.length
              ? (
                <>
                  <ul className="bring">{place.documents.map((d) => <li key={d}>{d}</li>)}</ul>
                  <details className="small"><summary className="muted">Texto original (inglés)</summary>
                    <ul className="bring">{place.bring.map((b) => <li key={b} lang="en">{b}</li>)}</ul>
                  </details>
                </>
              )
              : place.bring.length
              ? <ul className="bring">{place.bring.map((b) => <li key={b} lang="en">{b}</li>)}</ul>
              : <span className="muted">{t("card_bring_unknown")}</span>}
          </dd>
        </div>
      </dl>

      {place.programs.length > 0 && (
        <details className="programs">
          <summary>{t("card_programs")} ({place.programs.length})</summary>
          <ul>
            {place.programs.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                <p>{(lang === "en" ? p.summary_en : p.summary_es) || p.summary}</p>
                {p.who_can_use && <p className="small"><span className="muted">{t("card_who")}:</span> <span lang="en">{p.who_can_use}</span></p>}
                {p.status_note && <p className="small"><span className="muted">{t("card_note")}:</span> <span lang="en">{p.status_note}</span></p>}
                {p.status_dependent && <p className="small status-advice">{t("card_status_advice")}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="place-foot">
        {tel && <a className="btn btn-secondary" href={`tel:${tel}`}>{t("card_phone")} {place.phone}</a>}
        <p className="source">
          {isWebUrl(place.source_url)
            ? <a href={place.source_url} target="_blank" rel="noopener noreferrer">{t("card_source")}</a>
            : <span>{t("card_source")}: {t("card_source_community")}</span>}
          {place.last_checked && <> · {t("card_checked", { date: date(place.last_checked) })}</>}
        </p>
      </div>
      <FeedbackRow placeId={place.id} />
    </article>
  );
}

const ISSUES: FeedbackIssue[] = ["closed", "wrong_hours", "wrong_phone", "wrong_address", "turned_away", "other"];
const FB = {
  es: {
    ask: "¿Le sirvió?", yes: "Sí", no: "No", wrong: "Algo está mal", pick: "¿Qué está mal?",
    issues: { closed: "Cerró o ya no está", wrong_hours: "Otro horario", wrong_phone: "Teléfono equivocado", wrong_address: "Dirección equivocada", turned_away: "No me atendieron", other: "Otra cosa" },
    privacy: "Anónimo: no guardamos nombres ni teléfonos.",
  },
  en: {
    ask: "Did this help?", yes: "Yes", no: "No", wrong: "Something is wrong", pick: "What is wrong?",
    issues: { closed: "Closed or gone", wrong_hours: "Different hours", wrong_phone: "Wrong phone", wrong_address: "Wrong address", turned_away: "They turned me away", other: "Something else" },
    privacy: "Anonymous: we never keep names or phone numbers.",
  },
};

/** "Did this help?" with one tap; "something is wrong" opens fixed choices (no free text, ever). */
function FeedbackRow({ placeId }: { placeId: string }) {
  const { lang } = useI18n();
  const S = FB[lang === "en" ? "en" : "es"];
  const [state, setState] = useState<"idle" | "pick" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");
  const send = async (input: { helpful?: boolean; issue?: FeedbackIssue }) => {
    setState("sending");
    try {
      const r = await reportFeedback({ place_id: placeId, language: lang, ...input });
      setMessage(r.message);
    } catch {
      setMessage(lang === "en" ? "Could not send. Please try again later." : "No se pudo enviar. Intente más tarde.");
    }
    setState("done");
  };
  if (state === "done") return <p className="small muted feedback-row" role="status">{message}</p>;
  return (
    <div className="feedback-row small">
      {state === "pick"
        ? (
          <>
            <span className="muted">{S.pick}</span>{" "}
            {ISSUES.map((i) => (
              <button key={i} type="button" className="btn btn-link" onClick={() => send({ issue: i })}>{S.issues[i]}</button>
            ))}
          </>
        )
        : (
          <>
            <span className="muted">{S.ask}</span>{" "}
            <button type="button" className="btn btn-link" disabled={state === "sending"} onClick={() => send({ helpful: true })}>{S.yes}</button>
            <button type="button" className="btn btn-link" disabled={state === "sending"} onClick={() => send({ helpful: false })}>{S.no}</button>
            <button type="button" className="btn btn-link" disabled={state === "sending"} onClick={() => setState("pick")}>{S.wrong}</button>
          </>
        )}
      <span className="muted"> · {S.privacy}</span>
    </div>
  );
}
