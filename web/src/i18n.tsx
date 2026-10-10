// Every string the web app shows, in Spanish (default) and English.
// The choice is remembered in localStorage.
//
//   const { t, lang, setLang } = useI18n();
//   t("dir_count", { n: 4 })

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "es" | "en";

const es = {
  app_name: "Mapa de Servicios NYC",
  app_tagline: "Servicios para inmigrantes en Nueva York, en español e inglés",
  nav_home: "Inicio",
  nav_directory: "Buscar",
  nav_submit: "Sugerir un recurso",
  nav_admin: "Revisión",
  nav_insights: "Datos",
  lang_toggle: "English",
  lang_toggle_label: "Cambiar idioma a inglés",

  footer_rules_title: "Nuestras reglas",
  footer_rule_info: "Damos información y referidos, nunca consejo legal. Para ayuda legal, hable con un abogado con licencia o un representante acreditado por el DOJ.",
  footer_rule_status: "Nunca preguntamos por su estatus migratorio.",
  footer_rule_review: "Una persona revisa cada recurso antes de publicarlo.",
  footer_rule_privacy: "No guardamos nombres ni teléfonos. Solo contamos qué se busca y en qué código postal.",
  sample_banner: "Datos de ejemplo para la demostración. Los lugares marcados (sample) no son reales.",

  // Directory
  dir_title: "¿Qué necesita hoy?",
  dir_intro: "Busque comida, ayuda legal, salud y más cerca de usted. Cada lugar muestra su fuente y cuándo lo revisamos.",
  dir_search: "Buscar por nombre, dirección o código postal",
  dir_search_placeholder: "Ej.: 10032, Brooklyn, Bronx, IDNYC",
  dir_need_all: "Todo",
  dir_borough: "Condado",
  dir_borough_all: "Toda la ciudad",
  dir_language: "Idioma que hablan",
  dir_language_all: "Cualquier idioma",
  dir_count: "{n} lugares",
  dir_count_one: "1 lugar",
  dir_none: "No encontramos lugares con estos filtros. Pruebe otro condado o idioma, o llame al 311 y pida ayuda en español.",
  dir_loading: "Buscando…",
  dir_error: "No pudimos cargar el directorio. Intente de nuevo.",
  retry: "Intentar de nuevo",

  // Card
  card_hours: "Horario",
  card_languages: "Idiomas",
  card_bring: "Qué llevar",
  card_bring_unknown: "Llame antes para preguntar qué documentos llevar.",
  card_programs: "Programas aquí",
  card_note: "Nota",
  card_who: "Quién puede usarlo",
  card_status_advice: "Este programa puede depender de su situación. Antes de aplicar, hable con un abogado con licencia o un representante acreditado por el DOJ.",
  card_phone: "Llamar",
  card_map: "Ver en el mapa",
  card_source: "Fuente",
  card_source_community: "Enviado por la comunidad",
  card_checked: "Revisado el {date}",
  open_now: "Abierto ahora",
  closed_now: "Cerrado ahora",
  open_today: "Abre más tarde hoy",
  open_evenings: "Abre en la noche",
  open_weekends: "Abre fines de semana",
  hours_unknown: "Horario por confirmar",

  // Trust
  trust_official: "Oficial",
  trust_verified: "Verificado",
  trust_community: "De la comunidad",
  trust_unverified: "Sin verificar",

  // Needs
  need_food: "Comida",
  need_legal: "Ayuda legal",
  need_health: "Salud",
  need_benefits: "Beneficios",
  need_money: "Dinero y banco",
  need_school: "Escuela",
  need_id: "Identificación",
  need_housing: "Vivienda",
  need_work: "Trabajo",
  need_transit: "Transporte",

  // Org types
  org_pantry: "Despensa de comida",
  org_clinic: "Clínica",
  org_benefits_office: "Oficina de beneficios",
  org_idnyc: "Centro de IDNYC",
  org_school: "Escuela o centro de familias",
  org_doj_pro_bono: "Ayuda legal (lista pro bono del DOJ)",
  org_doj_roster: "Proveedor legal acreditado (DOJ)",
  org_consulate: "Consulado",
  org_remittance: "Envíos de dinero",
  org_check_casher: "Cambio de cheques",
  org_other: "Otro",

  // Languages
  lang_es: "Español",
  lang_en: "Inglés",
  lang_quc: "K'iche'",
  lang_qu: "Quechua",
  lang_zh: "Chino",
  lang_bn: "Bengalí",
  lang_ne: "Nepalí",
  lang_ar: "Árabe",
  lang_fr: "Francés",
  lang_ht: "Criollo haitiano",

  // Submit
  sub_title: "Sugerir un recurso",
  sub_intro: "¿Conoce un lugar que ayuda a inmigrantes? Cuéntenos. Una persona lo revisa antes de publicarlo.",
  sub_privacy: "Describa la organización, no a usted. No pedimos su nombre ni su teléfono.",
  sub_name: "Nombre del lugar",
  sub_org: "Organización (si es otra)",
  sub_org_type: "Tipo de lugar",
  sub_address: "Dirección",
  sub_address_hint: "Calle, barrio y código postal. Ej.: 98-01 Roosevelt Ave, Corona, NY 11368",
  sub_borough: "Condado",
  sub_borough_pick: "Elegir…",
  sub_zip: "Código postal",
  sub_hours: "Horario",
  sub_hours_hint: "Ej.: Lun-Vie 9am-5pm; Sáb 10am-1pm",
  sub_languages: "Idiomas que hablan",
  sub_phone: "Teléfono del lugar",
  sub_needs: "¿Con qué ayudan?",
  sub_source: "Página web o enlace donde lo vio",
  sub_notes: "Algo más que debamos saber",
  sub_notes_hint: "Ej.: reparten comida los lunes, no piden documentos.",
  sub_required: "obligatorio",
  sub_send: "Enviar para revisión",
  sub_sending: "Enviando…",
  sub_thanks_title: "¡Gracias!",
  sub_thanks_human: "Una persona de nuestro equipo revisa cada recurso. No se publica nada sin revisión.",
  sub_another: "Sugerir otro recurso",
  sub_back: "Volver al directorio",
  sub_error: "No pudimos enviar el formulario.",
  sub_missing: "Escriba el nombre y la dirección del lugar.",

  // Admin
  adm_title: "Revisión de recursos",
  adm_intro: "Apruebe o rechace lo que envía la comunidad. Lo aprobado aparece como \"De la comunidad\".",
  adm_token: "Clave de administrador",
  adm_token_hint: "Se guarda solo en esta pestaña.",
  adm_token_save: "Entrar",
  adm_logout: "Salir",
  adm_bad_token: "Clave incorrecta. Intente de nuevo.",
  adm_not_configured: "El acceso de administrador no está configurado en el servidor.",
  adm_pending: "Pendientes",
  adm_approved: "Aprobados",
  adm_rejected: "Rechazados",
  adm_empty: "No hay envíos aquí.",
  adm_approve: "Aprobar y publicar",
  adm_reject: "Rechazar",
  adm_reject_confirm: "¿Rechazar este envío?",
  adm_approved_as: "Publicado como {id}.",
  adm_rejected_ok: "Envío rechazado.",
  adm_submitted: "Enviado el {date}",
  adm_needs: "Ayuda con",
  adm_notes: "Notas",
  adm_edit_hint: "Puede corregir los datos antes de aprobar.",
  adm_languages_hint: "Códigos separados por coma: es, en, quc",
  adm_view_place: "Ver en el directorio",
  refresh: "Actualizar",
  loading: "Cargando…",
  error: "Algo salió mal: {msg}",

  // Insights
  ins_title: "Datos de uso",
  ins_test: "Tráfico de prueba",
  ins_test_note: "Estas cifras vienen de pruebas y de la demostración, no de usuarios reales.",
  ins_privacy: "Cada búsqueda guarda solo: necesidad, código postal, idioma y canal. Nunca nombres, teléfonos ni texto.",
  ins_total: "Búsquedas",
  ins_unmet: "Sin resultados",
  ins_unmet_rate: "{p}% de las búsquedas",
  ins_period: "Periodo",
  ins_by_need: "Búsquedas por necesidad",
  ins_unmet_zip: "Búsquedas sin resultados por código postal",
  ins_unmet_zip_value: "{u} de {t}",
  ins_no_zip: "Sin código postal",
  ins_languages: "Idiomas",
  ins_channels: "Canales",
  ins_empty: "Todavía no hay búsquedas registradas.",
  ins_none_unmet: "Ninguna búsqueda quedó sin resultados.",
  ins_table: "Ver como tabla",
  ins_col_item: "Categoría",
  ins_col_value: "Cantidad",
  channel_mcp: "Asistentes de IA (MCP)",
  channel_whatsapp: "WhatsApp",
  channel_voice: "Voz",
  channel_web: "Web",
  lang_unknown: "Sin dato",
};

