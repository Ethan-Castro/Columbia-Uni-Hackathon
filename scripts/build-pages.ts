// Build plain static HTML pages (one per place) so search engines and AI
// overviews can index the catalog. The web app is a hash-routed SPA that
// crawlers cannot read; these pages need no JavaScript.
//
//   deno run -A scripts/build-pages.ts
//
// Reads data/Place.json, Program.json, Link.json and data/articles/*.json
// (from scripts/articles.ts). Writes:
//   web/public/lugares/<place id>.html     one bilingual page per eligible place
//   web/public/lugares/index.html          A-Z index, links to borough and need hubs
//   web/public/lugares/zona-<borough>.html, ayuda-<need>.html   hub pages
//   web/public/sitemap.xml, web/public/robots.txt
// A place with no article (or a stale one) gets a facts-only page.

import type { Need, Place, Program } from "../shared/schema.ts";
import {
  type Article,
  type Catalog,
  eligiblePlaces,
  factsHash,
  loadCatalog,
  NEED_LABEL,
  offeredPrograms,
  ORG_TYPE_MEANING,
  placeNeeds,
  readArticle,
  ROOT,
  SITE,
  SITE_NAME,
} from "./places-lib.ts";

const OUT = new URL("web/public/lugares/", ROOT);
const PUBLIC = new URL("web/public/", ROOT);
const MAX_BYTES = 25 * 1024;

// ---------- helpers ----------

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const slug = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KEEP_UPPER = new Set([
  "NYC",
  "NY",
  "USA",
  "US",
  "HRA",
  "SDA",
  "AME",
  "YMCA",
  "YWCA",
  "II",
  "III",
  "IV",
  "LLC",
  "CUNY",
  "SNAP",
  "WIC",
  "IDNYC",
  "DOF",
  "PLS",
  "ATN",
  "UCC",
  "COGIC",
  "HIV",
  "AIDS",
  "ESL",
  "PS",
  "IS",
  "JHS",
  "BRC",
  "CAMBA",
  "NYCHA",
  "RCCG",
]);
const SMALL = new Set([
  "of",
  "the",
  "and",
  "for",
  "in",
  "on",
  "at",
  "a",
  "an",
  "to",
  "de",
  "la",
  "el",
  "los",
  "las",
  "y",
  "del",
]);

/** Display name: ALL CAPS names become Title Case (keeps known acronyms). */
function displayName(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return name;
  return name.toLowerCase().replace(/[A-Za-z0-9'’.&-]+/g, (w, i: number) => {
    const up = w.toUpperCase().replace(/[.,]$/, "");
    if (KEEP_UPPER.has(up) || (/^[A-Z]{2,4}$/.test(up) && !/[AEIOUY]/.test(up))) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/(^|-)([a-z])/g, (_m, p, c) => p + c.toUpperCase()).replace(
      /(['’])([a-z])(?=[a-z]{2})/g,
      (_m, p, c) => p + c.toUpperCase(),
    ).replace(/^Mc([a-z])/, (_m, c) => "Mc" + c.toUpperCase());
  });
}

function telHref(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length < 10) return null;
  return `tel:+1${d.slice(0, 10)}`;
}

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

function sourceLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.endsWith("arcgis.com")) return "Food Help NYC";
    if (h === "justice.gov") return "U.S. Department of Justice (EOIR)";
    if (h === "data.cityofnewyork.us") return "NYC Open Data";
    if (h.endsWith("nyc.gov")) return "NYC.gov";
    return h;
  } catch {
    return url;
  }
}

const TRUST_LABEL: Record<string, { es: string; en: string }> = {
  official: { es: "Fuente oficial", en: "Official source" },
  verified: { es: "Verificado por teléfono", en: "Phone-verified" },
  community: { es: "Aportado por la comunidad", en: "Community-submitted" },
  unverified: { es: "Sin verificar", en: "Unverified" },
};

