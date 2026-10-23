/** Pure state helpers for the email templates table. */

type LanguageBearing = { language_code: string };

/** Every language the table can show, sorted so the filter menu is stable. */
export function collectTemplateLanguages(templates: {
  systemTemplates: LanguageBearing[];
  tenantTemplates: LanguageBearing[];
}): string[] {
  const codes = new Set<string>();
  for (const template of [...templates.systemTemplates, ...templates.tenantTemplates]) {
    if (template.language_code) codes.add(template.language_code);
  }
  return [...codes].sort();
}

/**
 * Languages ticked on first load: the tenant default when the table actually
 * carries it, otherwise nothing — an empty filter means "show all".
 */
export function initialLanguageSelection(
  availableLanguages: readonly string[],
  defaultLocale: string | null | undefined,
): string[] {
  if (!defaultLocale) return [];
  return availableLanguages.includes(defaultLocale) ? [defaultLocale] : [];
}