export type Key = keyof typeof es;

const en: Record<Key, string> = {
  app_name: "NYC Services Map",
  app_tagline: "Services for immigrant New Yorkers, in Spanish and English",
  nav_home: "Home",
  nav_directory: "Search",
  nav_submit: "Suggest a resource",
  nav_admin: "Review",
  nav_insights: "Insights",
  lang_toggle: "Español",
  lang_toggle_label: "Switch language to Spanish",

  footer_rules_title: "Our rules",
  footer_rule_info: "We give information and referrals, never legal advice. For legal help, talk with a licensed attorney or a DOJ-accredited representative.",
  footer_rule_status: "We never ask about immigration status.",
  footer_rule_review: "A person reviews every resource before it is published.",
  footer_rule_privacy: "We do not keep names or phone numbers. We only count what is searched and in which zip code.",
  sample_banner: "Sample data for the demo. Places marked (sample) are not real.",

  dir_title: "What do you need today?",
  dir_intro: "Find food, legal help, health care and more near you. Every place shows its source and when we checked it.",
  dir_search: "Search by name, address or zip code",
  dir_search_placeholder: "e.g. 10032, Brooklyn, Bronx, IDNYC",
  dir_need_all: "Everything",
  dir_borough: "Borough",
  dir_borough_all: "Whole city",
  dir_language: "Language spoken",
  dir_language_all: "Any language",
  dir_count: "{n} places",
  dir_count_one: "1 place",
  dir_none: "No places match these filters. Try another borough or language, or call 311 and ask for help in your language.",
  dir_loading: "Searching…",
  dir_error: "We could not load the directory. Please try again.",
  retry: "Try again",

  card_hours: "Hours",
  card_languages: "Languages",
  card_bring: "What to bring",
  card_bring_unknown: "Call ahead to ask which documents to bring.",
  card_programs: "Programs here",
  card_note: "Note",
  card_who: "Who can use it",
  card_status_advice: "This program may depend on your situation. Before you apply, talk with a licensed attorney or a DOJ-accredited representative.",
  card_phone: "Call",
  card_map: "View on map",
  card_source: "Source",
  card_source_community: "Sent by the community",
  card_checked: "Checked {date}",
  open_now: "Open now",
  closed_now: "Closed now",
  open_today: "Opens later today",
  open_evenings: "Open evenings",
  open_weekends: "Open weekends",
  hours_unknown: "Hours to be confirmed",

  trust_official: "Official",
  trust_verified: "Verified",
  trust_community: "Community",
  trust_unverified: "Unverified",

  need_food: "Food",
  need_legal: "Legal help",
  need_health: "Health",
  need_benefits: "Benefits",
  need_money: "Money & banking",
  need_school: "School",
  need_id: "ID",
  need_housing: "Housing",
  need_work: "Work",
  need_transit: "Transit",

  org_pantry: "Food pantry",
  org_clinic: "Clinic",
  org_benefits_office: "Benefits office",
  org_idnyc: "IDNYC center",
  org_school: "School or family center",
  org_doj_pro_bono: "Legal help (DOJ pro bono list)",
  org_doj_roster: "Accredited legal provider (DOJ)",
  org_consulate: "Consulate",
  org_remittance: "Money transfers",
  org_check_casher: "Check cashing",
  org_other: "Other",

  lang_es: "Spanish",
  lang_en: "English",
  lang_quc: "K'iche'",
  lang_qu: "Quechua",
  lang_zh: "Chinese",
  lang_bn: "Bengali",
  lang_ne: "Nepali",
  lang_ar: "Arabic",
  lang_fr: "French",
  lang_ht: "Haitian Creole",

  sub_title: "Suggest a resource",
  sub_intro: "Know a place that helps immigrants? Tell us. A person reviews it before it is published.",
  sub_privacy: "Describe the organization, not yourself. We do not ask for your name or phone number.",
  sub_name: "Name of the place",
  sub_org: "Organization (if different)",
  sub_org_type: "Type of place",
  sub_address: "Address",
  sub_address_hint: "Street, neighborhood and zip code. e.g. 98-01 Roosevelt Ave, Corona, NY 11368",
  sub_borough: "Borough",
  sub_borough_pick: "Choose…",
  sub_zip: "Zip code",
  sub_hours: "Hours",
  sub_hours_hint: "e.g. Mon-Fri 9am-5pm; Sat 10am-1pm",
  sub_languages: "Languages spoken",
  sub_phone: "Phone of the place",
  sub_needs: "What do they help with?",
  sub_source: "Website or link where you saw it",
  sub_notes: "Anything else we should know",
  sub_notes_hint: "e.g. they give out food on Mondays, no documents needed.",
  sub_required: "required",
  sub_send: "Send for review",
  sub_sending: "Sending…",
  sub_thanks_title: "Thank you!",
  sub_thanks_human: "A person on our team reviews every resource. Nothing is published without review.",
  sub_another: "Suggest another resource",
  sub_back: "Back to the directory",
  sub_error: "We could not send the form.",
  sub_missing: "Please write the name and address of the place.",

  adm_title: "Resource review",
  adm_intro: "Approve or reject what the community sends. Approved places show as \"Community\".",
  adm_token: "Admin token",
  adm_token_hint: "Kept only in this tab.",
  adm_token_save: "Sign in",
  adm_logout: "Sign out",
  adm_bad_token: "Wrong token. Please try again.",
  adm_not_configured: "Admin access is not configured on the server.",
  adm_pending: "Pending",
  adm_approved: "Approved",
  adm_rejected: "Rejected",
  adm_empty: "Nothing here.",
  adm_approve: "Approve and publish",
  adm_reject: "Reject",
  adm_reject_confirm: "Reject this submission?",
  adm_approved_as: "Published as {id}.",
  adm_rejected_ok: "Submission rejected.",
  adm_submitted: "Sent {date}",
  adm_needs: "Helps with",
  adm_notes: "Notes",
  adm_edit_hint: "You can fix the details before approving.",
  adm_languages_hint: "Comma-separated codes: es, en, quc",
  adm_view_place: "View in directory",
  refresh: "Refresh",
  loading: "Loading…",
  error: "Something went wrong: {msg}",

  ins_title: "Usage insights",
  ins_test: "Test traffic",
  ins_test_note: "These numbers come from testing and the demo, not from real users.",
  ins_privacy: "Each search keeps only: need, zip code, language and channel. Never names, phone numbers or text.",
  ins_total: "Searches",
  ins_unmet: "No results",
  ins_unmet_rate: "{p}% of searches",
  ins_period: "Period",
  ins_by_need: "Searches by need",
  ins_unmet_zip: "Searches with no results, by zip code",
  ins_unmet_zip_value: "{u} of {t}",
  ins_no_zip: "No zip code",
  ins_languages: "Languages",
  ins_channels: "Channels",
  ins_empty: "No searches logged yet.",
  ins_none_unmet: "Every search found results.",
  ins_table: "View as table",
  ins_col_item: "Category",
  ins_col_value: "Count",
  channel_mcp: "AI assistants (MCP)",
  channel_whatsapp: "WhatsApp",
  channel_voice: "Voice",
  channel_web: "Web",
  lang_unknown: "Unknown",
};

