// Public directory: pick a need, borough and language; search by text.
// Need/borough/language go to the backend (a need search is logged
// anonymously); the text search filters the loaded list in the browser so
// typing never creates extra log rows.
import { useEffect, useMemo, useState } from "react";
import { listPlaces } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { PlaceCard } from "../components/PlaceCard.tsx";
import { BOROUGHS, LANGUAGE_CODES, NEEDS } from "../types.ts";
import type { ListPlacesResult } from "../types.ts";

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function Directory() {
  const { t, label } = useI18n();
  const [need, setNeed] = useState("");
  const [borough, setBorough] = useState("");
  const [language, setLanguage] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListPlacesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    listPlaces({ need, borough, language })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [need, borough, language, reload]);

  const places = useMemo(() => {
    const all = data?.places ?? [];
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((p) => {
      const hay = fold([p.name, p.org, p.address, p.zip, p.borough, ...p.programs.map((x) => x.name)].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [data, q]);

  return (
    <>
      <section className="intro">
        <h1>{t("dir_title")}</h1>
        <p>{t("dir_intro")}</p>
      </section>

      <div className="chips" role="group" aria-label={t("sub_needs")}>
        <button type="button" className="chip" aria-pressed={need === ""} onClick={() => setNeed("")}>
          {t("dir_need_all")}
        </button>
        {NEEDS.map((n) => (
          <button key={n} type="button" className="chip" aria-pressed={need === n} onClick={() => setNeed(need === n ? "" : n)}>
            {label("need", n)}
          </button>
        ))}
      </div>

      <div className="filters">
        <label className="field grow">
          <span>{t("dir_search")}</span>
          <input type="search" value={q} placeholder={t("dir_search_placeholder")} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("dir_borough")}</span>
          <select value={borough} onChange={(e) => setBorough(e.target.value)}>
            <option value="">{t("dir_borough_all")}</option>
            {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("dir_language")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t("dir_language_all")}</option>
            {LANGUAGE_CODES.map((l) => <option key={l} value={l}>{label("lang", l)}</option>)}
          </select>
        </label>
      </div>

      {data?.sample_data && <p className="notice">{t("sample_banner")}</p>}

      <div aria-live="polite" className="results-meta">
        {loading ? t("dir_loading") : error ? "" : places.length === 1 ? t("dir_count_one") : t("dir_count", { n: places.length })}
      </div>

      {error && (
        <div className="card error-card" role="alert">
          <p>{t("dir_error")}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setReload((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}

      {!loading && !error && places.length === 0 && <p className="card empty">{t("dir_none")}</p>}

      <div className={`results${loading ? " is-loading" : ""}`}>
        {places.map((p) => <PlaceCard key={p.id} place={p} />)}
      </div>
    </>
  );
}