/** OSM 2x2 tile mosaic around a point at zoom 16, with the marker position in %. */
function osmTiles(lat: number, lng: number, z = 16) {
  const n = 2 ** z;
  const xf = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x0 = Math.floor(xf - 0.5), y0 = Math.floor(yf - 0.5);
  return {
    tiles: [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]].map(([x, y]) =>
      `https://maps.nyc.gov/xyz/1.0.0/carto/basemap/${z}/${x}/${y}.jpg`
    ),
    left: (((xf - x0) / 2) * 100).toFixed(2),
    top: (((yf - y0) / 2) * 100).toFixed(2),
  };
}

function distKm(a: Place, b: Place): number {
  if (a.lat == null || b.lat == null || a.lng == null || b.lng == null) return Infinity;
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371;
}

const hasGeo = (p: Place) => typeof p.lat === "number" && typeof p.lng === "number" && !!p.lat && !!p.lng;

// ---------- facts-only fallback ----------

function fallbackArticle(cat: Catalog, p: Place): Article {
  const name = displayName(p.name);
  const t = ORG_TYPE_MEANING[p.org_type];
  const where = p.borough || "Nueva York";
  const whereEn = p.borough || "New York";
  const progs = offeredPrograms(cat, p.id);
  const helpEs: string[] = [`Aparece en nuestra lista como: ${t.es.toLowerCase()}.`];
  const helpEn: string[] = [`Listed in our directory as: ${t.en.toLowerCase()}.`];
  if (p.org_type === "doj_roster" || p.org_type === "doj_pro_bono") {
    helpEs.push(
      "Está en la lista del Departamento de Justicia de EE. UU. (EOIR). Las tarifas y cómo pedir cita no están indicadas.",
    );
    helpEn.push(
      "It is on the U.S. Department of Justice (EOIR) list. Fees and how to get an appointment are not listed.",
    );
  }
  if (p.org_type === "check_casher" || p.org_type === "remittance") {
    helpEs.push("Es un negocio. No tenemos datos de sus tarifas: pregunte el precio antes.");
    helpEn.push("It is a business. We have no data on its fees: ask the price first.");
  }
  for (const g of progs) {
    helpEs.push(`Ofrece: ${g.name}.`);
    helpEn.push(`Offers: ${g.name}.`);
  }
  helpEs.push(`Dirección: ${p.address}.`);
  helpEn.push(`Address: ${p.address}.`);
  const tipsEs: string[] = [], tipsEn: string[] = [];
  if (p.hours) {
    tipsEs.push(`Horario publicado: ${p.hours}.`);
    tipsEn.push(`Listed hours: ${p.hours}.`);
  } else {
    tipsEs.push("El horario no está indicado.");
    tipsEn.push("Hours are not listed.");
  }
  if (p.phone) {
    tipsEs.push(`Llame antes de ir: ${p.phone}.`);
    tipsEn.push(`Call before you go: ${p.phone}.`);
  }
  return {
    title_es: `${name}: ${t.es.toLowerCase()} en ${where}`,
    title_en: `${name}: ${t.en.toLowerCase()} in ${whereEn}`,
    summary_es: `${name} aparece en nuestra lista como ${t.es.toLowerCase()} en ${where}.${
      p.hours ? ` Horario: ${p.hours}.` : ""
    }`,
    summary_en: `${name} is listed in our directory as a ${t.en.toLowerCase()} in ${whereEn}.${
      p.hours ? ` Hours: ${p.hours}.` : ""
    }`,
    how_they_help_es: helpEs,
    how_they_help_en: helpEn,
    visit_tips_es: tipsEs,
    visit_tips_en: tipsEn,
    faq_es: [],
    faq_en: [],
  };
}

// ---------- page parts ----------

