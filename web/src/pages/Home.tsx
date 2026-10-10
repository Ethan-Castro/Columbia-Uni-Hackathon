// Home: what NYC Navigator is, the four ways in, how it works, trust rules.
// Spanish and English copy live here (landing-only strings); the rest of the
// app uses i18n.tsx.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight, Bot, Check, Copy, Database, MessageCircle, MessagesSquare, Phone, Search, Send, ShieldCheck, Sparkles, Users,
} from "lucide-react";
import { Hero10 } from "@/components/ui/hero-10";
import { Button } from "@/components/ui/button";
import { getHealth } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { HREF } from "../router.ts";

const MCP_URL = "https://inmigracion-nyc.com/functions/mcp";
const WA_NUMBER = "+1 415 523 8886";
const WA_LINK = "https://wa.me/14155238886?text=join%20package-question";
const VOICE_NUMBER = "+1 743 330 7616";

/** Where each door's "how" line takes you: the exact settings page, WhatsApp, or a call. */
const DOOR_LINKS = [
  "https://claude.ai/settings/connectors",
  "https://chatgpt.com/#settings/Connectors",
  WA_LINK,
  `tel:${VOICE_NUMBER.replace(/[^\d+]/g, "")}`,
];

/** Real screenshots of the result cards in Claude and ChatGPT. */
const DOOR_SHOTS = ["doors/claude.jpg", "doors/chatgpt.jpg", "", ""];

/** Setup and result screenshots for the "See it working" section. */
const SETUP_SHOTS = [
  { src: "doors/chatgpt-full.jpg", es: "ChatGPT: despensas en Bay Ridge, con botón para llamar, mapa y fuente.", en: "ChatGPT: pantries in Bay Ridge, with a call button, map and source." },
  { src: "doors/claude-settings.jpg", es: "Claude: el conector Immigracion NYC y sus herramientas.", en: "Claude: the Immigracion NYC connector and its tools." },
  { src: "doors/chatgpt-app.jpg", es: "ChatGPT: la app Inmigracion NYC, conectada.", en: "ChatGPT: the Inmigracion NYC app, connected." },
];

/** Demo videos (YouTube Shorts). */
const VIDEOS = [
  { id: "Ed0U__y4ENA", es: "La app de voz (/voz): diga lo que necesita y le ofrece la llamada al lugar más cercano.", en: "The voice app (/voz): say what you need and it offers the call to the closest place." },
  { id: "5zCPhtkWlCM", es: "La línea de teléfono con ElevenLabs: llame y pregunte en español.", en: "The ElevenLabs phone line: call and ask in Spanish." },
];

