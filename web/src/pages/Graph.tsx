// "Mapa de recursos": a visual wiki of every resource. A canvas force graph of
// the 10 need hubs, the programs and the places (organizations only), with a
// wiki panel beside it: search, need chips, borough, the selected resource's
// "article", and a plain keyboard-friendly list of every matching resource.
//
// Data: public/graph.json, built by `npm run graph:data` (scripts/graph-data.mjs)
// with the force layout already computed, so the browser only draws. If a
// graph.json without positions shows up, the layout runs here once (300 ticks,
// no animation) and then freezes. Drawing happens only on interaction.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { useI18n } from "../i18n.tsx";
import { TrustBadge } from "../components/PlaceCard.tsx";
import { BOROUGHS, NEEDS } from "../types.ts";
import type { Need } from "../types.ts";

// ---------- data ----------

type NodeType = "need" | "program" | "place";

interface GNode {
  id: string;
  type: NodeType;
  label: string;
  needs: Need[];
  borough?: string;
  zip?: string;
  hood?: string;
  org_type?: string;
  org?: string;
  trust?: string;
  address?: string;
  phone?: string;
  hours?: string;
  languages?: string[];
  source_url?: string;
  last_checked?: string;
  summary_es?: string;
  summary_en?: string;
  who?: string;
  /** Programs: documents the "what to bring" text names (knowledge graph). */
  docs_es?: string[];
  docs_en?: string[];
  /** Places: locations of the same organization, and its DOJ accredited representatives (a count). */
  org_locations?: number;
  accredited_reps?: number;
  x: number;
  y: number;
  r: number;
}

interface GEdge {
  source: string;
  target: string;
  type: "offers" | "unlocks" | "pairs_with" | "requires" | "refers_to" | "need" | string;
  reason?: string;
}

interface GraphFile {
  generated: string;
  counts: { places: number; programs: number; needs: number; people_excluded: number; edges: number };
  nodes: GNode[];
  edges: GEdge[];
}

interface Edge {
  s: GNode;
  t: GNode;
  type: string;
  reason?: string;
}