const FONT =
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const CSS =
  `:root{--bg:#fcf5eb;--card:#fff;--fg:#111b21;--muted:#54656f;--line:#1c1e21;--soft:#f3ede4;--accent:#008069;--green:#25d366;--accent-soft:#e7fcef}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--card:#111b21;--fg:#e9edef;--muted:#8696a0;--line:#3b4a54;--soft:#202c33;--accent:#00a884;--green:#25d366;--accent-soft:#0f2a20}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--fg);font-weight:500;text-decoration:underline;text-decoration-color:var(--green);text-decoration-thickness:2px;text-underline-offset:4px}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.wrap{max-width:760px;margin:0 auto;padding:16px 16px 48px}
header.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:4px 0 16px;border-bottom:1px solid var(--line);margin-bottom:20px}
.brand{font-weight:700;text-decoration:none;color:var(--fg)}.brand span{color:var(--accent)}
nav.top a{margin-left:12px;font-size:14px;color:var(--muted)}nav.top a:first-child{margin-left:0}
.crumbs{font-size:13px;color:var(--muted);margin:0 0 8px}.crumbs a{color:var(--muted)}
h1{font-size:28px;line-height:1.2;margin:0 0 10px;letter-spacing:-.02em}h2{font-size:19px;margin:28px 0 8px;letter-spacing:-.01em}h3{font-size:16px;margin:0}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}.badge{display:inline-block;font-size:12px;font-weight:500;padding:2px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted)}
.badge.t{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
.lead{font-size:18px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:28px;padding:22px;margin:16px 0}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:8px 14px}dt{color:var(--muted);font-size:14px}dd{margin:0;word-break:break-word}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.btn{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:999px;font-weight:600;text-decoration:none;border:1px solid var(--line);color:var(--fg);background:var(--card)}.btn.p{background:var(--green);border-color:var(--line);color:#111b21}
ul{padding-left:22px;margin:8px 0}li{margin:4px 0}
figure{margin:16px 0}.map{position:relative;display:grid;grid-template-columns:1fr 1fr;max-width:420px;aspect-ratio:1;overflow:hidden;border-radius:22px;border:1px solid var(--line);background:var(--soft)}
.map img{width:100%;height:auto;display:block}.pin{position:absolute;width:22px;height:22px;margin:-22px 0 0 -11px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
figcaption{font-size:12px;color:var(--muted);margin-top:6px}
details{border-top:1px solid var(--line);padding:10px 0}details:last-child{border-bottom:1px solid var(--line)}summary{cursor:pointer;font-weight:600}details p{margin:6px 0 0}
.prog{border-top:1px solid var(--line);padding:10px 0}.prog:first-child{border-top:0}
.muted{color:var(--muted)}.small{font-size:13px}.note{font-size:14px;padding:12px 14px;border-radius:14px;background:var(--soft)}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}
.az{columns:2 260px;column-gap:24px;padding-left:0;list-style:none}.az li{break-inside:avoid;margin:0 0 8px}.az .muted{font-size:13px;display:block}
.letters a{display:inline-block;min-width:28px;text-align:center;margin:2px}
footer{margin-top:40px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}`;

