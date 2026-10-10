import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n.tsx";
import { App } from "./App.tsx";
import "./index.css";

// Base44 hosting serves this SPA for /voz and /voz/; send people to the voice app itself.
if (/^\/voz\/?$/.test(location.pathname)) location.replace("/voz/index.html");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
