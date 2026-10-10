// "What we know / Lo que sabemos": one honest panel per place. It uses only
// fields the backend already returns (hours, languages, phone, address, trust,
// source_url, last_checked). An official listing is never called hand-verified;
// only trust "verified" means a person on our team confirmed it by phone.
import { useI18n } from "../i18n.tsx";
import type { DirectoryPlace } from "../types.ts";

const REPORT_URL = "https://inmigracion-nyc.com/#/submit";

/** Questions to ask when you call, Spanish first so the caller can read either aloud. */
const ASK: Array<[string, string]> = [
  ["¿Están abiertos hoy y a qué hora?", "Are you open today, and what hours?"],
  ["¿Hay alguien que hable español?", "Is there someone who speaks Spanish?"],
  ["¿Necesito cita o puedo llegar sin cita?", "Do I need an appointment, or can I walk in?"],
  ["¿Qué debo traer?", "What should I bring?"],
  ["¿Tiene algún costo?", "Is there any cost?"],
];

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function WhatWeKnow({ place }: { place: DirectoryPlace }) {
  const { t, label, date, lang } = useI18n();
  const tel = place.phone.replace(/[^\d+]/g, "");
  const trustKey = (["official", "verified", "community", "unverified"].includes(place.trust) ? place.trust : "unverified") as
    "official" | "verified" | "community" | "unverified";
  const isWeb = /^https?:\/\//i.test(place.source_url);

  const facts: Array<[string, string]> = [
    [t("know_hours"), place.hours],
    [t("know_language"), place.languages.map((l) => label("lang", l)).join(", ")],
    [t("know_phone"), place.phone],
    [t("know_address"), place.address],
  ];

  return (
    <details className="know" data-testid="what-we-know">
      <summary>{t("know_title")}</summary>
      <div className="know-body">
        <p className="small">
          <span className="muted">{t("know_source")}:</span>{" "}
          {isWeb ? <a href={place.source_url} target="_blank" rel="noopener noreferrer">{host(place.source_url)}</a> : t("card_source_community")}
          {" · "}
          <span className="muted">{t("know_checked")}:</span> {place.last_checked ? date(place.last_checked) : t("know_unknown_short")}
        </p>

        <table className="know-facts">
          <tbody>
            {facts.map(([name, value]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{value ? <><span className="know-stated">{t("know_stated")}:</span> {value}</> : <span className="know-unknown">{t("know_unknown")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className={`know-trust trust-${trustKey}`}>
          <strong>{t("know_how")}:</strong> {t(`know_trust_${trustKey}`)}
        </p>

        <p className="small">
          <strong>{t("know_next")}:</strong>{" "}
          {tel ? <>{t("know_call_first")} <a href={`tel:${tel}`}>{place.phone}</a>.</> : t("know_no_phone")}
        </p>
        <ol className="know-ask">
          {ASK.map(([es, en]) => (
            <li key={en}>
              {lang === "es" ? <>{es} <span className="muted" lang="en">/ {en}</span></> : <>{en} <span className="muted" lang="es">/ {es}</span></>}
            </li>
          ))}
        </ol>

        <p className="small">
          <a className="btn btn-secondary" href={REPORT_URL}>{t("know_report")}</a>
          <span className="muted"> {t("know_report_hint")}</span>
        </p>
      </div>
    </details>
  );
}
