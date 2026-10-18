// Admin review queue: approve (optionally with edits) or reject community
// submissions. Approving publishes a Place with trust "community".
import { useCallback, useEffect, useState } from "react";
import { ApiError, approveSubmission, listReports, listSubmissions, rejectSubmission, resolveReports, runCitywideScout } from "../api.ts";
import { AdminGate } from "../components/AdminGate.tsx";
import { useI18n } from "../i18n.tsx";
import { HREF } from "../router.ts";
import { BOROUGHS, ORG_TYPES } from "../types.ts";
import type { ReportGroup, ReviewListResult, Submission, SubmissionEdits } from "../types.ts";

type Status = "pending" | "approved" | "rejected";

export function Admin() {
  const { t } = useI18n();
  return (
    <>
      <section className="intro">
        <h1>{t("adm_title")}</h1>
        <p>{t("adm_intro")}</p>
      </section>
      <AdminGate>{(signOut) => <><Reports signOut={signOut} /><Queue signOut={signOut} /></>}</AdminGate>
    </>
  );
}

function Queue({ signOut }: { signOut: (msg?: string) => void }) {
  const { t, lang } = useI18n();
  const [scouting, setScouting] = useState(false);
  const SC = lang === "en"
    ? { title: "Find new resources across NYC", body: "Tavily searches the web for one topic in one borough (it rotates through all five boroughs and every need). New places land here as pending; nothing goes live until you approve it.", btn: "Search all of NYC now", busy: "Searching the web… (up to a minute)", done: (q: string, n: number, d: number) => `Searched “${q}”: ${n} new drafts, ${d} already known.` }
    : { title: "Buscar nuevos recursos en toda la ciudad", body: "Tavily busca en la web un tema en un condado (va rotando por los cinco condados y todas las necesidades). Los lugares nuevos llegan aquí como pendientes; nada se publica hasta que usted lo apruebe.", btn: "Buscar en todo NYC ahora", busy: "Buscando en la web… (hasta un minuto)", done: (q: string, n: number, d: number) => `Buscamos “${q}”: ${n} borradores nuevos, ${d} ya conocidos.` };
  const [status, setStatus] = useState<Status>("pending");
  const [data, setData] = useState<ReviewListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const onError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return signOut(t("adm_bad_token"));
    if (err instanceof ApiError && err.status === 503) return signOut(t("adm_not_configured"));
    setError(t("error", { msg: err instanceof Error ? err.message : String(err) }));
  }, [signOut, t]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    listSubmissions(status).then(setData).catch(onError).finally(() => setLoading(false));
  }, [status, onError]);

  useEffect(load, [load]);

  const tabs: Array<[Status, string]> = [
    ["pending", t("adm_pending")],
    ["approved", t("adm_approved")],
    ["rejected", t("adm_rejected")],
  ];

  const scout = async () => {
    setScouting(true);
    setError("");
    try {
      const r = await runCitywideScout();
      setFlash(SC.done(r.query, r.drafted, r.skipped_duplicates));
      setStatus("pending");
      load();
    } catch (err) {
      onError(err);
    } finally {
      setScouting(false);
    }
  };

  return (
    <>
      <section className="card ai-fill" aria-labelledby="scout-title">
        <h2 id="scout-title">{SC.title}</h2>
        <p className="muted small">{SC.body}</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={scout} disabled={scouting}>{scouting ? SC.busy : SC.btn}</button>
        </div>
      </section>
      <div className="tabs" role="tablist">
        {tabs.map(([s, name]) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className="tab" onClick={() => setStatus(s)}>
            {name}{data ? ` (${data.counts[s]})` : ""}
          </button>
        ))}
        <button type="button" className="btn btn-link" onClick={load}>{t("refresh")}</button>
      </div>

      {flash && <p className="notice success" role="status">{flash}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">{t("loading")}</p>}
      {!loading && data && data.submissions.length === 0 && <p className="card empty">{t("adm_empty")}</p>}

      <div className="results">
        {data?.submissions.map((s) => (
          <SubmissionCard
            key={s.id}
            sub={s}
            onDone={(msg) => {
              setFlash(msg);
              load();
            }}
            onError={onError}
          />
        ))}
      </div>
    </>
  );
}

const EDIT_FIELDS = ["name", "org", "address", "zip", "hours", "phone", "source_url"] as const;

