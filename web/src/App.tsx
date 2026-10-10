// App shell: header (nav + language toggle), the current page, trust-rules footer.
import { useI18n } from "./i18n.tsx";
import { HREF, useRoute } from "./router.ts";
import type { Route } from "./router.ts";
import { Home } from "./pages/Home.tsx";
import { Directory } from "./pages/Directory.tsx";
import { Submit } from "./pages/Submit.tsx";
import { Admin } from "./pages/Admin.tsx";
import { InsightsPage } from "./pages/Insights.tsx";

export function App() {
  const { t, lang, setLang } = useI18n();
  const route = useRoute();

  const nav: Array<[Route, string]> = [
    ["home", t("nav_home")],
    ["directory", t("nav_directory")],
    ["submit", t("nav_submit")],
    ["insights", t("nav_insights")],
  ];

  return (
    <div className="app">
      <a className="skip" href="#main">{lang === "es" ? "Ir al contenido" : "Skip to content"}</a>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href={HREF.home}>
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="13" r="8" fill="currentColor" />
              <path d="M16 30 L9 18 H23 Z" fill="currentColor" />
              <circle cx="16" cy="13" r="3" fill="var(--background)" />
            </svg>
            <span>
              <strong>{t("app_name")}</strong>
              <small>{t("app_tagline")}</small>
            </span>
          </a>
          <div className="lang-switch" role="group" aria-label={lang === "es" ? "Idioma" : "Language"}>
            {(["es", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
              >
                <span className="lang-long">{l === "es" ? "Español" : "English"}</span>
                <span className="lang-short" aria-hidden="true">{l.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
        <nav className="nav" aria-label={t("nav_directory")}>
          {nav.map(([r, label]) => (
            <a key={r} href={HREF[r]} className={route === r ? "active" : ""} aria-current={route === r ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      {route === "home" ? (
        <main id="main"><Home /></main>
      ) : (
        <main id="main" className="main">
        {route === "directory" && <Directory />}
        {route === "submit" && <Submit />}
        {route === "admin" && <Admin />}
        {route === "insights" && <InsightsPage />}
      </main>
      )}

      <footer className="footer" hidden={route === "home"}>
        <h2>{t("footer_rules_title")}</h2>
        <ul>
          <li>{t("footer_rule_info")}</li>
          <li>{t("footer_rule_status")}</li>
          <li>{t("footer_rule_review")}</li>
          <li>{t("footer_rule_privacy")}</li>
          <li><a href={HREF.admin}>{t("nav_admin")}</a> · <a href="privacy.html">{lang === "es" ? "Privacidad" : "Privacy"}</a> · <a href="terms.html">{lang === "es" ? "Términos" : "Terms"}</a></li>
        </ul>
      </footer>
    </div>
  );
}