function head(o: { title: string; description: string; canonical: string; jsonld?: unknown[] }): string {
  const ld = (o.jsonld ?? []).map((j) =>
    `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`
  ).join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<link rel="icon" href="/icon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:image" content="${SITE}/icon.png">
<meta property="og:locale" content="es_US">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary">
${FONT}
<style>${CSS}</style>
${ld}
</head>
<body>
<div class="wrap">
<header class="top"><a class="brand" href="${SITE}/">Mapa de <span>Servicios</span> NYC</a><nav class="top"><a href="${SITE}/">Inicio</a><a href="./index.html">Lugares</a><a href="#en" hreflang="en">English</a></nav></header>`;
}

const FOOT =
  `<footer><p>Información y referidos, no asesoría legal. · Information and referrals, not legal advice.</p><p><a href="${SITE}/">${SITE_NAME}</a> · <a href="./index.html">Índice de lugares</a> · <a href="/privacy.html">Privacidad</a> · <a href="/terms.html">Términos</a></p></footer>
</div>
</body>
</html>
`;

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

function jsonLdType(p: Place): Record<string, unknown> {
  switch (p.org_type) {
    case "doj_roster":
    case "doj_pro_bono":
      return { "@type": "LegalService" };
    case "clinic":
      return { "@type": "MedicalClinic" };
    case "benefits_office":
    case "idnyc":
    case "school":
    case "consulate":
      return { "@type": "GovernmentOffice" };
    case "check_casher":
    case "remittance":
      return { "@type": "FinancialService" };
    case "pantry":
      return { "@type": "LocalBusiness", additionalType: "http://www.productontology.org/id/Food_bank" };
    default:
      return /librar/i.test(p.name) ? { "@type": "Library" } : { "@type": "LocalBusiness" };
  }
}

/** Street part of "123 Main St, Corona, NY 11368" and the locality. */
function splitAddress(p: Place): { street: string; locality: string } {
  const parts = p.address.split(",").map((s) => s.trim()).filter(Boolean);
  const isStateZip = (s: string) => /^(NY|New York)(\s+\d{5})?$|^\d{5}$/i.test(s);
  while (parts.length > 1 && isStateZip(parts[parts.length - 1])) parts.pop();
  const locality = parts.length > 1 ? parts.pop()! : p.borough || "New York";
  return { street: parts.join(", ") || p.address, locality };
}

interface PageCtx {
  cat: Catalog;
  p: Place;
  a: Article;
  generated: boolean;
  needs: Need[];
  related: Place[];
}

function contactBlock(p: Place, lang: "es" | "en"): string {
  const L = lang === "es"
    ? {
      addr: "Dirección",
      phone: "Teléfono",
      hours: "Horario",
      langs: "Idiomas",
      none: "No indicado",
      map: "Cómo llegar (Google Maps)",
      call: "Llamar",
    }
    : {
      addr: "Address",
      phone: "Phone",
      hours: "Hours",
      langs: "Languages",
      none: "Not listed",
      map: "Directions (Google Maps)",
      call: "Call",
    };
  const tel = p.phone ? telHref(p.phone) : null;
  const rows = [
    `<dt>${L.addr}</dt><dd><a href="${esc(mapsUrl(p.address))}" rel="noopener">${esc(p.address)}</a></dd>`,
    `<dt>${L.phone}</dt><dd>${p.phone ? (tel ? `<a href="${tel}">${esc(p.phone)}</a>` : esc(p.phone)) : L.none}</dd>`,
    `<dt>${L.hours}</dt><dd>${p.hours ? esc(p.hours) : L.none}</dd>`,
    `<dt>${L.langs}</dt><dd>${p.languages?.length ? esc(p.languages.join(", ")) : L.none}</dd>`,
  ];
  const btns = [`<a class="btn p" href="${esc(mapsUrl(p.address))}" rel="noopener">${L.map}</a>`];
  if (tel) btns.push(`<a class="btn" href="${tel}">${L.call} ${esc(p.phone)}</a>`);
  return `<div class="card"><dl>${rows.join("")}</dl><div class="btns">${btns.join("")}</div></div>`;
}

function mapFigure(p: Place, name: string): string {
  if (!hasGeo(p)) return "";
  const m = osmTiles(p.lat, p.lng);
  const imgs = m.tiles.map((src, i) =>
    `<img src="${src}" width="256" height="256" loading="lazy" decoding="async" alt="${
      i === 0 ? esc(`Mapa de la zona de ${name}, ${p.address}`) : ""
    }">`
  ).join("");
  return `<figure><a class="map" href="${esc(mapsUrl(p.address))}" rel="noopener" aria-label="${
    esc(`Ver ${name} en Google Maps`)
  }">${imgs}<span class="pin" style="left:${m.left}%;top:${m.top}%"></span></a><figcaption>Mapa base © Ciudad de Nueva York (NYC Basemap)</figcaption></figure>`;
}

