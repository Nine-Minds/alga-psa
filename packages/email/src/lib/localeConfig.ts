// TODO: Consolidate with @alga-psa/ui/lib/i18n/config after circular dependency is resolved
// This is a temporary duplication to break the email -> ui cycle

export const LOCALE_CONFIG = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt'] as const,
  localeNames: {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
    nl: 'Nederlands',
    it: 'Italiano',
    pl: 'Polski',
    pt: 'Português (Brasil)',
  } as const,
  rtlLocales: [] as string[],
} as const;

export type SupportedLocale = typeof LOCALE_CONFIG.supportedLocales[number];

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return LOCALE_CONFIG.supportedLocales.includes(locale as SupportedLocale);
}

/** Mirrors normalizeLocale in @alga-psa/core/i18n/config — see the TODO above. */
export function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (isSupportedLocale(trimmed)) return trimmed;

  const languagePart = trimmed.split(/[-_]/)[0];
  return isSupportedLocale(languagePart) ? languagePart : null;
}
