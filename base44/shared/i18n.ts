// Fixed strings in Spanish and English. Spanish is the default and the
// fallback for any other language (the LLM may write other languages; fixed
// strings stay Spanish). Spanish is plain and warm, using "usted".
//
//   t("es", "disclaimer")
//   t("en", "no_results", { need: "food", near: "Corona" })
//   t("qu", "consent_required")  // -> Spanish

export type Lang = "es" | "en";

const es = {
  // Trust and safety
  disclaimer:
    "Esto es información y referidos, no es consejo legal. Para ayuda legal, hable con un abogado con licencia o con un representante acreditado por el Departamento de Justicia (DOJ).",
  notario_warning:
    "Cuidado: solo los abogados con licencia y los representantes acreditados por el Departamento de Justicia (DOJ) pueden dar ayuda legal de inmigración. Los notarios no pueden, aunque se anuncien como expertos. No pague ni firme nada hasta hablar con un abogado con licencia o un representante acreditado por el DOJ.",
  status_note_prefix: "Antes de aplicar:",
  status_talk_to_provider:
    "Este programa puede depender de su situación. Antes de aplicar, hable con un abogado con licencia o un representante acreditado por el DOJ (vea las opciones de las listas del DOJ).",
  no_results: "No encontramos lugares para {need} cerca de {near} todavía. Le mostramos opciones en toda la ciudad.",
  no_results_anywhere:
    "Todavía no tenemos lugares para {need}. Puede llamar al 311 y pedir ayuda en español.",
  unknown_location: "No reconocimos \"{near}\". Puede escribir un código postal (por ejemplo 11368) o un barrio.",
  consent_required:
    "Necesitamos su permiso antes de enviar algo a su teléfono. ¿Quiere que se lo enviemos por WhatsApp?",
  sent_ok: "Listo. Le enviamos el plan por WhatsApp.",
  send_failed: "No pudimos enviar el mensaje ahora. Puede copiar el plan desde aquí.",
  phone_invalid: "Ese número de teléfono no parece válido. Escríbalo con el código de área, por ejemplo +1 718 555 0101.",
  provider_found: "\"{name}\" aparece en la lista oficial del Departamento de Justicia (DOJ).",
  provider_not_found:
    "No encontramos \"{name}\" en las listas oficiales del Departamento de Justicia (DOJ) de abogados y representantes acreditados.",
  free_providers_nearby: "Opciones de las listas del DOJ cerca de usted (verificadas por nuestro equipo):",
  free_providers_doj: "Opciones de las listas del DOJ cerca de usted:",
  source_community: "Enviado por la comunidad y revisado por nuestro equipo el {date}.",
  plan_intro: "Su plan, paso a paso. El primer paso le ayuda con los siguientes.",
  intake_title_person: "Resumen para llevar a su cita legal",
  intake_title_lawyer: "Intake summary for the attorney",
  sample_data_note: "Datos de ejemplo para la demostración.",
  check_stale: "Revisamos este lugar hace más de {months} meses. Llame antes de ir.",
  check_seasonal: "El horario es por temporada (fechas fijas). Llame para confirmar antes de ir.",
  check_reported: "Alguien nos avisó que esta información puede estar mal. La estamos revisando: llame antes de ir.",
  call_311: "Para preguntas o citas, llame al 311.",
  org_locations: "{org} tiene {n} sedes. Esta es la más cercana; si no le queda bien, pregunte por las otras.",

  // Labels
  label_hours: "Horario",
  label_languages: "Idiomas",
  label_bring: "Qué llevar",
  label_trust: "Confianza",
  label_source: "Fuente",
  label_last_checked: "Última revisión",
  label_address: "Dirección",
  label_phone: "Teléfono",
  label_who_can_use: "Quién puede usarlo",
  label_how_to_apply: "Cómo aplicar",
  label_step: "Paso {n}",
  label_why_first: "Por qué primero",
  label_open_now: "Abierto ahora",
  label_closed_now: "Cerrado ahora",
  label_open_today: "Abre hoy",
  label_hours_unknown: "Horario por confirmar",
  label_by_appointment: "Con cita",
  label_open_evenings: "Abre en la noche",
  label_open_weekends: "Abre los fines de semana",
  label_free: "Gratis",

  // Trust levels
  trust_official: "Oficial",
  trust_verified: "Verificado",
  trust_community: "De la comunidad",
  trust_unverified: "Sin verificar",

  // Needs
  need_food: "comida",
  need_legal: "ayuda legal",
  need_health: "salud",
  need_benefits: "beneficios",
  need_money: "dinero y banco",
  need_school: "escuela",
  need_id: "identificación",
  need_housing: "vivienda",
  need_work: "trabajo",
  need_transit: "transporte",
};

export type I18nKey = keyof typeof es;

