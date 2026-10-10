// Small hand-rolled horizontal bar chart (SVG bars, HTML labels), one series.
// Bars grow from one baseline, 4px rounded tip, value at the tip in text ink,
// a native tooltip on hover, and a table view for screen readers and print.
import { useI18n } from "../i18n.tsx";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Text at the bar tip; defaults to the value. */
  valueText?: string;
}

export function BarChart({ title, rows, empty }: { title: string; rows: BarRow[]; empty?: string }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const hasData = rows.some((r) => r.value > 0);

  return (
    <section className="card chart">
      <h3>{title}</h3>
      {!hasData && empty ? <p className="muted">{empty}</p> : (
        <>
          <ul className="bars" role="list">
            {rows.map((r) => {
              const pct = (r.value / max) * 100;
              const text = r.valueText ?? String(r.value);
              return (
                <li key={r.key} className="bar-row" title={`${r.label}: ${text}`}>
                  <span className="bar-label">{r.label}</span>
                  <svg className="bar-track" height="18" aria-hidden="true" preserveAspectRatio="none">
                    {r.value > 0 && (
                      // Inner svg clips to the bar length: a rounded rect for the tip,
                      // plus a 6px square rect so the baseline end stays square.
                      <svg x="0" y="0" width={`${pct}%`} height="18">
                        <rect className="bar-fill" x="0" y="0" width="100%" height="18" rx="4" />
                        <rect className="bar-fill" x="0" y="0" width="6" height="18" />
                      </svg>
                    )}
                  </svg>
                  <span className="bar-value">{text}</span>
                </li>
              );
            })}
          </ul>
          <details className="chart-table">
            <summary>{t("ins_table")}</summary>
            <table>
              <thead>
                <tr><th scope="col">{t("ins_col_item")}</th><th scope="col">{t("ins_col_value")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => <tr key={r.key}><td>{r.label}</td><td>{r.valueText ?? r.value}</td></tr>)}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
