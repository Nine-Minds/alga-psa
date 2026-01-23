// TODO: Consolidate with @alga-psa/ui/lib/i18n/config after circular dependency is resolved
// This is a temporary duplication to break the email -> ui cycle

export const LOCALE_CONFIG = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt_BR'] as const,
  localeNames: {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
    nl: 'Nederlands',
    it: 'Italiano',
    pl: 'Polski',
    pt_BR: 'Português (Brasil)',
  } as const,
  rtlLocales: [] as string[],
} as const;

export type SupportedLocale = typeof LOCALE_CONFIG.supportedLocales[number];

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return LOCALE_CONFIG.supportedLocales.includes(locale as SupportedLocale);
}