function SubmissionCard({ sub, onDone, onError }: {
  sub: Submission;
  onDone: (msg: string) => void;
  onError: (err: unknown) => void;
}) {
  const { t, label, date } = useI18n();
  const pending = sub.status === "pending";
  const [edits, setEdits] = useState<Record<string, string>>(() => ({
    name: sub.name ?? "", org: sub.org ?? "", org_type: sub.org_type ?? "other", address: sub.address ?? "",
    borough: sub.borough ?? "", zip: sub.zip ?? "", hours: sub.hours ?? "", phone: sub.phone ?? "",
    source_url: sub.source_url ?? "", languages: (sub.languages ?? []).join(", "),
  }));
  const [busy, setBusy] = useState(false);

  const fieldLabels: Record<string, string> = {
    name: t("sub_name"), org: t("sub_org"), address: t("sub_address"), zip: t("sub_zip"),
    hours: t("sub_hours"), phone: t("sub_phone"), source_url: t("sub_source"),
  };

  /** Only the fields the reviewer actually changed. */
  const changed = (): SubmissionEdits => {
    const out: Record<string, unknown> = {};
    for (const k of [...EDIT_FIELDS, "org_type", "borough"] as const) {
      const before = (sub as unknown as Record<string, string | undefined>)[k] ?? (k === "org_type" ? "other" : "");
      if (edits[k] !== before) out[k] = edits[k];
    }
    const langs = edits.languages.split(/[,\s]+/).filter(Boolean);
    if (langs.join(",") !== (sub.languages ?? []).join(",")) out.languages = langs;
    return out as SubmissionEdits;
  };

  const approve = async () => {
    setBusy(true);
    try {
      const res = await approveSubmission(sub.id, changed());
      onDone(t("adm_approved_as", { id: res.place?.id ?? "" }));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!window.confirm(t("adm_reject_confirm"))) return;
    setBusy(true);
    try {
      await rejectSubmission(sub.id);
      onDone(t("adm_rejected_ok"));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card submission">
      <div className="place-head">
        <div>
          <h3>{sub.name}</h3>
          {sub.created_date && <p className="muted small">{t("adm_submitted", { date: date(sub.created_date) })}</p>}
        </div>
        <span className={`badge status-${sub.status}`}>{t(`adm_${sub.status}` as "adm_pending")}</span>
      </div>

      {sub.needs && sub.needs.length > 0 && (
        <p><span className="muted">{t("adm_needs")}:</span> {sub.needs.map((n) => label("need", n)).join(", ")}</p>
      )}
      {sub.notes && <p className="notes"><span className="muted">{t("adm_notes")}:</span> {sub.notes}</p>}

      {pending ? (
        <div className="form compact">
          <p className="hint">{t("adm_edit_hint")}</p>
          {EDIT_FIELDS.map((k) => (
            <label key={k} className="field">
              <span>{fieldLabels[k]}</span>
              <input value={edits[k]} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
            </label>
          ))}
          <div className="row">
            <label className="field">
              <span>{t("sub_org_type")}</span>
              <select value={edits.org_type} onChange={(e) => setEdits({ ...edits, org_type: e.target.value })}>
                {ORG_TYPES.map((o) => <option key={o} value={o}>{label("org", o)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("sub_borough")}</span>
              <select value={edits.borough} onChange={(e) => setEdits({ ...edits, borough: e.target.value })}>
                <option value="">{t("sub_borough_pick")}</option>
                {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>{t("sub_languages")}</span>
            <input value={edits.languages} onChange={(e) => setEdits({ ...edits, languages: e.target.value })} aria-describedby={`lh-${sub.id}`} />
            <small id={`lh-${sub.id}`} className="hint">{t("adm_languages_hint")}</small>
          </label>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}>{t("adm_approve")}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={reject}>{t("adm_reject")}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="place-address">{[sub.address, sub.borough, sub.zip].filter(Boolean).join(" · ")}</p>
          {sub.hours && <p className="small">{t("card_hours")}: {sub.hours}</p>}
          {sub.place_id && (
            <p className="small">
              <code>{sub.place_id}</code> · <a href={HREF.directory}>{t("adm_view_place")}</a>
            </p>
          )}
        </>
      )}
    </article>
  );
}

/**
 * "This is wrong" reports from people (Feedback), grouped by place. A person calls or checks the
 * source, fixes the place if needed, then resolves: "Still correct" also marks it checked today.
 */
function Reports({ signOut }: { signOut: (msg?: string) => void }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const S = en
    ? { title: "Reports from people", none: "No open reports.", body: "Someone said these places have wrong information. While a report is open, answers tell people to call first.", ok: "Checked: still correct", fixed: "Fixed / close report", source: "Source", checked: "last checked" }
    : { title: "Reportes de la gente", none: "No hay reportes abiertos.", body: "Alguien dijo que estos lugares tienen información equivocada. Mientras un reporte está abierto, las respuestas dicen que llamen antes de ir.", ok: "Revisado: sigue bien", fixed: "Corregido / cerrar reporte", source: "Fuente", checked: "revisado" };
  const [reports, setReports] = useState<ReportGroup[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listReports().then((r) => setReports(r.reports)).catch((err) => {
      if (err instanceof ApiError && err.status === 401) return signOut();
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [signOut]);
  useEffect(load, [load]);
  const resolve = async (id: string, confirmed: boolean) => {
    try {
      await resolveReports(id, confirmed);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!reports) return null;
  return (
    <section className="card" aria-labelledby="reports-title" style={{ marginBottom: 16 }}>
      <h2 id="reports-title">{S.title} ({reports.length})</h2>
      <p className="muted small">{S.body}</p>
      {!reports.length && <p className="muted">{S.none}</p>}
      {reports.map((r) => (
        <article key={r.place_id} className="card" style={{ marginTop: 8 }}>
          <strong>{r.name}</strong>
          <p className="small">{r.address}{r.phone ? ` · ${r.phone}` : ""}{r.hours ? ` · ${r.hours}` : ""}</p>
          <p className="small muted">
            {Object.entries(r.issues).map(([k, v]) => `${k} ×${v}`).join(", ")} · {S.checked} {r.last_checked}
            {r.source_url.startsWith("http") && <> · <a href={r.source_url} target="_blank" rel="noopener noreferrer">{S.source}</a></>}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => resolve(r.place_id, true)}>{S.ok}</button>
            <button type="button" className="btn btn-link" onClick={() => resolve(r.place_id, false)}>{S.fixed}</button>
          </div>
        </article>
      ))}
    </section>
  );
}