const en: Record<I18nKey, string> = {
  disclaimer:
    "This is information and referrals, not legal advice. For legal help, talk with a licensed attorney or a DOJ-accredited representative.",
  notario_warning:
    "Careful: only licensed attorneys and DOJ-accredited representatives can give immigration legal help. Notarios cannot, even if they advertise as experts. Do not pay or sign anything until you talk with a licensed attorney or a DOJ-accredited representative.",
  status_note_prefix: "Before you apply:",
  status_talk_to_provider:
    "This program may depend on your situation. Before you apply, talk with a licensed attorney or a DOJ-accredited representative (see the DOJ-listed options).",
  no_results: "We did not find places for {need} near {near} yet. Here are options across the city.",
  no_results_anywhere: "We do not have places for {need} yet. You can call 311 and ask for help in your language.",
  unknown_location: "We did not recognize \"{near}\". Try a zip code (for example 11368) or a neighborhood.",
  consent_required: "We need your permission before sending anything to your phone. Do you want us to send it by WhatsApp?",
  sent_ok: "Done. We sent the plan to your WhatsApp.",
  send_failed: "We could not send the message right now. You can copy the plan from here.",
  phone_invalid: "That phone number does not look valid. Include the area code, for example +1 718 555 0101.",
  provider_found: "\"{name}\" appears on the official Department of Justice (DOJ) list.",
  provider_not_found:
    "We did not find \"{name}\" on the official Department of Justice (DOJ) lists of attorneys and accredited representatives.",
  free_providers_nearby: "DOJ-listed options near you (checked by our team):",
  free_providers_doj: "DOJ-listed options near you:",
  source_community: "Sent by the community and reviewed by our team on {date}.",
  plan_intro: "Your plan, step by step. The first step helps with the next ones.",
  intake_title_person: "Summary to bring to your legal appointment",
  intake_title_lawyer: "Intake summary for the attorney",
  sample_data_note: "Sample data for the demo.",
  check_stale: "We last checked this place more than {months} months ago. Call before you go.",
  check_seasonal: "These hours are seasonal (set dates). Call to confirm before you go.",
  check_reported: "Someone told us this information may be wrong. We are checking it: call before you go.",
  call_311: "For questions or appointments, call 311.",
  org_locations: "{org} has {n} locations. This is the closest; if it does not work for you, ask about the others.",

  label_hours: "Hours",
  label_languages: "Languages",
  label_bring: "What to bring",
  label_trust: "Trust",
  label_source: "Source",
  label_last_checked: "Last checked",
  label_address: "Address",
  label_phone: "Phone",
  label_who_can_use: "Who can use it",
  label_how_to_apply: "How to apply",
  label_step: "Step {n}",
  label_why_first: "Why first",
  label_open_now: "Open now",
  label_closed_now: "Closed now",
  label_open_today: "Open today",
  label_hours_unknown: "Hours to be confirmed",
  label_by_appointment: "By appointment",
  label_open_evenings: "Open evenings",
  label_open_weekends: "Open weekends",
  label_free: "Free",

  trust_official: "Official",
  trust_verified: "Verified",
  trust_community: "Community",
  trust_unverified: "Unverified",

  need_food: "food",
  need_legal: "legal help",
  need_health: "health",
  need_benefits: "benefits",
  need_money: "money and banking",
  need_school: "school",
  need_id: "ID",
  need_housing: "housing",
  need_work: "work",
  need_transit: "transit",
};

export const STRINGS: Record<Lang, Record<I18nKey, string>> = { es, en };

/** "es-MX" -> "es", "EN" -> "en", anything else -> "es" (the default). */
export function langOf(language: unknown): Lang {
  const base = typeof language === "string" ? language.trim().toLowerCase().slice(0, 2) : "";
  return base === "en" ? "en" : "es";
}

/** Translate a fixed string, filling {vars}. Unknown keys return the key itself. */
export function t(lang: unknown, key: I18nKey, vars: Record<string, string | number> = {}): string {
  const template = STRINGS[langOf(lang)][key] ?? STRINGS.es[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Shortcut: the disclaimer every result carries. */
export function disclaimer(lang: unknown): string {
  return t(lang, "disclaimer");
}

/** Human label for a need ("food" -> "comida"). */
export function needLabel(lang: unknown, need: string): string {
  const key = `need_${need}` as I18nKey;
  return key in es ? t(lang, key) : need;
}

/**
 * Heading for DOJ-listed options. Says "checked by our team" only when every
 * provider listed is official or verified; otherwise "on the DOJ lists".
 */
export function freeProvidersTitle(lang: unknown, trusts: unknown[]): string {
  const allVerified = trusts.length > 0 && trusts.every((x) => x === "official" || x === "verified");
  return t(lang, allVerified ? "free_providers_nearby" : "free_providers_doj");
}

/** Human label for a trust level ("verified" -> "Verificado"). */
export function trustLabel(lang: unknown, trust: string): string {
  const key = `trust_${trust}` as I18nKey;
  return key in es ? t(lang, key) : trust;
}
