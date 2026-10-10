// The one MCP Apps widget (ChatGPT plugin + Claude interactive connector).
// A single HTML file: inline CSS and JS, no CDN, no fetches, so its CSP is empty.
// It renders find_resources (places), make_plan (steps) and check_provider
// (DOJ-listed options) from the tool's structuredContent.
//
// Bridge (copies the ext-apps SDK wire behavior, spec 2026-01-26):
//   app -> host  ui/initialize (request, no timeout), then ui/notifications/initialized
//   host -> app  ui/notifications/tool-input | tool-result | host-context-changed
//   app -> host  ui/notifications/size-changed (only after initialized; html max-content measure)
//   links        window.openai.openExternal first, else ui/open-link. tel: is shown as text only.
// ChatGPT compat: window.openai.toolOutput / theme / locale / displayMode, openai:set_globals.
//
// Bump CARD_URI (card-v2, ...) on ANY change to CARD_HTML: the URI is the
// host's cache key (ChatGPT may serve a cached copy for up to an hour).
// The page lives in String.raw, so the inline JS must never contain a backtick
// or a dollar sign followed by a brace.

export const CARD_URI = "ui://navigator/card-v2.html";
export const CARD_MIME = "text/html;profile=mcp-app";

/** resources/list entry. */
export const CARD_RESOURCE = {
  uri: CARD_URI,
  name: "navigator_card",
  title: "Tarjeta de resultados",
  description: "Lugares, plan paso a paso u opciones de las listas del DOJ, con fuente y fecha de revisión.",
  mimeType: CARD_MIME,
};

/** _meta on the resources/read content item. No ui.domain on purpose (each host wants its own format). */
export const CARD_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDescription":
    "Muestra lugares con dirección, horario, idiomas, fuente y fecha de revisión; o un plan paso a paso; " +
    "o si un notario o consultor aparece en las listas del DOJ, con opciones de esas listas cerca.",
  "openai/widgetPrefersBorder": true,
  // openExternal destinations ChatGPT should trust. Real source_url hosts go here once the data is real.
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
    redirect_domains: ["https://www.google.com", "https://maps.apple.com", "https://www.justice.gov"],
  },
};

