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
    </>
  );
}
