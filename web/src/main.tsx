import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n.tsx";
import { App } from "./App.tsx";
import "./index.css";

// Base44 hosting serves this SPA for /voz and /voz/; send people to the voice app itself.
if (/^\/voz\/?$/.test(location.pathname)) location.replace("/voz/index.html");
// Unlisted Hugging Face open-data page: only reachable by typing the address
// (/huggingface, /hugging-face, /hugging face). No menu link, not in the sitemap.
if (/^\/hugging(-|_|%20)?face\/?$/i.test(location.pathname)) location.replace("/huggingface/index.html");
// "Before you go" demo page: static cards with the "What we know" panel, same data as pipeline/hf_release/places.csv.
if (/^\/before-you-go\/?$/i.test(location.pathname)) location.replace("/before-you-go/index.html");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