const COPY = {
  es: {
    title: "Los servicios de Nueva York,",
    line2: "en",
    highlight: "su idioma y su teléfono",
    description:
      "Un mapa vivo de comida, ayuda legal, salud, IDNYC y más para familias inmigrantes. Pregunte en Claude, ChatGPT, WhatsApp o por teléfono: todas las puertas usan el mismo mapa, con la fuente y la fecha de cada dato.",
    proof: (p: number, g: number) => `${p} lugares · ${g} programas · revisados el 10 oct 2026`,
    cta1: "Buscar un servicio",
    cta2: "Cómo funciona",
    alts: ["Respuesta por WhatsApp con despensas en Corona", "Despensas en Sunset Park en Claude", "Comida en Bay Ridge en ChatGPT"],
    doorsKicker: "Una pregunta, cuatro puertas",
    doorsTitle: "Pregunte donde ya está",
    doorsIntro: "No hay que bajar otra app. Las cuatro puertas leen el mismo mapa al mismo tiempo.",
    doors: [
      { name: "Claude", body: "Agréguelo como conector y pregunte en español. Muestra tarjetas con lugares, horarios y un plan por pasos, en la web y en el teléfono.", how: "Ajustes → Conectores → Agregar conector personalizado → pegue la dirección." },
      { name: "ChatGPT", body: "El mismo servidor como plugin de ChatGPT, con las mismas tarjetas. En la web y en la app de escritorio.", how: "chatgpt.com/plugins → Agregar servidor MCP → pegue la dirección." },
      { name: "WhatsApp", body: "Escriba lo que necesita y su barrio: le contestamos con lugares, horarios y teléfonos. También le enviamos su plan, solo si usted dice que sí.", how: `Envíe "join package-question" a ${WA_NUMBER} (prueba).` },
      { name: "Teléfono", body: "Una línea de voz en español para quien prefiere hablar. Usa el mismo mapa y contesta en frases cortas.", how: `${VOICE_NUMBER} · en prueba` },
    ],
    copy: "Copiar dirección",
    copied: "Copiada",
    openWa: "Abrir WhatsApp",
    openVoice: "Abrir la app de voz",
    howKicker: "Cómo funciona",
    howTitle: "Del mensaje al plan en segundos",
    steps: [
      { t: "Usted pregunta", b: "\"Acabo de llegar a Corona con mis hijos, necesito comida, médico y una identificación.\" En su idioma, por la puerta que prefiera." },
      { t: "El mapa responde", b: "Nuestro servidor (en Base44) busca el mejor lugar cerca para cada necesidad y ordena los pasos: el IDNYC va primero porque sirve de identificación para SNAP." },
      { t: "El plan llega a su teléfono", b: "Si usted dice que sí, Twilio le manda el plan por WhatsApp: lugares, horarios y qué llevar. Nunca guardamos su número." },
      { t: "El mapa crece", b: "Tavily busca nuevos recursos en toda la ciudad y las organizaciones los sugieren aquí. Una persona revisa cada uno antes de publicarlo." },
    ],
    checkKicker: "Antes de pagarle a alguien",
    checkTitle: "¿Le prometen arreglar los papeles?",
    checkBody:
      "Pregunte por el nombre. Lo buscamos en las listas del DOJ (organizaciones reconocidas, representantes acreditados y la lista pro bono) y le mostramos opciones de esas listas cerca de usted, con la fecha en que las revisamos. Que un nombre no aparezca no prueba un fraude, pero un notario o una agencia de viajes no puede dar ayuda legal de inmigración.",
    checkExample: "¿Es legítimo el notario de la agencia de viajes en Roosevelt Ave?",
    rulesKicker: "Nuestras reglas",
    rulesTitle: "Hecho para dar confianza",
    rules: [
      { t: "Información, no consejo legal", b: "Damos información y referidos. Para ayuda legal, un abogado con licencia o un representante acreditado por el DOJ." },
      { t: "Nunca preguntamos su estatus", b: "Y borramos cualquier dato de estatus antes de enviar un plan." },
      { t: "Cada dato con su fuente", b: "Cada lugar muestra de dónde viene y cuándo lo revisamos." },
      { t: "Una persona revisa todo", b: "Nada nuevo se publica sin que alguien lo apruebe." },
      { t: "Sin nombres ni teléfonos", b: "Solo contamos qué se busca y en qué código postal, para que la ciudad vea lo que falta." },
    ],
    commTitle: "Comunidad de Corona",
    commBody: "Pregunte a sus vecinos sobre vivienda, comida, escuela o trabajo, y avise si algo del mapa está mal.",
    commCta: "Entrar a la comunidad",
    orgTitle: "¿Su organización ayuda a inmigrantes?",
    orgBody: "Sugiera su despensa, clínica o programa. Lo revisamos y aparece en Claude, ChatGPT, WhatsApp y la línea de voz.",
    orgCta: "Sugerir un recurso",
    cityCta: "Ver los datos para la ciudad",
    builtWith: "Hecho en el hackatón Latinos x AI NYC con Base44, Twilio, Tavily, OpenRouter, ElevenLabs, Claude y ChatGPT. Datos: NYC Open Data, Food Help NYC y las listas de la EOIR del DOJ.",
    privacy: "Privacidad",
    terms: "Términos",
  },
  en: {
    title: "New York's services,",
    line2: "in",
    highlight: "your language, on your phone",
    description:
      "A living map of food, legal help, health care, IDNYC and more for immigrant families. Ask in Claude, ChatGPT, WhatsApp or by phone: every door reads the same map, with the source and check date on every fact.",
    proof: (p: number, g: number) => `${p} places · ${g} programs · checked Oct 10, 2026`,
    cta1: "Find a service",
    cta2: "How it works",
    alts: ["WhatsApp reply with pantries in Corona", "Pantries in Sunset Park in Claude", "Food in Bay Ridge in ChatGPT"],
    doorsKicker: "One question, four doors",
    doorsTitle: "Ask where you already are",
    doorsIntro: "No new app to download. All four doors read the same map at the same time.",
    doors: [
      { name: "Claude", body: "Add it as a connector and ask in Spanish or English. It shows cards with places, hours and a step-by-step plan, on the web and on your phone.", how: "Settings → Connectors → Add custom connector → paste the URL." },
      { name: "ChatGPT", body: "The same server as a ChatGPT plugin, with the same cards. On the web and the desktop app.", how: "chatgpt.com/plugins → Add custom MCP server → paste the URL." },
      { name: "WhatsApp", body: "Text what you need and your neighborhood: we answer with places, hours and phone numbers. We also send your plan, only if you say yes.", how: `Send "join package-question" to ${WA_NUMBER} (test sandbox).` },
      { name: "Phone", body: "A Spanish voice line for people who'd rather talk. Same map, short spoken answers.", how: `${VOICE_NUMBER} · in testing` },
    ],
    copy: "Copy URL",
    copied: "Copied",
    openWa: "Open WhatsApp",
    openVoice: "Open the voice app",
    howKicker: "How it works",
    howTitle: "From a message to a plan in seconds",
    steps: [
      { t: "You ask", b: "\"I just arrived in Corona with my kids, I need food, a doctor and an ID.\" In your language, through whichever door you like." },
      { t: "The map answers", b: "Our server (on Base44) finds the best nearby place for each need and orders the steps: IDNYC comes first because it works as ID when applying for SNAP." },
      { t: "The plan lands on your phone", b: "If you say yes, Twilio sends the plan to WhatsApp: places, hours and what to bring. We never store your number." },
      { t: "The map keeps growing", b: "Tavily searches the whole city for new resources, and organizations suggest them here. A person reviews each one before it goes live." },
    ],
    checkKicker: "Before you pay anyone",
    checkTitle: "Someone promised to fix your papers?",
    checkBody:
      "Ask by name. We look it up on the DOJ lists (recognized organizations, accredited representatives and the pro bono list) and show options from those lists near you, with the date we checked. A name that isn't listed doesn't prove fraud, but a notario or travel agency can't give immigration legal help.",
    checkExample: "Is the notario at the travel agency on Roosevelt Ave legit?",
    rulesKicker: "Our rules",
    rulesTitle: "Built to be trusted",
    rules: [
      { t: "Information, not legal advice", b: "We give information and referrals. For legal help, a licensed attorney or a DOJ-accredited representative." },
      { t: "We never ask about status", b: "And we strip any status details before a plan is sent." },
      { t: "Every fact has a source", b: "Each place shows where it came from and when we checked it." },
      { t: "A person reviews everything", b: "Nothing new goes live until someone approves it." },
      { t: "No names, no phone numbers", b: "We only count what's searched and in which zip code, so the city can see the gaps." },
    ],
    commTitle: "Corona community",
    commBody: "Ask your neighbors about housing, food, school or work, and tell us when something on the map is wrong.",
    commCta: "Join the community",
    orgTitle: "Does your organization help immigrants?",
    orgBody: "Suggest your pantry, clinic or program. We review it, and it shows up in Claude, ChatGPT, WhatsApp and the voice line.",
    orgCta: "Suggest a resource",
    cityCta: "See the data for the city",
    builtWith: "Built at the Latinos x AI NYC hackathon with Base44, Twilio, Tavily, OpenRouter, ElevenLabs, Claude and ChatGPT. Data: NYC Open Data, Food Help NYC and the DOJ EOIR lists.",
    privacy: "Privacy",
    terms: "Terms",
  },
};

