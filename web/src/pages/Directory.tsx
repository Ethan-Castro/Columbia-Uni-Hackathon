// Public directory: pick a need, borough and language; search by text.
// Need/borough/language go to the backend (a need search is logged
// anonymously); the text search filters the loaded list in the browser so
// typing never creates extra log rows.
import { useEffect, useMemo, useState } from "react";
import {
  Banknote, Briefcase, Bus, GraduationCap, HandHeart, HeartPulse, Home as HomeIcon, IdCard, Scale, ShoppingBasket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { listPlaces } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { PlaceCard } from "../components/PlaceCard.tsx";
import { BOROUGHS, LANGUAGE_CODES, NEEDS } from "../types.ts";
import type { ListPlacesResult } from "../types.ts";

const NEED_ICONS: Record<string, LucideIcon> = {
  food: ShoppingBasket, legal: Scale, health: HeartPulse, benefits: HandHeart, money: Banknote,
  school: GraduationCap, id: IdCard, housing: HomeIcon, work: Briefcase, transit: Bus,
};
const PAGE = 30;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function Directory() {
  const { t, label, lang } = useI18n();
  const [shown, setShown] = useState(PAGE);
  const S = lang === "en"
    ? { step1: "1. What do you need?", step2: "2. Where?", more: "More filters (borough, language)", start: "Choose what you need, or type a zip code, neighborhood or name.", showMore: "Show more", of: "Showing {a} of {b}" }
    : { step1: "1. ¿Qué necesita?", step2: "2. ¿Dónde?", more: "Más filtros (condado, idioma)", start: "Elija lo que necesita, o escriba un código postal, un barrio o un nombre.", showMore: "Mostrar más", of: "Mostrando {a} de {b}" };
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
  useEffect(() => setShown(PAGE), [need, borough, language, q]);
  const started = need !== "" || fold(q).trim().length >= 2 || borough !== "" || language !== "";

  return (
    <>
      <section className="intro">
        <h1>{t("dir_title")}</h1>
        <p>{t("dir_intro")}</p>
      </section>

      <h2 className="step-title" id="need-title">{S.step1}</h2>
      <div className="need-grid" role="group" aria-labelledby="need-title">
        {NEEDS.map((n) => {
          const Icon = NEED_ICONS[n];
          return (
            <button key={n} type="button" className="need-tile" aria-pressed={need === n} onClick={() => setNeed(need === n ? "" : n)}>
              <Icon aria-hidden="true" />
              <span>{label("need", n)}</span>
            </button>
          );
        })}
      </div>

      <h2 className="step-title">{S.step2}</h2>
      <label className="field">
        <span className="sr-only">{t("dir_search")}</span>
        <input className="search-big" type="search" value={q} placeholder={t("dir_search_placeholder")} onChange={(e) => setQ(e.target.value)} aria-label={t("dir_search")} />
      </label>
      <details className="more-filters">
        <summary>{S.more}</summary>
        <div className="row">
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
      </details>

      {data?.sample_data && <p className="notice">{t("sample_banner")}</p>}

      <div aria-live="polite" className="results-meta">
        {!started ? S.start : loading ? t("dir_loading") : error ? "" : places.length === 1 ? t("dir_count_one") : t("dir_count", { n: places.length })}
      </div>

      {error && (
        <div className="card error-card" role="alert">
          <p>{t("dir_error")}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setReload((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}

      {started && !loading && !error && places.length === 0 && <p className="card empty">{t("dir_none")}</p>}

      {started && (
        <div className={`results${loading ? " is-loading" : ""}`}>
          {places.slice(0, shown).map((p) => <PlaceCard key={p.id} place={p} />)}
        </div>
      )}
      {started && places.length > shown && (
        <div className="show-more">
          <p className="hint">{S.of.replace("{a}", String(shown)).replace("{b}", String(places.length))}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setShown((n) => n + PAGE)}>{S.showMore}</button>
        </div>
      )}
    </>
  );
}