const list = (items: string[]) => (items.length ? `<ul>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "");

function programsBlock(progs: Program[], lang: "es" | "en"): string {
  if (!progs.length) return "";
  const L = lang === "es"
    ? { h: "Programas que ofrece", bring: "Qué llevar", src: "Fuente" }
    : { h: "Programs offered", bring: "What to bring", src: "Source" };
  return `<h2>${L.h}</h2><div class="card">${
    progs.map((g) => {
      const sum = lang === "es" ? g.summary_es || g.summary_en : g.summary_en || g.summary_es;
      return `<div class="prog"><h3>${esc(g.name)}</h3>${sum ? `<p>${esc(sum)}</p>` : ""}${
        g.bring?.length ? `<p class="small"><strong>${L.bring}:</strong> ${esc(g.bring.join(", "))}</p>` : ""
      }${
        g.source_url
          ? `<p class="small">${L.src}: <a href="${esc(g.source_url)}" rel="noopener nofollow">${
            esc(sourceLabel(g.source_url))
          }</a></p>`
          : ""
      }</div>`;
    }).join("")
  }</div>`;
}

function faqBlock(faq: { q: string; a: string }[], lang: "es" | "en"): string {
  if (!faq.length) return "";
  return `<h2>${lang === "es" ? "Preguntas frecuentes" : "Frequently asked questions"}</h2>${
    faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")
  }`;
}

function relatedBlock(related: Place[], lang: "es" | "en"): string {
  if (!related.length) return "";
  return `<h2>${lang === "es" ? "Lugares relacionados" : "Related places"}</h2><ul>${
    related.map((r) =>
      `<li><a href="./${esc(r.id)}.html">${esc(displayName(r.name))}</a> <span class="muted small">· ${
        esc(ORG_TYPE_MEANING[r.org_type][lang])
      }${r.zip ? ` · ${esc(r.zip)}` : ""}</span></li>`
    ).join("")
  }</ul>`;
}

function sourceBlock(p: Place, lang: "es" | "en", generated: boolean): string {
  const t = TRUST_LABEL[p.trust] ?? TRUST_LABEL.unverified;
  const src = p.source_url
    ? `<a href="${esc(p.source_url)}" rel="noopener nofollow">${esc(sourceLabel(p.source_url))}</a>`
    : "—";
  return lang === "es"
    ? `<p class="note">Fuente: ${src} · Revisado el ${esc(p.last_checked)} · ${
      esc(t.es)
    }. Los horarios cambian: llame antes de ir.${
      generated ? " Texto redactado con IA solo a partir de estos datos." : ""
    }</p><p><strong>Información y referidos, no asesoría legal.</strong></p>`
    : `<p class="note">Source: ${src} · Checked ${esc(p.last_checked)} · ${
      esc(t.en)
    }. Hours change: call before you go.${
      generated ? " Text drafted with AI from these facts only." : ""
    }</p><p><strong>Information and referrals, not legal advice.</strong></p>`;
}

function placePage(c: PageCtx): string {
  const { p, a } = c;
  const name = displayName(p.name);
  const t = ORG_TYPE_MEANING[p.org_type];
  const progs = offeredPrograms(c.cat, p.id);
  const url = `${SITE}/lugares/${p.id}.html`;
  const { street, locality } = splitAddress(p);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    ...jsonLdType(p),
    "@id": url,
    name,
    url,
    description: [a.summary_es, p.hours ? `Horario / Hours: ${p.hours}` : ""].filter(Boolean).join(" "),
    address: {
      "@type": "PostalAddress",
      streetAddress: street,
      addressLocality: locality,
      addressRegion: "NY",
      ...(p.zip ? { postalCode: p.zip } : {}),
      addressCountry: "US",
    },
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(hasGeo(p) ? { geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng } } : {}),
    ...(p.languages?.length ? { availableLanguage: p.languages } : {}),
    ...(p.org && p.org !== p.name ? { parentOrganization: { "@type": "Organization", name: displayName(p.org) } } : {}),
    ...(p.source_url ? { sameAs: p.source_url } : {}),
    hasMap: mapsUrl(p.address),
  };
  const jsonld: unknown[] = [ld];
  if (a.faq_es.length) {
    jsonld.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: a.faq_es.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  const needBadges = c.needs.map((n) => `<a class="badge" href="./ayuda-${n}.html">${esc(NEED_LABEL[n].es)}</a>`).join(
    "",
  );
  const boroughLink = p.borough ? `<a href="./zona-${slug(p.borough)}.html">${esc(p.borough)}</a>` : "";
  const title = `${a.title_es} | ${SITE_NAME}`.length <= 75 ? `${a.title_es} | ${SITE_NAME}` : a.title_es;

  return head({ title, description: truncate(a.summary_es, 158), canonical: url, jsonld }) + `
<main>
<section id="es" lang="es">
<p class="crumbs"><a href="${SITE}/">Inicio</a> › <a href="./index.html">Lugares</a>${
    boroughLink ? ` › ${boroughLink}` : ""
  }</p>
<h1>${esc(a.title_es)}</h1>
<div class="badges"><span class="badge t">${esc(t.es)}</span>${
    p.borough ? `<span class="badge">${esc(p.borough)}</span>` : ""
  }${needBadges}<span class="badge">${esc((TRUST_LABEL[p.trust] ?? TRUST_LABEL.unverified).es)}</span></div>
<p class="lead">${esc(a.summary_es)}</p>
${contactBlock(p, "es")}
${mapFigure(p, name)}
<h2>Cómo ayudan</h2>${list(a.how_they_help_es)}
<h2>Qué llevar y antes de ir</h2>${list(a.visit_tips_es)}
${programsBlock(progs, "es")}
${faqBlock(a.faq_es, "es")}
${relatedBlock(c.related, "es")}
${sourceBlock(p, "es", c.generated)}
</section>
<hr>
<section id="en" lang="en">
<h2 style="font-size:24px">${esc(a.title_en)}</h2>
<div class="badges"><span class="badge t">${esc(t.en)}</span>${
    p.borough ? `<span class="badge">${esc(p.borough)}</span>` : ""
  }${c.needs.map((n) => `<a class="badge" href="./ayuda-${n}.html">${esc(NEED_LABEL[n].en)}</a>`).join("")}</div>
<p class="lead">${esc(a.summary_en)}</p>
${contactBlock(p, "en")}
<h2>How they help</h2>${list(a.how_they_help_en)}
<h2>Before you go</h2>${list(a.visit_tips_en)}
${programsBlock(progs, "en")}
${faqBlock(a.faq_en, "en")}
${relatedBlock(c.related, "en")}
${sourceBlock(p, "en", c.generated)}
</section>
</main>
` + FOOT;
}

// ---------- index and hubs ----------

function entry(p: Place): string {
  const t = ORG_TYPE_MEANING[p.org_type];
  return `<li><a href="./${esc(p.id)}.html">${esc(displayName(p.name))}</a><span class="muted">${esc(t.es)} · ${
    esc(p.borough || "NYC")
  }${p.zip ? ` ${esc(p.zip)}` : ""}</span></li>`;
}

const byName = (a: Place, b: Place) =>
  displayName(a.name).localeCompare(displayName(b.name), "es", { sensitivity: "base" });

function hubLinks(boroughs: [string, Place[]][], needs: [Need, Place[]][]): string {
  return `<h2>Por zona · By borough</h2><div class="badges">${
    boroughs.map(([b, ps]) => `<a class="badge" href="./zona-${slug(b)}.html">${esc(b)} (${ps.length})</a>`).join("")
  }</div><h2>Por tipo de ayuda · By need</h2><div class="badges">${
    needs.map(([n, ps]) =>
      `<a class="badge" href="./ayuda-${n}.html">${esc(NEED_LABEL[n].es)} / ${esc(NEED_LABEL[n].en)} (${ps.length})</a>`
    )
      .join("")
  }</div>`;
}

function indexPage(places: Place[], boroughs: [string, Place[]][], needs: [Need, Place[]][]): string {
  const groups = new Map<string, Place[]>();
  for (const p of [...places].sort(byName)) {
    const ch = displayName(p.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
    const k = /[A-Z]/.test(ch) ? ch : "#";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  const letters = [...groups.keys()];
  const url = `${SITE}/lugares/index.html`;
  return head({
    title: `Lugares de ayuda en Nueva York (A–Z) | ${SITE_NAME}`,
    description:
      `Directorio de ${places.length} lugares de ayuda en NYC: comida, ayuda legal, salud, beneficios, identificación y más. Directory of services for immigrant New Yorkers.`,
    canonical: url,
    jsonld: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Lugares de ayuda en Nueva York",
      url,
      inLanguage: ["es", "en"],
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE}/` },
    }],
  }) + `
<main>
<section lang="es">
<h1>Lugares de ayuda en Nueva York</h1>
<p class="lead">${places.length} lugares con dirección: despensas de comida, ayuda legal reconocida por el DOJ, clínicas, oficinas de beneficios, IDNYC y más. Cada página dice de dónde sale la información y cuándo se revisó.</p>
<p class="muted" lang="en" id="en">Directory of ${places.length} places that help immigrant New Yorkers (food, legal help, health, benefits, ID and more). Each page is in Spanish and English and links to its source.</p>
${hubLinks(boroughs, needs)}
<h2>De la A a la Z · A to Z</h2>
<p class="letters">${letters.map((l) => `<a href="#l-${l === "#" ? "num" : l}">${l}</a>`).join("")}</p>
${
    letters.map((l) =>
      `<h3 id="l-${l === "#" ? "num" : l}" style="margin-top:20px">${l}</h3><ul class="az">${
        groups.get(l)!.map(entry).join("")
      }</ul>`
    )
      .join("\n")
  }
