// App shell: header (nav + language toggle), the current page, trust-rules footer.
import { useI18n } from "./i18n.tsx";
import { HREF, useRoute } from "./router.ts";
import type { Route } from "./router.ts";
import { Directory } from "./pages/Directory.tsx";
import { Submit } from "./pages/Submit.tsx";
import { Admin } from "./pages/Admin.tsx";
import { InsightsPage } from "./pages/Insights.tsx";

export function App() {
  const { t, lang, setLang } = useI18n();
  const route = useRoute();

  const nav: Array<[Route, string]> = [
    ["directory", t("nav_directory")],
    ["submit", t("nav_submit")],
    ["admin", t("nav_admin")],
    ["insights", t("nav_insights")],
  ];

  return (
    <div className="app">
      <a className="skip" href="#main">{lang === "es" ? "Ir al contenido" : "Skip to content"}</a>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href={HREF.directory}>
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="13" r="8" fill="currentColor" />
              <path d="M16 30 L9 18 H23 Z" fill="currentColor" />
              <circle cx="16" cy="13" r="3" fill="var(--surface)" />
            </svg>
            <span>
              <strong>{t("app_name")}</strong>
              <small>{t("app_tagline")}</small>
            </span>
          </a>
          <button
            type="button"
            className="lang-toggle"
            onClick={() => setLang(lang === "es" ? "en" : "es")}
            aria-label={t("lang_toggle_label")}
            lang={lang === "es" ? "en" : "es"}
          >
            {t("lang_toggle")}
          </button>
        </div>
        <nav className="nav" aria-label={t("nav_directory")}>
          {nav.map(([r, label]) => (
            <a key={r} href={HREF[r]} className={route === r ? "active" : ""} aria-current={route === r ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      <main id="main" className="main">
        {route === "directory" && <Directory />}
        {route === "submit" && <Submit />}
        {route === "admin" && <Admin />}
        {route === "insights" && <InsightsPage />}
      </main>

      <footer className="footer">
        <h2>{t("footer_rules_title")}</h2>
        <ul>
          <li>{t("footer_rule_info")}</li>
          <li>{t("footer_rule_status")}</li>
          <li>{t("footer_rule_review")}</li>
          <li>{t("footer_rule_privacy")}</li>
        </ul>
      </footer>
    </div>
  );
}