const DOOR_ICONS = [Bot, MessagesSquare, MessageCircle, Phone];
const STEP_ICONS = [MessageCircle, Database, Send, Sparkles];

function Section({ id, kicker, title, intro, children }: { id?: string; kicker: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-28 px-6 py-16 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="text-brand mb-2 text-xs font-semibold uppercase tracking-widest">{kicker}</p>
        <h2 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{title}</h2>
        {intro && <p className="text-muted-foreground mt-3">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function CopyUrl({ label, done }: { label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2">
      <code className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[11px]">{MCP_URL}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          try { await navigator.clipboard.writeText(MCP_URL); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
        }}
        aria-label={label}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        <span className="ml-1.5 hidden sm:inline">{copied ? done : label}</span>
      </Button>
    </div>
  );
}

export function Home() {
  const { lang } = useI18n();
  const c = COPY[lang];
  const [counts, setCounts] = useState({ Place: 951, Program: 105 });
  useEffect(() => {
    getHealth().then((h) => {
      if (h.counts?.Place && h.counts?.Program) setCounts({ Place: h.counts.Place, Program: h.counts.Program });
    }).catch(() => { /* keep defaults */ });
  }, []);

  return (
    <div className="home">
      <Hero10
        title={c.title}
        titleLine2Prefix={c.line2}
        titleHighlight={c.highlight}
        description={c.description}
        socialProof={c.proof(counts.Place, counts.Program)}
        images={["hero/whatsapp-live.jpg", "hero/claude-live.jpg", "hero/chatgpt-live.jpg"]}
        imageAlts={c.alts}
        animation="subtle"
        primaryCTA={{ ctaEnabled: true, text: c.cta1, link: HREF.directory, variant: "default", size: "lg" }}
        secondaryCTA={{ ctaEnabled: true, text: c.cta2, link: "#how", variant: "outline", size: "lg" }}
      />

      <div className="border-border border-t" />

      <section className="mx-auto w-full max-w-6xl px-6 pt-12 sm:pt-16" aria-labelledby="community-band">
        <a
          href={HREF.community}
          className="bg-card border-foreground text-foreground flex flex-col gap-6 rounded-3xl border p-8 no-underline sm:flex-row sm:items-center sm:justify-between sm:p-10"
        >
          <div className="flex min-w-0 items-start gap-4">
            <Users className="text-brand mt-1 size-8 shrink-0" />
            <div className="min-w-0">
              <h2 id="community-band" className="font-sans text-3xl font-bold tracking-tight sm:text-4xl">{c.commTitle}</h2>
              <p className="text-muted-foreground mt-2 max-w-2xl text-base sm:text-lg">{c.commBody}</p>
            </div>
          </div>
          <span className="bg-primary text-primary-foreground border-foreground inline-flex min-h-14 shrink-0 items-center justify-center rounded-full border px-8 text-lg font-semibold">
            {c.commCta}<ArrowRight className="ml-2 size-5" />
          </span>
        </a>
      </section>

      <Section kicker={c.doorsKicker} title={c.doorsTitle} intro={c.doorsIntro}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.doors.map((d, i) => {
            const Icon = DOOR_ICONS[i];
            return (
              <div key={d.name} className="bg-card border-border flex min-w-0 flex-col rounded-xl border p-5">
                {DOOR_SHOTS[i] ? (
                  <a href={DOOR_SHOTS[i]} target="_blank" rel="noreferrer" className="border-border mb-4 block aspect-[4/3] overflow-hidden rounded-lg border no-underline">
                    <img src={DOOR_SHOTS[i]} alt={lang === "es" ? `Respuesta real en ${d.name}` : `A real answer in ${d.name}`} loading="lazy" className="size-full object-cover object-top" />
                  </a>
                ) : (
                  <div className="bg-muted mb-4 grid size-10 place-items-center rounded-lg"><Icon className="size-5" /></div>
                )}
                <h3 className="text-base font-semibold">{d.name}</h3>
                <p className="text-muted-foreground mt-1 flex-1 text-sm">{d.body}</p>
                <p className="text-foreground mt-3 text-xs font-medium">
                  <a href={DOOR_LINKS[i]} target={DOOR_LINKS[i].startsWith("tel:") ? undefined : "_blank"} rel="noreferrer">{d.how}</a>
                </p>
                {i < 2 && <CopyUrl label={c.copy} done={c.copied} />}
                {i === 3 && (
                  <Button asChild variant="outline" size="sm" className="mt-3 no-underline">
                    <a href="voz/index.html">{c.openVoice}<ArrowRight className="ml-1.5 size-4" /></a>
                  </Button>
                )}
                {i === 2 && (
                  <Button asChild variant="outline" size="sm" className="mt-3 no-underline">
                    <a href={WA_LINK} target="_blank" rel="noreferrer">{c.openWa}<ArrowRight className="ml-1.5 size-4" /></a>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        kicker={lang === "es" ? "Así se ve" : "See it working"}
        title={lang === "es" ? "Ya conectado en Claude y ChatGPT" : "Already connected in Claude and ChatGPT"}
        intro={lang === "es" ? "Capturas reales: se agrega una vez y responde con tarjetas que se pueden llamar." : "Real screenshots: add it once and it answers with cards you can call from."}
      >
        <div className="grid gap-4 md:grid-cols-5">
          {SETUP_SHOTS.map((shot, i) => (
            <figure key={shot.src} className={`m-0 min-w-0 ${i === 0 ? "md:col-span-3 md:row-span-2" : "md:col-span-2"}`}>
              <a href={shot.src} target="_blank" rel="noreferrer" className="bg-card border-border block overflow-hidden rounded-xl border no-underline">
                <img src={shot.src} alt={shot[lang]} loading="lazy" className={`w-full object-cover object-top ${i === 0 ? "aspect-[4/5]" : "aspect-[4/3]"}`} />
              </a>
              <figcaption className="text-muted-foreground mt-2 text-sm">{shot[lang]}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section
        kicker={lang === "es" ? "En video" : "On video"}
        title={lang === "es" ? "Hable y llame" : "Talk, then call"}
        intro={lang === "es" ? "Dos maneras de pedir ayuda solo con la voz." : "Two ways to ask for help with just your voice."}
      >
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          {VIDEOS.map((v) => (
            <figure key={v.id} className="m-0 min-w-0">
              <div className="border-border mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-xl border bg-black">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0&playsinline=1`}
                  title={v[lang]}
                  className="size-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <figcaption className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">{v[lang]}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <div className="bg-muted/50 border-border border-y">
        <Section id="how" kicker={c.howKicker} title={c.howTitle}>
          <ol className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {c.steps.map((s, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <li key={s.t} className="bg-card border-border relative rounded-xl border p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="border-foreground grid size-9 place-items-center rounded-full border text-sm font-medium">{i + 1}</span>
                    <Icon className="text-muted-foreground size-5" />
                  </div>
                  <h3 className="text-base font-semibold">{s.t}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{s.b}</p>
                </li>
              );
            })}
          </ol>
        </Section>
      </div>

      <Section kicker={c.checkKicker} title={c.checkTitle}>
        <div className="bg-card border-border mx-auto grid max-w-4xl items-center gap-6 rounded-2xl border p-6 sm:grid-cols-[1fr_auto] sm:p-8">
          <p className="text-muted-foreground text-sm sm:text-base">{c.checkBody}</p>
          <div className="bg-muted flex max-w-xs items-start gap-2 rounded-xl p-4 text-sm">
            <Search className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="italic">“{c.checkExample}”</span>
          </div>
        </div>
      </Section>

      <div className="bg-muted/50 border-border border-y">
        <Section kicker={c.rulesKicker} title={c.rulesTitle}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {c.rules.map((r) => (
              <div key={r.t} className="min-w-0">
                <ShieldCheck className="text-brand mb-3 size-5" />
                <h3 className="text-sm font-semibold">{r.t}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{r.b}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <div className="bg-primary text-primary-foreground flex flex-col items-center gap-5 rounded-2xl px-6 py-12 text-center">
          <Users className="size-7 opacity-80" />
          <h2 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{c.orgTitle}</h2>
          <p className="max-w-xl text-sm opacity-80 sm:text-base">{c.orgBody}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 no-underline">
              <a href={HREF.submit}>{c.orgCta}<ArrowRight className="ml-1.5 size-4" /></a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground no-underline">
              <a href={HREF.insights}>{c.cityCta}</a>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mx-auto mt-10 max-w-3xl text-center text-xs">
          {c.builtWith} · <a href="https://www.instagram.com/inmigracionnyc/" target="_blank" rel="noreferrer">Instagram @inmigracionnyc</a> · <a href="lugares/index.html">{lang === "es" ? "Todos los lugares (A–Z)" : "All places (A–Z)"}</a> · <a href={`como-lo-hicimos.html?lang=${lang}`}>{lang === "es" ? "Cómo lo hicimos" : "How we built it"}</a> · <a href="privacy.html">{c.privacy}</a> · <a href="terms.html">{c.terms}</a>
        </p>
      </section>
    </div>
  );
}