<p><strong>Información y referidos, no asesoría legal.</strong></p>
</section>
</main>
` + FOOT;
}

function hubPage(o: { file: string; titleEs: string; titleEn: string; intro: string; places: Place[] }): string {
  const url = `${SITE}/lugares/${o.file}`;
  return head({
    title: `${o.titleEs} | ${SITE_NAME}`,
    description: truncate(`${o.intro} ${o.titleEn}.`, 158),
    canonical: url,
    jsonld: [{
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: o.titleEs,
      url,
      numberOfItems: o.places.length,
      itemListElement: o.places.slice(0, 100).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}/lugares/${p.id}.html`,
        name: displayName(p.name),
      })),
    }],
  }) + `
<main>
<section lang="es">
<p class="crumbs"><a href="${SITE}/">Inicio</a> › <a href="./index.html">Lugares</a></p>
<h1>${esc(o.titleEs)}</h1>
<p class="lead">${esc(o.intro)}</p>
<p class="muted" lang="en" id="en">${esc(o.titleEn)} (${o.places.length}).</p>
<ul class="az">${o.places.map(entry).join("")}</ul>
<p><strong>Información y referidos, no asesoría legal.</strong></p>
</section>
</main>
` + FOOT;
}

// ---------- main ----------

const cat = await loadCatalog();
const places = eligiblePlaces(cat.places);
const needsOf = new Map(places.map((p) => [p.id, placeNeeds(cat, p)]));

