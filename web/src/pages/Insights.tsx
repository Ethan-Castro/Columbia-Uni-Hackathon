// Admin insights over anonymous RequestLog rows: requests by need, unmet by
// zip, language and channel mix. Clearly labeled as test traffic.
import { useCallback, useEffect, useState } from "react";
import { ApiError, getInsights } from "../api.ts";
import { AdminGate } from "../components/AdminGate.tsx";
import { BarChart } from "../components/BarChart.tsx";
import { useI18n } from "../i18n.tsx";
import type { Insights } from "../types.ts";

export function InsightsPage() {
  const { t } = useI18n();
  return (
    <>
      <p className="test-banner" role="note">
        <strong>{t("ins_test")}</strong> · {t("ins_test_note")}
      </p>
      <section className="intro">
        <h1>{t("ins_title")}</h1>
        <p className="muted">{t("ins_privacy")}</p>
      </section>
      <AdminGate>{(signOut) => <Dashboard signOut={signOut} />}</AdminGate>
    </>
  );
}

function Dashboard({ signOut }: { signOut: (msg?: string) => void }) {
  const { t, label, lang } = useI18n();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getInsights()
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return signOut(t("adm_bad_token"));
        if (err instanceof ApiError && err.status === 503) return signOut(t("adm_not_configured"));
        setError(t("error", { msg: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => setLoading(false));
  }, [signOut, t]);

  useEffect(load, [load]);

  if (loading && !data) return <p className="muted">{t("loading")}</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return null;

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const rate = data.total ? Math.round((data.unmet_total / data.total) * 100) : 0;
  const unmetZips = data.unmet_by_zip.filter((z) => z.unmet > 0);

  return (
    <>
      <div className="tabs">
        <button type="button" className="btn btn-link" onClick={load}>{t("refresh")}</button>
      </div>

      <div className="tiles">
        <div className="card tile">
          <span className="tile-label">{t("ins_total")}</span>
          <span className="tile-value">{data.total}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">{t("ins_unmet")}</span>
          <span className="tile-value">{data.unmet_total}</span>
          <span className="tile-sub">{t("ins_unmet_rate", { p: rate })}</span>
        </div>
        <div className="card tile wide">
          <span className="tile-label">{t("ins_period")}</span>
          <span className="tile-sub">{fmt(data.first_at)} → {fmt(data.last_at)}</span>
        </div>
      </div>

      {data.total === 0 ? <p className="card empty">{t("ins_empty")}</p> : (
        <div className="charts">
          <BarChart
            title={t("ins_by_need")}
            rows={data.by_need.map((c) => ({ key: c.key, label: label("need", c.key), value: c.count }))}
          />
          <BarChart
            title={t("ins_unmet_zip")}
            empty={t("ins_none_unmet")}
            rows={unmetZips.map((z) => ({
              key: z.zip || "none",
              label: z.zip || t("ins_no_zip"),
              value: z.unmet,
              valueText: t("ins_unmet_zip_value", { u: z.unmet, t: z.total }),
            }))}
          />
          <BarChart
            title={t("ins_languages")}
            rows={data.languages.map((c) => ({ key: c.key, label: c.key === "unknown" ? t("lang_unknown") : label("lang", c.key), value: c.count }))}
          />
          <BarChart
            title={t("ins_channels")}
            rows={data.channels.map((c) => ({ key: c.key, label: label("channel", c.key), value: c.count }))}
          />
        </div>
      )}

      <GraphSections data={data} />
    </>
  );
}

/** Supply vs demand, feedback and freshness: computed on the server from the knowledge graph. */
function GraphSections({ data }: { data: Insights }) {
  const { label, lang } = useI18n();
  const en = lang === "en";
  const S = en
    ? {
      gaps: "Where we are thin", gapsNote: "Neighborhood + need: places we list inside its zips vs. requests from there. Asked-for and empty first.",
      hood: "Neighborhood", need: "Need", places: "Places", req: "Requests", fb: "Did it help?", yes: "Helpful", no: "Not helpful",
      open: "Open reports", resolved: "Resolved reports", fresh: "Freshness", stale: "Checked > 90 days ago", seasonal: "Seasonal hours",
      noPhone: "No phone", noHours: "No hours", ages: "Days since last check", graph: "Knowledge graph", nodes: "Nodes", edges: "Edges by source",
      issues: "Reports by issue",
    }
    : {
      gaps: "Dónde nos falta", gapsNote: "Barrio + necesidad: lugares dentro de sus códigos postales frente a búsquedas desde ahí. Primero lo que se pidió y no hay.",
      hood: "Barrio", need: "Necesidad", places: "Lugares", req: "Búsquedas", fb: "¿Les sirvió?", yes: "Sí sirvió", no: "No sirvió",
      open: "Reportes abiertos", resolved: "Reportes resueltos", fresh: "Qué tan al día", stale: "Revisados hace más de 90 días", seasonal: "Horario por temporada",
      noPhone: "Sin teléfono", noHours: "Sin horario", ages: "Días desde la última revisión", graph: "Grafo de conocimiento", nodes: "Nodos", edges: "Conexiones por origen",
      issues: "Reportes por tipo",
    };
  const f = data.feedback, fr = data.freshness, g = data.graph;
  return (
    <>
      {f && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{S.fb}</h2>
          <div className="tiles">
            <div className="card tile"><span className="tile-label">{S.yes}</span><span className="tile-value">{f.helpful}</span></div>
            <div className="card tile"><span className="tile-label">{S.no}</span><span className="tile-value">{f.not_helpful}</span></div>
            <div className="card tile"><span className="tile-label">{S.open}</span><span className="tile-value">{f.reports_open}</span></div>
            <div className="card tile"><span className="tile-label">{S.resolved}</span><span className="tile-value">{f.reports_resolved}</span></div>
          </div>
          {f.by_issue.length > 0 && <BarChart title={S.issues} rows={f.by_issue.map((c) => ({ key: c.key, label: c.key, value: c.count }))} />}
        </section>
      )}
      {data.gaps && data.gaps.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{S.gaps}</h2>
          <p className="muted small">{S.gapsNote}</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>{S.hood}</th><th>{S.need}</th><th>{S.places}</th><th>{S.req}</th></tr></thead>
              <tbody>
                {data.gaps.map((x) => (
                  <tr key={`${x.neighborhood}-${x.need}`}>
                    <td>{x.neighborhood}</td><td>{label("need", x.need)}</td><td>{x.places}</td><td>{x.requests}{x.unmet ? ` (${x.unmet} ✗)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {fr && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{S.fresh}</h2>
          <div className="tiles">
            <div className="card tile"><span className="tile-label">{S.stale}</span><span className="tile-value">{fr.stale}</span><span className="tile-sub">/ {fr.places}</span></div>
            <div className="card tile"><span className="tile-label">{S.seasonal}</span><span className="tile-value">{fr.seasonal_hours}</span></div>
            <div className="card tile"><span className="tile-label">{S.noPhone}</span><span className="tile-value">{fr.no_phone}</span></div>
            <div className="card tile"><span className="tile-label">{S.noHours}</span><span className="tile-value">{fr.no_hours}</span></div>
          </div>
          <BarChart title={S.ages} rows={fr.by_age.map((c) => ({ key: c.key, label: c.key, value: c.count }))} />
        </section>
      )}
      {g && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{S.graph}</h2>
          <div className="charts">
            <BarChart title={S.nodes} rows={Object.entries(g.nodes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v }))} />
            <BarChart title={S.edges} rows={Object.entries(g.edges).map(([k, v]) => ({ key: k, label: k, value: v }))} />
          </div>
        </section>
      )}
    </>
  );
}