export const STRINGS: Record<Lang, Record<Key, string>> = { es, en };

const LANG_KEY = "nyc-nav-lang";

function initialLang(): Lang {
  // A shared link can pick the language: ?lang=en or #/directory?lang=en
  const m = /[?&]lang=(es|en)\b/.exec(location.search + location.hash);
  if (m) return m[1] as Lang;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch { /* storage blocked */ }
  return "es"; // Spanish is the default, whatever the browser says
}

/** Fill {vars} in a template. */
function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** Label for a dynamic key like need_food / org_pantry / lang_quc; falls back to the raw value. */
  label: (prefix: "need" | "org" | "lang" | "trust" | "channel", value: string) => string;
  /** "2026-10-10" -> "10 oct 2026" / "Oct 10, 2026" */
  date: (ymd: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = STRINGS[lang].app_name;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const dict = STRINGS[lang];
    const t = (key: Key, vars?: Record<string, string | number>) => fill(dict[key] ?? es[key] ?? key, vars);
    const label = (prefix: string, v: string) => {
      const key = `${prefix}_${v}` as Key;
      return key in dict ? dict[key] : v;
    };
    const date = (ymd: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
      if (!m) return ymd;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local date, no timezone shift
      return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric" });
    };
    return { lang, setLang, t, label, date };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