function relatedFor(p: Place): Place[] {
  const mine = new Set(needsOf.get(p.id));
  const shares = (q: Place) => (needsOf.get(q.id) ?? []).some((n) => mine.has(n));
  const others = places.filter((q) => q.id !== p.id);
  const byDist = (a: Place, b: Place) => distKm(p, a) - distKm(p, b) || byName(a, b);
  const out: Place[] = [];
  const add = (qs: Place[]) => {
    for (const q of qs) if (out.length < 5 && !out.includes(q)) out.push(q);
  };
  add(others.filter((q) => p.zip && q.zip === p.zip && shares(q)).sort(byDist));
  if (hasGeo(p)) add(others.filter((q) => shares(q) && distKm(p, q) < 3).sort(byDist));
  add(others.filter((q) => p.zip && q.zip === p.zip).sort(byDist));
  return out;
}

await Deno.mkdir(OUT, { recursive: true });
const written = new Set<string>();
let withArticle = 0, stale = 0, missing = 0, totalBytes = 0, maxBytes = 0, maxId = "";
const oversize: string[] = [];

for (const p of places) {
  const file = await readArticle(p.id);
  let a: Article, generated = false;
  if (file && file.facts_hash === await factsHash(cat, p)) {
    a = file.article;
    generated = true;
    withArticle++;
  } else {
    if (file) stale++;
    else missing++;
    a = fallbackArticle(cat, p);
  }
  const html = placePage({ cat, p, a, generated, needs: needsOf.get(p.id) ?? [], related: relatedFor(p) });
  const bytes = new TextEncoder().encode(html).length;
  totalBytes += bytes;
  if (bytes > maxBytes) [maxBytes, maxId] = [bytes, p.id];
  if (bytes > MAX_BYTES) oversize.push(`${p.id} (${bytes} B)`);
  await Deno.writeTextFile(new URL(`${p.id}.html`, OUT), html);
  written.add(`${p.id}.html`);
}