interface Prepared {
  file: GraphFile;
  nodes: GNode[];
  byId: Map<string, GNode>;
  edges: Edge[];
  adj: Map<string, Set<string>>;
  /** Edges touching a node, both directions. */
  edgesOf: Map<string, Edge[]>;
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

function prepare(file: GraphFile): Prepared {
  const nodes = file.nodes.map((n) => ({ ...n, needs: (n.needs ?? []) as Need[], r: n.r || (n.type === "need" ? 24 : n.type === "program" ? 6 : 3.2) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (nodes.some((n) => typeof n.x !== "number" || typeof n.y !== "number")) layout(nodes, file.edges);
  const edges: Edge[] = [];
  const adj = new Map<string, Set<string>>();
  const edgesOf = new Map<string, Edge[]>();
  for (const e of file.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const edge = { s, t, type: e.type, reason: e.reason };
    edges.push(edge);
    for (const [a, b] of [[s, t], [t, s]]) {
      if (!adj.has(a.id)) adj.set(a.id, new Set());
      adj.get(a.id)!.add(b.id);
      if (!edgesOf.has(a.id)) edgesOf.set(a.id, []);
      edgesOf.get(a.id)!.push(edge);
    }
  }
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of nodes) {
    bounds.x0 = Math.min(bounds.x0, n.x - n.r);
    bounds.y0 = Math.min(bounds.y0, n.y - n.r);
    bounds.x1 = Math.max(bounds.x1, n.x + n.r);
    bounds.y1 = Math.max(bounds.y1, n.y + n.r);
  }
  // Need sort for a stable draw order: places, then programs, then hubs on top.
  const order: Record<NodeType, number> = { place: 0, program: 1, need: 2 };
  nodes.sort((a, b) => order[a.type] - order[b.type]);
  return { file, nodes, byId, edges, adj, edgesOf, bounds };
}

/** Fallback when graph.json has no positions: settle the simulation off-screen, then freeze. */
function layout(nodes: GNode[], rawEdges: GEdge[]) {
  type S = SimulationNodeDatum & { id: string; r: number; hub: boolean };
  const ring = NEEDS.length;
  const sim: S[] = nodes.map((n) => {
    const s: S = { id: n.id, r: n.r, hub: n.type === "need" };
    if (n.type === "need") {
      const a = (NEEDS.indexOf(n.needs[0]) / ring) * Math.PI * 2 - Math.PI / 2;
      s.fx = Math.cos(a) * 560;
      s.fy = Math.sin(a) * 560;
    }
    return s;
  });
  const links: SimulationLinkDatum<S>[] = rawEdges.map((e) => ({ source: e.source, target: e.target }));
  const simulation = forceSimulation(sim)
    .force("link", forceLink<S, SimulationLinkDatum<S>>(links).id((d) => d.id).distance(50).strength(0.2))
    .force("charge", forceManyBody<S>().strength((d) => (d.hub ? -400 : -8)).distanceMax(260))
    .force("collide", forceCollide<S>().radius((d) => d.r + 1.6))
    .stop();
  for (let i = 0; i < 300; i++) simulation.tick();
  sim.forEach((s, i) => {
    nodes[i].x = s.x ?? 0;
    nodes[i].y = s.y ?? 0;
  });
}

// ---------- colors ----------

// One categorical palette for the 10 needs, tuned for both a white and a near-black background.
const PALETTE: Record<Need, [string, string]> = {
  food: ["#e8710a", "#f59e4c"],
  legal: ["#3b6fb6", "#7aa7e6"],
  health: ["#d6404e", "#f27983"],
  benefits: ["#3d9a50", "#6cc47d"],
  money: ["#b8901a", "#e8c547"],
  school: ["#9b5fa8", "#c596d4"],
  id: ["#1f9486", "#5cc8b8"],
  housing: ["#8c6a4f", "#c29f84"],
  work: ["#d6538b", "#f29bbf"],
  transit: ["#6f7a1f", "#b4be52"],
};

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function useDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => setDark(isDark());
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return dark;
}

function needColor(n: Need | undefined, dark: boolean): string {
  return n ? PALETTE[n][dark ? 1 : 0] : dark ? "#a1a1aa" : "#71717a";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// ---------- strings ----------

const STR = {
  es: {
    title: "Mapa de recursos",
    intro: "Cada lugar y programa del directorio, conectado con lo que necesita: toque un punto para leer su ficha.",
    counts: "{p} lugares · {g} programas · 10 necesidades",
    search: "Buscar por nombre, código postal o barrio",
    searchPh: "Ej.: Corona, 11368, IDNYC",
    needs: "Necesidades",
    all: "Todas",
    borough: "Condado",
    boroughAll: "Toda la ciudad",
    results: "{n} resultados",
    resultsOne: "1 resultado",
    none: "Nada coincide. Pruebe otra palabra o quite un filtro.",
    showMore: "Mostrar más",
    clear: "Quitar filtros",
    loading: "Cargando el mapa…",
    error: "No pudimos cargar el mapa. Intente de nuevo.",
    retry: "Intentar de nuevo",
    canvasLabel: "Mapa de {p} lugares y {g} programas conectados con 10 necesidades. Use la lista de resultados para recorrerlo con el teclado.",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    reset: "Ver todo",
    hint: "Arrastre para mover · rueda o pellizco para acercar · toque un punto",
    typeNeed: "Necesidad",
    typeProgram: "Programa",
    typePlace: "Lugar",
    placesHere: "Lugares que lo ofrecen",
    programsHere: "Programas aquí",
    programsForNeed: "Programas",
    placesForNeed: "{n} lugares",
    related: "Conexiones",
    who: "Quién puede usarlo",
    address: "Dirección",
    map: "Ver en Google Maps",
    call: "Llamar",
    hours: "Horario",
    hoursUnknown: "Horario por confirmar",
    languages: "Idiomas",
    source: "Fuente",
    checked: "revisado el {d}",
    fullPage: "Leer la página completa",
    filterNeed: "Mostrar solo esta necesidad",
    close: "Cerrar ficha",
    pick: "Elija un punto del mapa o un resultado de la lista para leer su ficha.",
    readArticle: "Ver ficha",
    excluded: "No mostramos a personas individuales (representantes acreditados), solo organizaciones.",
    link_unlocks: "Le abre la puerta a",
    link_unlocks_in: "Se consigue con",
    link_requires: "Requiere",
    link_requires_in: "Lo necesita",
    link_pairs_with: "Va bien con",
    link_refers_to: "Refiere a",
    link_refers_to_in: "Le llegan referidos de",
    more: "y {n} más",
  },
  en: {
    title: "Resource graph",
    intro: "Every place and program in the directory, connected to what you need: tap a dot to read its page.",
    counts: "{p} places · {g} programs · 10 needs",
    search: "Search by name, zip code or neighborhood",
    searchPh: "E.g. Corona, 11368, IDNYC",
    needs: "Needs",
    all: "All",
    borough: "Borough",
    boroughAll: "All of NYC",
    results: "{n} results",
    resultsOne: "1 result",
    none: "Nothing matches. Try another word or remove a filter.",
    showMore: "Show more",
    clear: "Clear filters",
    loading: "Loading the graph…",
    error: "We couldn't load the graph. Please try again.",
    retry: "Try again",
    canvasLabel: "Graph of {p} places and {g} programs connected to 10 needs. Use the results list to browse it with a keyboard.",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Show all",
    hint: "Drag to move · scroll or pinch to zoom · tap a dot",
    typeNeed: "Need",
    typeProgram: "Program",
    typePlace: "Place",
    placesHere: "Places that offer it",
    programsHere: "Programs here",
    programsForNeed: "Programs",
    placesForNeed: "{n} places",
    related: "Connections",
    who: "Who can use it",
    address: "Address",
    map: "Open in Google Maps",
    call: "Call",
    hours: "Hours",
    hoursUnknown: "Hours to be confirmed",
    languages: "Languages",
    source: "Source",
    checked: "checked {d}",
    fullPage: "Read the full page",
    filterNeed: "Show only this need",
    close: "Close page",
    pick: "Pick a dot on the graph or a result in the list to read its page.",
    readArticle: "Read page",
    excluded: "Individual people (accredited representatives) are not shown, only organizations.",
    link_unlocks: "Opens the door to",
    link_unlocks_in: "You can get it with",
    link_requires: "Requires",
    link_requires_in: "Needed for",
    link_pairs_with: "Goes well with",
    link_refers_to: "Refers to",
    link_refers_to_in: "Gets referrals from",
    more: "and {n} more",
  },
} as const;
type Strings = { [K in keyof typeof STR.es]: string };

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const isWebUrl = (u?: string) => !!u && /^https?:\/\//i.test(u);

// ---------- page ----------

const PAGE = 40;

export function Graph() {
  const { lang, label } = useI18n();
  const S: Strings = STR[lang];
  const dark = useDark();
  const [graph, setGraph] = useState<Prepared | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState("");
  const [need, setNeed] = useState<Need | "">("");
  const [borough, setBorough] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetch("graph.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<GraphFile>;
      })
      .then((f) => !cancelled && setGraph(prepare(f)))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => setShown(PAGE), [q, need, borough]);

  const filtering = !!(q.trim() || need || borough);

  // Matching resources (programs and places; need hubs are reached with the chips).
  const matches = useMemo(() => {
    if (!graph) return [] as GNode[];
    const words = fold(q).split(/\s+/).filter(Boolean);
    const out = graph.nodes.filter((n) => {
      if (n.type === "need") return false;
      if (need && !n.needs.includes(need)) return false;
      if (borough && n.borough !== borough) return false;
      if (!words.length) return true;
      const hay = fold([
        n.label, n.org, n.address, n.zip, n.hood, n.borough,
        n.org_type ? label("org", n.org_type) : "",
        ...n.needs.map((x) => label("need", x)),
      ].filter(Boolean).join(" "));
      return words.every((w) => hay.includes(w));
    });
    return out.sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label, lang) : a.type === "program" ? -1 : 1));
  }, [graph, q, need, borough, label, lang]);

  const matchSet = useMemo(() => {
    if (!filtering) return null;
    const s = new Set(matches.map((n) => n.id));
    if (need) s.add(`need-${need}`);
    else for (const n of matches) for (const x of n.needs) s.add(`need-${x}`);
    return s;
  }, [filtering, matches, need]);

  const selected = selectedId && graph ? graph.byId.get(selectedId) ?? null : null;

  const select = useCallback((id: string | null, opts?: { center?: boolean }) => {
    setSelectedId(id);
    if (id && opts?.center) setFocusReq((r) => ({ id, n: (r?.n ?? 0) + 1 }));
    // Shareable link (#/graph?id=...) without firing hashchange (no scroll jump).
    const h = window.location.hash;
    if (h.startsWith("#/graph")) {
      const rest = h.replace(/^#\/graph\/?\??/, "").split("&").filter((x) => x && !x.startsWith("id="));
      if (id) rest.push(`id=${encodeURIComponent(id)}`);
      history.replaceState(null, "", `#/graph${rest.length ? `?${rest.join("&")}` : ""}`);
    }
  }, []);

  // Open the resource named in the link (#/graph?id=prog-snap) once the graph loads.
  useEffect(() => {
    if (!graph) return;
    const m = /[?&]id=([^&]+)/.exec(window.location.hash);
    const id = m ? decodeURIComponent(m[1]) : "";
    if (id && graph.byId.has(id)) select(id, { center: true });
  }, [graph, select]);

  const clearFilters = () => {
    setQ("");
    setNeed("");
    setBorough("");
  };

  const counts = graph?.file.counts;

  return (
    <div
      className="relative left-1/2 w-[min(1400px,calc(100vw-32px))] -translate-x-1/2"
      lang={lang}
    >
      <header className="mb-4 max-w-3xl">
        <h1>{S.title}</h1>
        <p className="text-muted-foreground">{S.intro}</p>
        {counts && (
          <p className="text-sm text-muted-foreground">
            {fill(S.counts, { p: counts.places, g: counts.programs })}
          </p>
        )}
      </header>

      {error ? (
        <div className="card" role="alert">
          <p>{S.error}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setReload((n) => n + 1)}>{S.retry}</button>
        </div>
      ) : !graph ? (
        <p className="text-muted-foreground" role="status">{S.loading}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <GraphCanvas
            graph={graph}
            dark={dark}
            selectedId={selectedId}
            matchSet={matchSet}
            focusReq={focusReq}
            onSelect={(id) => select(id)}
            S={S}
            needLabel={(n) => label("need", n)}
            onReadArticle={() => articleRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" })}
            selectedLabel={selected?.type === "need" ? label("need", selected.needs[0]) : selected?.label}
          />

          <aside
            className="flex min-w-0 flex-col gap-4 lg:max-h-[min(760px,calc(100vh-150px))] lg:overflow-y-auto lg:pr-1"
            aria-label={S.title}
          >
            {/* Filters */}
            <div className="flex flex-col gap-3">
              <label className="field">
                <span>{S.search}</span>
                <input
                  type="search"
                  value={q}
                  placeholder={S.searchPh}
                  onChange={(e) => setQ(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <fieldset className="field">
                <legend>{S.needs}</legend>
                <div className="chips wrap">
                  <button type="button" className="chip" aria-pressed={need === ""} onClick={() => setNeed("")}>
                    {S.all}
                  </button>
                  {NEEDS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="chip inline-flex items-center gap-2"
                      aria-pressed={need === n}
                      onClick={() => setNeed(need === n ? "" : n)}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
                        style={{ background: needColor(n, dark) }}
                      />
                      {label("need", n)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>{S.borough}</span>
                <select value={borough} onChange={(e) => setBorough(e.target.value)}>
                  <option value="">{S.boroughAll}</option>
                  {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            </div>

            {/* Article */}
            <section ref={articleRef} aria-live="polite" className="scroll-mt-24">
              {selected ? (
                <Article
                  node={selected}
                  graph={graph}
                  S={S}
                  dark={dark}
                  onOpen={(id) => select(id, { center: true })}
                  onClose={() => select(null)}
                  onFilterNeed={(n) => setNeed(n)}
                />
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{S.pick}</p>
              )}
            </section>

            {/* Plain list: the accessible way through the graph */}
            <section aria-labelledby="graph-results-h">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id="graph-results-h" className="m-0 text-base" aria-live="polite">
                  {matches.length === 1 ? S.resultsOne : fill(S.results, { n: matches.length })}
                </h2>
                {filtering && (
                  <button type="button" className="btn-link text-sm" onClick={clearFilters}>{S.clear}</button>
                )}
              </div>
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">{S.none}</p>
              ) : (
                <ResultList
                  items={matches.slice(0, shown)}
                  selectedId={selectedId}
                  dark={dark}
                  S={S}
                  onPick={(id) => select(id, { center: true })}
                />
              )}
              {matches.length > shown && (
                <button type="button" className="btn btn-secondary btn-block mt-3" onClick={() => setShown((s) => s + PAGE)}>
                  {S.showMore} ({shown} / {matches.length})
                </button>
              )}
              {counts && counts.people_excluded > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">{S.excluded}</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------- list ----------

function ResultList({ items, selectedId, dark, S, onPick }: {
  items: GNode[];
  selectedId: string | null;
  dark: boolean;
  S: Strings;
  onPick: (id: string) => void;
}) {
  const { label } = useI18n();
  const onKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
  };
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" onKeyDown={onKeyDown}>
      {items.map((n) => {
        const where = [n.hood, n.borough, n.zip].filter(Boolean).join(" · ");
        const kind = n.type === "program" ? S.typeProgram : n.org_type ? label("org", n.org_type) : S.typePlace;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onPick(n.id)}
              aria-current={selectedId === n.id ? "true" : undefined}
              className={`flex w-full min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-left font-[inherit] text-sm text-foreground transition-colors hover:bg-muted ${
                selectedId === n.id ? "border-foreground bg-muted" : "border-transparent bg-transparent"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 inline-block shrink-0 rounded-full ${n.type === "program" ? "h-3 w-3 ring-2 ring-background outline outline-1 outline-current" : "h-2.5 w-2.5"}`}
                style={{ background: needColor(n.needs[0], dark), color: needColor(n.needs[0], dark) }}
              />
              <span className="min-w-0">
                <span className="block font-medium leading-snug">{n.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {kind}
                  {where ? ` · ${where}` : ""}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- article ----------

function NodeLinks({ list, max = 12, dark, S, onOpen }: {
  list: GNode[];
  max?: number;
  dark: boolean;
  S: Strings;
  onOpen: (id: string) => void;
}) {
  const { label } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, max);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {shown.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-left font-[inherit] text-[0.8125rem] text-foreground hover:bg-muted"
            onClick={() => onOpen(n.id)}
          >
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: needColor(n.needs[0], dark) }} />
            {n.type === "need" ? label("need", n.needs[0]) : n.label}
          </button>
        </li>
      ))}
      {!all && list.length > max && (
        <li>
          <button type="button" className="btn-link min-h-9 text-[0.8125rem]" onClick={() => setAll(true)}>
            {fill(S.more, { n: list.length - max })}
          </button>
        </li>
      )}
    </ul>
  );
}


function Article({ node, graph, S, dark, onOpen, onClose, onFilterNeed }: {
  node: GNode;
  graph: Prepared;
  S: Strings;
  dark: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onFilterNeed: (n: Need) => void;
}) {
  const { label, date, lang } = useI18n();
  const edges = graph.edgesOf.get(node.id) ?? [];
  const typeName = node.type === "need" ? S.typeNeed : node.type === "program" ? S.typeProgram : S.typePlace;
  const title = node.type === "need" ? label("need", node.needs[0]) : node.label;

  const needChips = node.type !== "need" && node.needs.length > 0 && (
    <NodeLinks dark={dark} S={S} onOpen={onOpen} list={node.needs.map((n) => graph.byId.get(`need-${n}`)!).filter(Boolean)} />
  );

  let body: ReactNode;
  if (node.type === "need") {
    const n = node.needs[0];
    const members = edges.filter((e) => e.type === "need").map((e) => (e.s.id === node.id ? e.t : e.s));
    const programs = members.filter((m) => m.type === "program").sort((a, b) => a.label.localeCompare(b.label, lang));
    const places = members.filter((m) => m.type === "place");
    body = (
      <>
        <p className="text-sm text-muted-foreground">
          {fill(S.placesForNeed, { n: places.length })} · {programs.length} {S.programsForNeed.toLowerCase()}
        </p>
        {programs.length > 0 && (
          <>
            <h4 className="mb-1.5 mt-3 text-sm font-semibold">{S.programsForNeed}</h4>
            <NodeLinks dark={dark} S={S} onOpen={onOpen} list={programs} max={20} />
          </>
        )}
        <button type="button" className="btn btn-secondary mt-3" onClick={() => onFilterNeed(n)}>{S.filterNeed}</button>
      </>
    );
  } else if (node.type === "program") {
    const offeredBy = edges.filter((e) => e.type === "offers" && e.t.id === node.id).map((e) => e.s);
    const rel = edges.filter((e) => e.type !== "offers" && e.type !== "need");
    const groups = new Map<string, { node: GNode; reason?: string }[]>();
    for (const e of rel) {
      const out = e.s.id === node.id;
      const key = e.type === "pairs_with" ? "link_pairs_with" : `link_${e.type}${out ? "" : "_in"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ node: out ? e.t : e.s, reason: e.reason });
    }
    const summary = lang === "es" ? node.summary_es || node.summary_en : node.summary_en || node.summary_es;
    body = (
      <>
        {summary && <p>{summary}</p>}
        {needChips}
        {node.who && (
          <>
            <h4 className="mb-1 mt-3 text-sm font-semibold">{S.who}</h4>
            <p className="text-sm">{node.who}</p>
          </>
        )}
        {(lang === "es" ? node.docs_es : node.docs_en)?.length ? (
          <>
            <h4 className="mb-1 mt-3 text-sm font-semibold">{lang === "es" ? "Qué piden" : "What they ask for"}</h4>
            <p className="text-sm">{(lang === "es" ? node.docs_es : node.docs_en)!.join(" · ")}</p>
          </>
        ) : null}
        {offeredBy.length > 0 && (
          <>
            <h4 className="mb-1.5 mt-3 text-sm font-semibold">{S.placesHere}</h4>
            <NodeLinks dark={dark} S={S} onOpen={onOpen} list={offeredBy} />
          </>
        )}
        {groups.size > 0 && (
          <>
            <h4 className="mb-1.5 mt-3 text-sm font-semibold">{S.related}</h4>
            <dl className="m-0 grid gap-2">
              {[...groups].map(([key, list]) => (
                <div key={key}>
                  <dt className="text-xs font-medium text-muted-foreground">{(S as Record<string, string>)[key] ?? key}</dt>
                  <dd className="m-0 mt-1">
                    <NodeLinks dark={dark} S={S} onOpen={onOpen} list={list.map((x) => x.node)} />
                    {list.some((x) => x.reason) && (
                      <ul className="mt-1 mb-0 pl-4 text-xs text-muted-foreground">
                        {list.filter((x) => x.reason).map((x) => <li key={x.node.id}>{x.reason}</li>)}
                      </ul>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <SourceLine node={node} S={S} date={date} />
      </>
    );
  } else {
    const programs = edges.filter((e) => e.type === "offers" && e.s.id === node.id).map((e) => e.t);
    const mapUrl = node.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(node.address)}` : "";
    const tel = (node.phone ?? "").replace(/[^\d+]/g, "");
    body = (
      <>
        <p className="text-sm text-muted-foreground">
          {node.org_type ? label("org", node.org_type) : S.typePlace}
          {node.org ? ` · ${node.org}` : ""}
          {node.org_locations ? ` · ${node.org_locations} ${lang === "es" ? "sedes" : "locations"}` : ""}
        </p>
        {node.accredited_reps ? (
          <p className="text-xs text-muted-foreground">
            {lang === "es"
              ? `La lista del DOJ registra ${node.accredited_reps} representantes acreditados en esta organización.`
              : `The DOJ roster lists ${node.accredited_reps} accredited representatives at this organization.`}
          </p>
        ) : null}
        {needChips}
        {programs.length > 0 && (
          <>
            <h4 className="mb-1.5 mt-3 text-sm font-semibold">{S.programsHere}</h4>
            <NodeLinks dark={dark} S={S} onOpen={onOpen} list={programs} />
          </>
        )}
        <dl className="mt-3 mb-0 grid gap-2 text-sm">
          {node.address && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{S.address}</dt>
              <dd className="m-0">
                {node.address}{" "}
                <a href={mapUrl} target="_blank" rel="noopener noreferrer">{S.map}</a>
              </dd>
            </div>
          )}
          {tel && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{S.call}</dt>
              <dd className="m-0"><a href={`tel:${tel}`}>{node.phone}</a></dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{S.hours}</dt>
            <dd className="m-0">{node.hours || S.hoursUnknown}</dd>
          </div>
          {node.languages && node.languages.length > 0 && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{S.languages}</dt>
              <dd className="m-0">{node.languages.map((l) => label("lang", l)).join(", ")}</dd>
            </div>
          )}
        </dl>
        <SourceLine node={node} S={S} date={date} />
        <a className="btn btn-primary mt-3 no-underline" href={`lugares/${encodeURIComponent(node.id)}.html`}>
          {S.fullPage}
        </a>
      </>
    );
  }

  const where = [node.hood, node.borough, node.zip].filter(Boolean).join(" · ");

  return (
    <article className="card m-0" aria-labelledby="graph-article-h">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: needColor(node.needs[0], dark) }} />
            {typeName}
            {where ? ` · ${where}` : ""}
          </p>
          <h3 id="graph-article-h" className="mt-1 mb-2 text-lg">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {node.trust && <TrustBadge trust={node.trust} />}
          <button
            type="button"
            onClick={onClose}
            aria-label={S.close}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-lg text-muted-foreground hover:bg-muted"
          >
            ×
          </button>
        </div>
      </div>
      {body}
    </article>
  );
}

function SourceLine({ node, S, date }: { node: GNode; S: Strings; date: (d: string) => string }) {
  if (!node.source_url && !node.last_checked) return null;
  return (
    <p className="mt-3 mb-0 text-xs text-muted-foreground">
      {S.source}:{" "}
      {isWebUrl(node.source_url) ? (
        <a href={node.source_url} target="_blank" rel="noopener noreferrer" className="break-all">
          {(() => {
            try {
              return new URL(node.source_url!).hostname.replace(/^www\./, "");
            } catch {
              return node.source_url;
            }
          })()}
        </a>
      ) : (
        node.source_url || "—"
      )}
      {node.last_checked ? ` · ${fill(S.checked, { d: date(node.last_checked) })}` : ""}
    </p>
  );
}

// ---------- canvas ----------

interface View {
  k: number;
  x: number;
  y: number;
}

function GraphCanvas({ graph, dark, selectedId, matchSet, focusReq, onSelect, S, needLabel, onReadArticle, selectedLabel }: {
  graph: Prepared;
  dark: boolean;
  selectedId: string | null;
  matchSet: Set<string> | null;
  focusReq: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  S: Strings;
  needLabel: (n: string) => string;
  onReadArticle: () => void;
  selectedLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const fitK = useRef(1);
  const size = useRef({ w: 0, h: 0 });
  const hover = useRef<string | null>(null);
  const raf = useRef(0);
  const anim = useRef(0);
  // Latest props for the imperative draw/handlers.
  const props = useRef({ graph, dark, selectedId, matchSet, onSelect, needLabel });
  props.current = { graph, dark, selectedId, matchSet, onSelect, needLabel };

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { graph: g, dark: dk, selectedId: sel, matchSet: ms, needLabel: nl } = props.current;
    const { w, h } = size.current;
    const dpr = window.devicePixelRatio || 1;
    const { k, x, y } = view.current;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue("--foreground").trim() || (dk ? "#fafafa" : "#09090b");
    const bg = css.getPropertyValue("--card").trim() || (dk ? "#0c0c0e" : "#ffffff");
    const mutedFg = css.getPropertyValue("--muted-foreground").trim() || "#71717a";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const focus = hover.current ?? sel;
    const near = focus ? g.adj.get(focus) ?? new Set<string>() : null;
    const lit = (id: string) => (near ? id === focus || near.has(id) : ms ? ms.has(id) : true);

    // World transform.
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);

    // Edges: faint batch first, highlighted on top.
    const faintNeed = new Path2D();
    const faintProg = new Path2D();
    const hot: Edge[] = [];
    for (const e of g.edges) {
      const touches = focus && (e.s.id === focus || e.t.id === focus);
      if (touches) {
        hot.push(e);
        continue;
      }
      if (ms && !(ms.has(e.s.id) && ms.has(e.t.id))) continue;
      const p = e.type === "need" ? faintNeed : faintProg;
      p.moveTo(e.s.x, e.s.y);
      p.lineTo(e.t.x, e.t.y);
    }
    ctx.lineWidth = 0.8 / k;
    ctx.strokeStyle = mutedFg;
    ctx.globalAlpha = focus ? 0.05 : ms ? 0.22 : 0.12;
    ctx.stroke(faintNeed);
    ctx.lineWidth = 1.4 / k;
    ctx.globalAlpha = focus ? 0.12 : 0.45;
    ctx.stroke(faintProg);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.6 / k;
    for (const e of hot) {
      const other = e.s.id === focus ? e.t : e.s;
      ctx.strokeStyle = e.type === "need" ? needColor(other.type === "need" ? other.needs[0] : e.s.needs[0], dk) : fg;
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.lineTo(e.t.x, e.t.y);
      ctx.stroke();
    }

    // Nodes.
    for (const n of g.nodes) {
      const on = lit(n.id);
      ctx.globalAlpha = on ? 1 : n.type === "need" ? 0.35 : 0.14;
      const r = n.type === "place" ? Math.max(n.r, 2.2 / k) : n.r;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = needColor(n.needs[0], dk);
      ctx.fill();
      if (n.type === "program") {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = bg;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 1.6, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = needColor(n.needs[0], dk);
        ctx.stroke();
      } else if (n.type === "need") {
        ctx.lineWidth = 3;
        ctx.strokeStyle = bg;
        ctx.stroke();
      }
      if (n.id === sel || n.id === hover.current) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3 / k + (n.type === "need" ? 3 : 1.5), 0, Math.PI * 2);
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = fg;
        ctx.stroke();
      }
    }

    // Labels in screen space so text stays crisp and readable at any zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    const font = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    // Greedy label placement: the focused node first, then programs, then places; skip overlaps.
    const placed: Array<[number, number, number, number]> = [];
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      placed.every(([a, b, c, d]) => x1 < a || x0 > c || y1 < b || y0 > d);
    const text = (s: string, sx: number, sy: number, size: number, weight: number, color: string, force = false) => {
      if (sx < -200 || sx > w + 200 || sy < -40 || sy > h + 40) return;
      ctx.font = `${weight} ${size}px ${font}`;
      const shown = s.length > 42 ? `${s.slice(0, 40)}…` : s;
      const tw = ctx.measureText(shown).width;
      const box: [number, number, number, number] = [sx - tw / 2 - 2, sy - 1, sx + tw / 2 + 2, sy + size + 1];
      if (!force && !free(...box)) return;
      placed.push(box);
      ctx.lineWidth = 4;
      ctx.strokeStyle = bg;
      ctx.strokeText(shown, sx, sy);
      ctx.fillStyle = color;
      ctx.fillText(shown, sx, sy);
    };
    const sx = (n: GNode) => n.x * k + x;
    const sy = (n: GNode) => n.y * k + y;
    // Reserve the hub pills first so node labels never cover them.
    ctx.font = `650 14px ${font}`;
    const pills = g.nodes.filter((n) => n.type === "need").map((n) => {
      const s = nl(n.needs[0]);
      const pw = ctx.measureText(s).width + 22;
      const top = sy(n) + n.r * k + 6;
      placed.push([sx(n) - pw / 2, top, sx(n) + pw / 2, top + 24]);
      return { n, s, pw, top };
    });
    const progLabels = k >= 0.85;
    const placeLabels = k >= 2.2;
    const wanted = g.nodes.filter((n) => n.type !== "need" && (
      n.id === focus || (near?.has(n.id) && (n.type === "program" || near.size < 60)) ||
      (!near && lit(n.id) && ((n.type === "program" && progLabels) || (n.type === "place" && placeLabels)))));
    const rank = (n: GNode) => (n.id === focus ? 0 : n.id === sel ? 1 : n.type === "program" ? 2 : 3);
    wanted.sort((a, b) => rank(a) - rank(b));
    for (const n of wanted) {
      const strong = n.id === focus;
      text(n.label, sx(n), sy(n) + n.r * k + 3, strong ? 13 : n.type === "program" ? 12 : 11,
        strong ? 650 : n.type === "program" ? 550 : 450, strong || n.type === "program" ? fg : mutedFg, strong);
    }
    // Hub labels sit on a pill so they stay readable over a dense cluster.
    for (const { n, s, pw, top } of pills) {
      const cx = sx(n);
      const ph = 24;
      ctx.globalAlpha = lit(n.id) ? 1 : 0.45;
      ctx.font = `650 14px ${font}`;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(cx - pw / 2, top, pw, ph, 12);
      else ctx.rect(cx - pw / 2, top, pw, ph);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = needColor(n.needs[0], dk);
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textBaseline = "middle";
      ctx.fillText(s, cx, top + ph / 2 + 0.5);
      ctx.textBaseline = "top";
    }
    ctx.globalAlpha = 1;
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const { w, h } = size.current;
    const b = props.current.graph.bounds;
    // Room for the hub pills (screen-sized, up to ~130px wide, 30px below the hub).
    const padX = 66;
    const padY = 24;
    const k = Math.min((w - padX * 2) / (b.x1 - b.x0), (h - padY * 2 - 30) / (b.y1 - b.y0));
    fitK.current = k;
    view.current = { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: (h - 30) / 2 - ((b.y0 + b.y1) / 2) * k };
  }, []);

  const clampK = (k: number) => Math.max(fitK.current * 0.5, Math.min(10, k));

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const v = view.current;
    const k = clampK(v.k * factor);
    const wx = (px - v.x) / v.k;
    const wy = (py - v.y) / v.k;
    view.current = { k, x: px - wx * k, y: py - wy * k };
    schedule();
  }, [schedule]);

  const animateTo = useCallback((target: View) => {
    cancelAnimationFrame(anim.current);
    if (prefersReducedMotion()) {
      view.current = target;
      schedule();
      return;
    }
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 450);
      const e = 1 - Math.pow(1 - t, 3);
      view.current = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      draw();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [draw, schedule]);

  // Size the canvas to its box (and device pixels); fit once.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let fitted = false;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      const old = size.current;
      size.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (!fitted) {
        fit();
        fitted = true;
      } else {
        // Keep the same world point in the middle.
        view.current.x += (w - old.w) / 2;
        view.current.y += (h - old.h) / 2;
      }
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, [draw, fit]);

  // Redraw when inputs change.
  useEffect(schedule, [graph, dark, selectedId, matchSet, needLabel, schedule]);

  // Center on a node picked from the list or an article.
  useEffect(() => {
    if (!focusReq) return;
    const n = graph.byId.get(focusReq.id);
    if (!n) return;
    // Frame the node with its neighbors (a place with its programs and need hubs).
    const { w, h } = size.current;
    let x0 = n.x, y0 = n.y, x1 = n.x, y1 = n.y;
    for (const id of graph.adj.get(n.id) ?? []) {
      const m = graph.byId.get(id);
      if (!m) continue;
      x0 = Math.min(x0, m.x - m.r);
      y0 = Math.min(y0, m.y - m.r);
      x1 = Math.max(x1, m.x + m.r);
      y1 = Math.max(y1, m.y + m.r + 30);
    }
    const pad = 48;
    const kFit = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
    const k = clampK(Math.min(n.type === "place" ? 2.6 : 2, Math.max(fitK.current, kFit)));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    animateTo({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // Pointer, wheel and pinch.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; vx: number; vy: number } | null = null;
    let pinch: { d: number; mx: number; my: number; v: View } | null = null;
    let moved = false;

    const pos = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (px: number, py: number, touch: boolean): string | null => {
      const v = view.current;
      const wx = (px - v.x) / v.k;
      const wy = (py - v.y) / v.k;
      const slop = (touch ? 14 : 6) / v.k;
      let best: GNode | null = null;
      let bestD = Infinity;
      for (const n of props.current.graph.nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy) - Math.max(n.r, 2.2 / v.k);
        if (d < slop && d < bestD + (n.type === "need" ? 4 / v.k : 0)) {
          best = n;
          bestD = d;
        }
      }
      return best?.id ?? null;
    };
    const startDrag = () => {
      const [p] = [...pointers.values()];
      drag = p ? { x: p.x, y: p.y, vx: view.current.x, vy: view.current.y } : null;
    };
    const startPinch = () => {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: { ...view.current } };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      cancelAnimationFrame(anim.current);
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 1) {
        moved = false;
        startDrag();
      } else if (pointers.size === 2) {
        moved = true;
        drag = null;
        startPinch();
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pos(e);
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") {
          const id = hit(p.x, p.y, false);
          canvas.style.cursor = id ? "pointer" : "grab";
          if (id !== hover.current) {
            hover.current = id;
            schedule();
          }
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const k = clampK(pinch.v.k * (d / pinch.d));
        const wx = (pinch.mx - pinch.v.x) / pinch.v.k;
        const wy = (pinch.my - pinch.v.y) / pinch.v.k;
        view.current = { k, x: mx - wx * k, y: my - wy * k };
        schedule();
      } else if (drag) {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        if (!moved && Math.hypot(dx, dy) > 5) {
          moved = true;
          canvas.style.cursor = "grabbing";
        }
        if (moved) {
          view.current = { ...view.current, x: drag.vx + dx, y: drag.vy + dy };
          schedule();
        }
      }
    };
    const onUp = (e: PointerEvent, cancelled = false) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pos(e);
      pointers.delete(e.pointerId);
      if (pointers.size === 1) {
        pinch = null;
        startDrag();
        return;
      }
      if (pointers.size === 0) {
        if (!moved && !cancelled) {
          const id = hit(p.x, p.y, e.pointerType !== "mouse");
          props.current.onSelect(id);
        }
        drag = null;
        pinch = null;
        canvas.style.cursor = "grab";
      }
    };
    const onUpEv = (e: PointerEvent) => onUp(e);
    const onCancel = (e: PointerEvent) => onUp(e, true);
    const onLeave = () => {
      if (hover.current) {
        hover.current = null;
        schedule();
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const p = pos(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUpEv);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUpEv);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf.current);
      cancelAnimationFrame(anim.current);
    };
  }, [schedule, zoomAt]);

  const counts = graph.file.counts;
  const ctrl = "inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-lg font-medium text-foreground shadow-sm hover:bg-muted";

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-[120px]">
      <div ref={wrapRef} className="h-[min(68vh,520px)] w-full lg:h-[min(760px,calc(100vh-150px))]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={fill(S.canvasLabel, { p: counts.places, g: counts.programs })}
          className="block touch-none select-none"
          style={{ cursor: "grab" }}
        />
      </div>
      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        <button type="button" className={ctrl} aria-label={S.zoomIn} title={S.zoomIn}
          onClick={() => zoomAt(1.5, size.current.w / 2, size.current.h / 2)}>+</button>
        <button type="button" className={ctrl} aria-label={S.zoomOut} title={S.zoomOut}
          onClick={() => zoomAt(1 / 1.5, size.current.w / 2, size.current.h / 2)}>−</button>
        <button type="button" className={`${ctrl} text-xs`} aria-label={S.reset} title={S.reset}
          onClick={() => {
            const prev = { ...view.current };
            fit();
            const target = { ...view.current };
            view.current = prev;
            animateTo(target);
          }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 m-0 hidden text-xs text-muted-foreground sm:block">{S.hint}</p>
      {selectedLabel && (
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm lg:hidden">
          <span className="min-w-0 truncate text-sm font-medium">{selectedLabel}</span>
          <button type="button" className="btn btn-secondary min-h-9 shrink-0 px-3" onClick={onReadArticle}>{S.readArticle}</button>
        </div>
      )}
    </div>
  );
}