export const CARD_HTML = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Navegador NYC</title>
<style>
:root{
  --bg:var(--color-background-primary,#ffffff);
  --bg2:var(--color-background-secondary,#f3f5f4);
  --fg:var(--color-text-primary,#16201f);
  --fg2:var(--color-text-secondary,#4d5b59);
  --line:var(--color-border-primary,#d9e0de);
  --accent:#1f5f5b; --accent-fg:#ffffff;
  --ok-bg:#e3f4ea; --ok-fg:#14532d; --warn-bg:#fdf0dc; --warn-fg:#7a4a00; --bad-bg:#fde5e3; --bad-fg:#8a1c12;
  --info-bg:#e5effa; --info-fg:#1d4370;
  --radius:var(--border-radius-md,12px);
  --font:var(--font-sans,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
  --sa-t:0px; --sa-r:0px; --sa-b:0px; --sa-l:0px;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:var(--color-background-primary,#151a19); --bg2:var(--color-background-secondary,#1f2625);
    --fg:var(--color-text-primary,#eef2f1); --fg2:var(--color-text-secondary,#a9b6b4); --line:var(--color-border-primary,#33403e);
    --accent:#5fb8b0; --accent-fg:#0d1716;
    --ok-bg:#16301f; --ok-fg:#a7e3bd; --warn-bg:#3a2a0f; --warn-fg:#f3cf8c; --bad-bg:#3d1714; --bad-fg:#f5b3ab;
    --info-bg:#172a40; --info-fg:#a9c8ee;
  }
}
:root[data-theme="dark"]{
  --bg:var(--color-background-primary,#151a19); --bg2:var(--color-background-secondary,#1f2625);
  --fg:var(--color-text-primary,#eef2f1); --fg2:var(--color-text-secondary,#a9b6b4); --line:var(--color-border-primary,#33403e);
  --accent:#5fb8b0; --accent-fg:#0d1716;
  --ok-bg:#16301f; --ok-fg:#a7e3bd; --warn-bg:#3a2a0f; --warn-fg:#f3cf8c; --bad-bg:#3d1714; --bad-fg:#f5b3ab;
  --info-bg:#172a40; --info-fg:#a9c8ee;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 var(--font);-webkit-text-size-adjust:100%}
#app{padding:calc(12px + var(--sa-t)) calc(12px + var(--sa-r)) calc(12px + var(--sa-b)) calc(12px + var(--sa-l));
  max-width:760px;margin:0 auto;overflow-wrap:anywhere}
h1{font-size:17px;margin:0 0 2px}
h2{font-size:16px;margin:0 0 4px}
p{margin:6px 0}
.sub{color:var(--fg2);font-size:13px;margin:0 0 10px}
.card{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);padding:12px;margin:0 0 10px}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;line-height:1.6}
.ok{background:var(--ok-bg);color:var(--ok-fg)} .warn{background:var(--warn-bg);color:var(--warn-fg)}
.bad{background:var(--bad-bg);color:var(--bad-fg)} .info{background:var(--info-bg);color:var(--info-fg)}
.muted{color:var(--fg2);font-size:13px}
.lbl{font-weight:600}
.phone{font-size:17px;font-weight:600;user-select:all;-webkit-user-select:all;letter-spacing:.2px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button{font:inherit;min-height:44px;min-width:44px;border-radius:10px;padding:8px 14px;cursor:pointer;
  border:1px solid var(--line);background:var(--bg2);color:var(--fg);flex:1 1 auto}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}
button.link{background:none;border:0;padding:0 2px;min-height:44px;color:var(--accent);text-decoration:underline;
  flex:0 1 auto;text-align:left;font-size:13px}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.foot{display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;border-top:1px solid var(--line);margin-top:10px;padding-top:2px}
.status{border-radius:var(--radius);padding:12px;margin:0 0 10px}
.status h2{font-size:17px}
.step{display:flex;gap:10px}
.num{flex:0 0 30px;height:30px;border-radius:50%;background:var(--accent);color:var(--accent-fg);
  display:flex;align-items:center;justify-content:center;font-weight:700}
.grow{flex:1;min-width:0}
.why{background:var(--info-bg);color:var(--info-fg);border-radius:8px;padding:6px 9px;font-size:13px;margin:6px 0}
.box{background:var(--bg2);border-radius:8px;padding:8px 10px;margin:6px 0;white-space:pre-line}
.note{background:var(--warn-bg);color:var(--warn-fg);border-radius:8px;padding:8px 10px;margin:0 0 10px;font-size:13px}
.disc{color:var(--fg2);font-size:12px;margin-top:4px}
ul{margin:4px 0;padding-left:20px}
details summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--accent)}
.sk{background:var(--bg2);border-radius:6px;height:14px;margin:8px 0;animation:pulse 1.2s ease-in-out infinite}
.sk.t{height:18px;width:60%} .sk.s{width:40%}
@keyframes pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
</style>
</head>
<body>
<div id="app" aria-live="polite">
  <div class="card" aria-hidden="true"><div class="sk t"></div><div class="sk"></div><div class="sk s"></div></div>
  <div class="card" aria-hidden="true"><div class="sk t"></div><div class="sk"></div><div class="sk s"></div></div>
</div>
<script>
(function () {
"use strict";
var oa = window.openai;
var app = document.getElementById("app");
var pending = new Map(), nextId = 0, ready = false, resizing = false, remeasure = function () {};
var ctx = {}, lastKey = "", lastData = null, lastResult = null;

// ---------- strings (Spanish default; any other language falls back to Spanish) ----------
var S = {
  es: {
    open: "Abierto ahora", later: "Abre más tarde hoy", hours: "Horario", langs: "Idiomas", bring: "Traer",
    source: "Fuente", checked: "revisado el", noSource: "Sin enlace de fuente", directions: "Cómo llegar",
    phone: "Teléfono", all: "Ver todos", steps: "Ver todos los pasos", why: "Por qué en este orden",
    places: "lugares", near: "cerca de", empty: "No encontramos resultados.", error: "No se pudo mostrar este resultado.",
    whatsapp: "Enviar a mi WhatsApp", sayWa: "Quiero recibir este plan por WhatsApp",
    listed: "Aparece en una lista del DOJ", notListed: "No aparece en las listas del DOJ que revisamos",
    options: "Opciones en las listas del DOJ", similar: "Nombres parecidos", verify: "Cómo verificarlo usted",
    list: "Lista", fee: "Costo", intake: "Cómo pedir cita", unknown: "No sabemos; pregunte al llamar",
    lawyer: "Para el abogado (en inglés)", plan: "Su plan", step: "Paso", legal: "Ayuda legal",
    km: "km"
  },
  en: {
    open: "Open now", later: "Opens later today", hours: "Hours", langs: "Languages", bring: "Bring",
    source: "Source", checked: "checked", noSource: "No source link", directions: "Directions",
    phone: "Phone", all: "See all", steps: "See all steps", why: "Why this order",
    places: "places", near: "near", empty: "No results found.", error: "This result could not be shown.",
    whatsapp: "Send to my WhatsApp", sayWa: "I want to get this plan on WhatsApp",
    listed: "Appears on a DOJ list", notListed: "Not on the DOJ lists we checked",
    options: "Options on the DOJ lists", similar: "Similar names", verify: "Check it yourself",
    list: "List", fee: "Cost", intake: "How to get an appointment", unknown: "Unknown; ask when you call",
    lawyer: "For the lawyer (English)", plan: "Your plan", step: "Step", legal: "Legal help",
    km: "km"
  }
};
function lang() {
  var l = (lastData && lastData.language) || ctx.locale || document.documentElement.lang || "es";
  return /^en/i.test(String(l)) ? "en" : "es";
}
function T(k) { return S[lang()][k] || S.es[k] || k; }

// ---------- tiny DOM helpers (textContent only, never innerHTML with data) ----------
function h(tag, cls, kids) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  (function add(k) { // children may be nested arrays
    if (Array.isArray(k)) { k.forEach(add); return; }
    if (k == null || k === false || k === "") return;
    e.appendChild(typeof k === "object" ? k : document.createTextNode(String(k)));
  })(kids);
  return e;
}
function btn(label, cls, onClick) { var b = h("button", cls, label); b.type = "button"; b.onclick = onClick; return b; }
function str(v) { return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; }
function arr(v) { return Array.isArray(v) ? v : []; }
function pick(o, keys) { for (var i = 0; i < keys.length; i++) { if (o && o[keys[i]] != null && o[keys[i]] !== "") return o[keys[i]]; } return null; }
function pickArr(o, keys) { for (var i = 0; i < keys.length; i++) { if (o && Array.isArray(o[keys[i]])) return o[keys[i]]; } return []; }
function fmtDate(d) {
  d = str(d); if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  try { return new Intl.DateTimeFormat(lang() === "en" ? "en-US" : "es-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d.slice(0, 10) + "T12:00:00Z")); }
  catch (e) { return d.slice(0, 10); }
}
function unknownText(v) { v = str(v); return !v || /^(unknown|desconocido)$/i.test(v) ? T("unknown") : v; }

// ---------- host actions ----------
function send(m) { window.parent.postMessage(m, "*"); }
function rpc(method, params, ms) {
  return new Promise(function (res, rej) {
    var id = ++nextId; pending.set(id, { res: res, rej: rej });
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    if (ms) setTimeout(function () { if (pending.has(id)) { pending.delete(id); rej({ code: -1, message: "timeout" }); } }, ms);
  });
}
function note(method, params) { send({ jsonrpc: "2.0", method: method, params: params }); }
function openLink(url) {
  if (!/^https?:\/\//i.test(url)) return;
  if (oa && oa.openExternal) { try { oa.openExternal({ href: url, redirectUrl: false }); return; } catch (e) {} }
  if (ready) { rpc("ui/open-link", { url: url }, 15000).catch(function () {}); return; }
  window.open(url, "_blank", "noopener"); // plain page (test harness): never navigate this frame
}
function say(text) {
  var viaOpenAI = function () { if (oa && oa.sendFollowUpMessage) oa.sendFollowUpMessage({ prompt: text, scrollToBottom: true }); };
  if (ready) rpc("ui/message", { role: "user", content: [{ type: "text", text: text }] }, 15000).catch(viaOpenAI);
  else viaOpenAI();
}
function fullscreen() {
  if (oa && oa.requestDisplayMode) { oa.requestDisplayMode({ mode: "fullscreen" }); return; }
  if (ready) rpc("ui/request-display-mode", { mode: "fullscreen" }, 15000).then(function (r) {
    if (r && r.mode) { ctx.displayMode = r.mode; rerender(); }
  }).catch(function () {});
}
function isFull() { return ctx.displayMode === "fullscreen" || !!(oa && oa.displayMode === "fullscreen"); }
function mapsUrl(p) {
  var q = encodeURIComponent([str(p.address), str(p.zip), "NY"].filter(Boolean).join(", "));
  var ios = ctx.platform === "mobile" && /iPhone|iPad/.test(navigator.userAgent);
  return ios ? "https://maps.apple.com/?q=" + q : "https://www.google.com/maps/search/?api=1&query=" + q;
}

// ---------- pieces ----------
function trustPill(p) {
  var label = str(p.trust_label) || str(p.trust); if (!label) return null;
  var t = str(p.trust), cls = t === "official" || t === "verified" ? "ok" : t === "community" ? "info" : "warn";
  return h("span", "pill " + cls, label);
}
function sourceFoot(p) {
  var url = str(p.source_url), date = str(pick(p, ["last_checked", "checked_on", "list_checked"]));
  var dateText = date ? T("checked") + " " + fmtDate(date) : "";
  var kids = [];
  if (/^https?:\/\//i.test(url)) kids.push(btn(T("source"), "link", function () { openLink(url); }));
  else kids.push(h("span", "muted", str(p.source_label) || T("noSource")));
  if (dateText) kids.push(h("span", "muted", "· " + dateText));
  return h("div", "foot", kids);
}
// One place: name, type, open pill, address, hours, phone as text, languages, bring, trust, source.
function placeCard(p, opts) {
  opts = opts || {};
  if (!p || typeof p !== "object") return null;
  var langs = arr(p.languages).join(", "), bring = arr(p.bring).join(", ");
  var pills = [];
  if (p.open_now === true) pills.push(h("span", "pill ok", T("open")));
  else if (p.open_today === true) pills.push(h("span", "pill info", T("later")));
  pills.push(trustPill(p));
  if (typeof p.distance_km === "number") pills.push(h("span", "muted", p.distance_km.toFixed(1) + " " + T("km")));
  var extra = [];
  ["fee", "cost"].forEach(function (k) { if (k in p) extra.push(h("p", null, [h("span", "lbl", T("fee") + ": "), unknownText(p[k])])); });
  ["intake", "intake_how", "how_to_get_help"].forEach(function (k) { if (k in p) extra.push(h("p", null, [h("span", "lbl", T("intake") + ": "), unknownText(p[k])])); });
  var actions = [];
  if (str(p.address)) actions.push(btn(T("directions"), "primary", function () { openLink(mapsUrl(p)); }));
  return h("div", opts.flat ? null : "card", [
    h("h2", null, str(p.name) || str(p.org)),
    str(p.type_label) ? h("div", "muted", p.type_label) : null,
    h("div", "row", pills),
    !opts.compact && str(p.summary) ? h("p", null, p.summary) : null,
    str(p.address) ? h("p", null, [p.address, str(p.zip) && p.address.indexOf(p.zip) < 0 ? ", " + p.zip : ""]) : null,
    str(p.hours) ? h("p", null, [h("span", "lbl", T("hours") + ": "), p.hours]) : null,
    str(p.phone) ? h("p", null, [h("span", "lbl", T("phone") + ": "), h("span", "phone", p.phone)]) : null,
    langs ? h("p", null, [h("span", "lbl", T("langs") + ": "), langs]) : null,
    !opts.compact && bring ? h("p", null, [h("span", "lbl", T("bring") + ": "), bring]) : null,
    extra,
    actions.length ? h("div", "actions", actions) : null,
    sourceFoot(p)
  ]);
}
function banners(sc) {
  return [str(sc.message) ? h("div", "note", sc.message) : null, str(sc.note) ? h("div", "note", sc.note) : null];
}
function moreButton(total, shown, key) {
  if (isFull() || total <= shown) return null;
  return h("div", "actions", [btn(T(key) + " (" + total + ")", null, fullscreen)]);
}
function legalBlock(fp) {
  if (!fp || typeof fp !== "object") return null;
  return h("div", null, [h("h2", null, T("legal")), placeCard(fp, { compact: true })]);
}

// ---------- views ----------
function viewResources(sc) {
  var list = arr(sc.results), shown = isFull() ? list : list.slice(0, 3);
  var open = list.filter(function (p) { return p && p.open_now === true; }).length;
  var sub = list.length + " " + T("places") + (str(sc.near) ? " " + T("near") + " " + sc.near : "") +
    (open ? " · " + open + " " + T("open").toLowerCase() : "");
  return [
    h("h1", null, str(sc.need_label) || str(sc.need) ? (str(sc.need_label) || sc.need).replace(/^./, function (c) { return c.toUpperCase(); }) : T("places")),
    h("p", "sub", sub),
    banners(sc),
    list.length ? shown.map(function (p) { return placeCard(p); }) : h("p", null, T("empty")),
    moreButton(list.length, shown.length, "all"),
    legalBlock(sc.free_legal_provider && !list.some(function (p) { return p && p.id === sc.free_legal_provider.id; }) ? sc.free_legal_provider : null)
  ];
}
function viewPlan(sc) {
  var steps = arr(sc.steps), shown = isFull() ? steps : steps.slice(0, 3);
  var intake = sc.intake_summary && typeof sc.intake_summary === "object" ? sc.intake_summary : null;
  return [
    h("h1", null, T("plan")),
    str(sc.intro) ? h("p", "sub", sc.intro) : null,
    banners(sc),
    shown.map(function (s, i) {
      var bring = arr(s.bring).join(", ");
      return h("div", "card step", [
        h("div", "num", String(s.step || i + 1)),
        h("div", "grow", [
          h("h2", null, str(s.title) || str(s.need_label) || T("step") + " " + (i + 1)),
          str(s.summary) ? h("p", null, s.summary) : null,
          str(s.why_this_order) ? h("div", "why", [h("span", "lbl", T("why") + ": "), s.why_this_order]) : null,
          bring ? h("p", null, [h("span", "lbl", T("bring") + ": "), bring]) : null,
          s.program && str(s.program.before_you_apply) ? h("div", "note", s.program.before_you_apply) : null,
          s.place ? placeCard(s.place, { compact: true, flat: true }) : (s.program ? sourceFoot(s.program) : null)
        ])
      ]);
    }),
    moreButton(steps.length, shown.length, "steps"),
    intake ? h("div", "card", [
      h("h2", null, str(intake.title_person) || T("intake")),
      str(intake.for_person_es) ? h("div", "box", intake.for_person_es) : null,
      str(intake.for_lawyer_en) ? h("details", null, [h("summary", null, str(intake.title_lawyer) || T("lawyer")), h("div", "box", intake.for_lawyer_en)]) : null
    ]) : null,
    legalBlock(sc.free_legal_provider && !steps.some(function (s) { return s && s.place && s.place.id === sc.free_legal_provider.id; }) ? sc.free_legal_provider : null),
    steps.length ? h("div", "actions", [btn(T("whatsapp"), "primary", function () { say(T("sayWa")); })]) : null
  ];
}
// check_provider. Field names are read defensively: the tool's wording is still changing.
function viewProvider(sc) {
  var found = sc.found === true, m = sc.match && typeof sc.match === "object" ? sc.match : null;
  var options = pickArr(sc, ["doj_listed_options", "free_legal_providers", "options", "providers"]);
  var listName = str(pick(sc, ["list_name", "doj_list_name", "lists_checked"]));
  var listDate = str(pick(sc, ["list_checked", "list_last_checked", "checked_on", "lists_checked_on"]));
  var how = arr(sc.how_to_verify), possible = arr(sc.possible_matches);
  var title = str(pick(sc, ["status_title", "headline"])) || (found ? T("listed") : T("notListed"));
  return [
    h("div", "status " + (found ? "ok" : "bad"), [
      h("h2", null, title),
      str(sc.query_name) ? h("div", null, "“" + sc.query_name + "”") : null,
      m ? h("p", null, [h("span", "lbl", str(m.name) || str(m.org)), str(m.address) ? " · " + m.address : ""]) : null,
      str(sc.what_this_means) ? h("p", null, sc.what_this_means) : null,
      str(sc.warning) ? h("p", "lbl", sc.warning) : null,
      listName || listDate ? h("p", "muted", [listName ? T("list") + ": " + listName : "", listName && listDate ? " · " : "", listDate ? T("checked") + " " + fmtDate(listDate) : ""]) : null,
      m ? sourceFoot(m) : null
    ]),
    possible.length ? h("div", "card", [h("h2", null, T("similar")), h("ul", null, possible.map(function (p) {
      return h("li", null, [str(p.name), str(p.address) ? " · " + p.address : ""]);
    }))]) : null,
    h("h1", null, str(pick(sc, ["options_title", "free_providers_title"])) || T("options")),
    str(sc.trust_note) ? h("div", "note", sc.trust_note) : null,
    (isFull() ? options : options.slice(0, 3)).map(function (p) { return placeCard(p, { compact: true }); }),
    moreButton(options.length, Math.min(3, options.length), "all"),
    how.length ? h("div", "card", [h("h2", null, T("verify")), how.map(function (v) {
      var url = str(v && v.url), label = str(v && v.label) || url;
      return /^https?:\/\//i.test(url) ? h("div", null, btn(label, "link", function () { openLink(url); })) : h("p", null, label);
    })]) : null
  ];
}

// ---------- render ----------
function kindOf(sc) {
  if (str(sc.kind)) return sc.kind;
  if (Array.isArray(sc.steps)) return "plan";
  if ("found" in sc || "what_this_means" in sc) return "provider_check";
  if (Array.isArray(sc.results)) return "resources";
  return "";
}
function fromContent(result) {
  var blocks = arr(result && result.content);
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].type === "text") {
      try { var o = JSON.parse(blocks[i].text); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch (e) {}
    }
  }
  return null;
}
function show(nodes) {
  app.textContent = "";
  [].concat(nodes).forEach(function add(n) { if (Array.isArray(n)) n.forEach(add); else if (n) app.appendChild(n); });
}
function showError(result) {
  var first = arr(result && result.content)[0];
  show([h("div", "card", [h("p", null, T("error")), first && str(first.text) ? h("p", "muted", first.text) : null])]);
}
function render(sc, result) {
  if (result) lastResult = result;
  if ((!sc || typeof sc !== "object") && result) sc = fromContent(result);
  if (result && result.isError) { showError(result); return; }
  if (!sc || typeof sc !== "object") return;
  var key = JSON.stringify(sc);
  if (key === lastKey) return; // ChatGPT may deliver toolOutput and tool-result
  lastKey = key; lastData = sc; rerender();
}
function rerender() {
  var sc = lastData; if (!sc) return;
  document.documentElement.lang = lang();
  var k = kindOf(sc), body;
  try {
    body = k === "resources" ? viewResources(sc) : k === "plan" ? viewPlan(sc) : k === "provider_check" ? viewProvider(sc) : null;
  } catch (e) { body = null; if (window.console) console.error("card render failed", e); }
  if (!body) { showError(lastResult); return; }
  if (str(sc.disclaimer)) body.push(h("p", "disc", sc.disclaimer));
  show(body);
  remeasure();
}

// ---------- host context: theme, CSS variables, safe area, platform, locale, display mode ----------
function applyCtx(c) {
  if (!c || typeof c !== "object") return;
  var before = lang() + "|" + isFull();
  Object.keys(c).forEach(function (k) { ctx[k] = c[k]; });
  var root = document.documentElement;
  if (c.theme === "dark" || c.theme === "light") root.setAttribute("data-theme", c.theme);
  var vars = c.styles && c.styles.variables;
  if (vars && typeof vars === "object") Object.keys(vars).forEach(function (k) { if (vars[k]) root.style.setProperty(k, vars[k]); });
  var sa = c.safeAreaInsets || (c.safeArea && (c.safeArea.insets || c.safeArea)); // openai safeArea shape unconfirmed
  if (sa) ["top", "right", "bottom", "left"].forEach(function (s) {
    if (typeof sa[s] === "number") root.style.setProperty("--sa-" + s[0], sa[s] + "px");
  });
  if (c.platform) document.body.className = "p-" + String(c.platform);
  if (lang() + "|" + isFull() !== before) rerender();
}

// ---------- size reporting (ext-apps SDK technique) ----------
function startAutoResize() {
  if (resizing) return; resizing = true;
  var scheduled = false, lw = 0, lh = 0;
  function measure() {
    if (scheduled) return; scheduled = true;
    var run = function () {
      if (!scheduled) return; // rAF and the timer race; first one wins
      scheduled = false;
      var html = document.documentElement, old = html.style.height;
      html.style.height = "max-content";
      var hgt = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = old;
      var w = Math.ceil(window.innerWidth);
      if (w !== lw || hgt !== lh) {
        lw = w; lh = hgt;
        if (ready) note("ui/notifications/size-changed", { width: w, height: hgt });
        if (oa && oa.notifyIntrinsicHeight) { try { oa.notifyIntrinsicHeight(hgt); } catch (e) {} }
      }
    };
    requestAnimationFrame(run);
    setTimeout(run, 150); // some webviews pause rAF; still report the new height
  }
  remeasure = measure;
  measure();
  if (window.ResizeObserver) { var ro = new ResizeObserver(measure); ro.observe(document.documentElement); ro.observe(document.body); }
}

// ---------- MCP Apps messages ----------
window.addEventListener("message", function (e) {
  if (e.source !== window.parent) return;
  var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id != null && !m.method) {
    var p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.error) p.rej(m.error); else p.res(m.result); }
    return;
  }
  var params = m.params || {};
  switch (m.method) {
    case "ui/notifications/tool-result": render(params.structuredContent, params); break;
    case "ui/notifications/tool-input": case "ui/notifications/tool-input-partial": break; // skeleton stays up
    case "ui/notifications/tool-cancelled": showError(null); break;
    case "ui/notifications/host-context-changed": applyCtx(params); break;
    case "ui/resource-teardown": case "ping": if (m.id != null) send({ jsonrpc: "2.0", id: m.id, result: {} }); break;
    default: if (m.id != null) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
});

// ---------- ChatGPT (window.openai) fallback; feature-detected, never by host name ----------
if (oa) {
  applyCtx({ theme: oa.theme, locale: oa.locale, displayMode: oa.displayMode, safeArea: oa.safeArea });
  if (oa.toolOutput) render(oa.toolOutput);
  startAutoResize();
}
window.addEventListener("openai:set_globals", function (e) {
  var g = (e.detail && e.detail.globals) || {};
  applyCtx({ theme: g.theme, locale: g.locale, displayMode: g.displayMode, safeArea: g.safeArea });
  if (g.toolOutput) render(g.toolOutput);
});

// ---------- handshake: host sends nothing before 'initialized'. No timeout, like the SDK. ----------
if (window.parent !== window) {
  rpc("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "nyc-navigator-card", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
  }, 0).then(function (r) {
    applyCtx(r && r.hostContext);
    note("ui/notifications/initialized", {});
    ready = true; resizing = false; startAutoResize();
  }).catch(function () {});
}
})();
</script>
</body>
</html>`;