// Hubs
const boroughMap = new Map<string, Place[]>();
for (const p of places) {
  const b = p.borough || "NYC";
  if (!boroughMap.has(b)) boroughMap.set(b, []);
  boroughMap.get(b)!.push(p);
}
const boroughs = [...boroughMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const needMap = new Map<Need, Place[]>();
for (const p of places) {
  for (const n of needsOf.get(p.id) ?? []) {
    if (!needMap.has(n)) needMap.set(n, []);
    needMap.get(n)!.push(p);
  }
}
const needs = [...needMap.entries()].sort((a, b) => b[1].length - a[1].length);

for (const [b, ps] of boroughs) {
  const file = `zona-${slug(b)}.html`;
  await Deno.writeTextFile(
    new URL(file, OUT),
    hubPage({
      file,
      titleEs: `Lugares de ayuda en ${b}`,
      titleEn: `Places that help in ${b}`,
      intro: `${ps.length} lugares de ayuda en ${b}: comida, ayuda legal, salud, beneficios y más.`,
      places: [...ps].sort(byName),
    }),
  );
  written.add(file);
}
for (const [n, ps] of needs) {
  const file = `ayuda-${n}.html`;
  await Deno.writeTextFile(
    new URL(file, OUT),
    hubPage({
      file,
      titleEs: `${NEED_LABEL[n].es}: lugares de ayuda en Nueva York`,
      titleEn: `${NEED_LABEL[n].en}: places that help in New York City`,
      intro: `${ps.length} lugares en NYC para ${NEED_LABEL[n].es.toLowerCase()}, con dirección, horario y fuente.`,
      places: [...ps].sort(byName),
    }),
  );
  written.add(file);
}
await Deno.writeTextFile(new URL("index.html", OUT), indexPage(places, boroughs, needs));
written.add("index.html");

// Remove pages for places that are gone (or no longer eligible).
let removed = 0;
for await (const e of Deno.readDir(OUT)) {
  if (e.isFile && e.name.endsWith(".html") && !written.has(e.name)) {
    await Deno.remove(new URL(e.name, OUT));
    removed++;
  }
}

// Sitemap + robots
const today = new Date().toISOString().slice(0, 10);
const newest = places.reduce((m, p) => (p.last_checked > m ? p.last_checked : m), "");
const urls: [string, string][] = [
  [`${SITE}/`, newest || today],
  [`${SITE}/lugares/index.html`, newest || today],
  ...boroughs.map(([b]) => [`${SITE}/lugares/zona-${slug(b)}.html`, newest || today] as [string, string]),
  ...needs.map(([n]) => [`${SITE}/lugares/ayuda-${n}.html`, newest || today] as [string, string]),
  ...places.map((p) => [`${SITE}/lugares/${p.id}.html`, p.last_checked || today] as [string, string]),
];
await Deno.writeTextFile(
  new URL("sitemap.xml", PUBLIC),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map(([u, d]) => `  <url><loc>${esc(u)}</loc><lastmod>${esc(d)}</lastmod></url>`).join("\n")
  }\n</urlset>\n`,
);
await Deno.writeTextFile(new URL("robots.txt", PUBLIC), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(
  `pages: ${places.length} place pages (${withArticle} with article, ${missing} facts-only (no article), ${stale} facts-only (stale article)), ` +
    `${boroughs.length} borough hubs, ${needs.length} need hubs, index; removed ${removed} old pages`,
);
console.log(
  `place pages total ${(totalBytes / 1024).toFixed(0)} KB, largest ${
    (maxBytes / 1024).toFixed(1)
  } KB (${maxId}); sitemap ${urls.length} URLs`,
);
if (oversize.length) console.log(`WARNING over ${MAX_BYTES / 1024} KB:\n  ${oversize.join("\n  ")}`);
if (stale) console.log("Some articles are stale (facts changed). Run: deno run -A scripts/articles.ts --only-missing");
