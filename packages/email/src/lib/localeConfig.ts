// TODO: Consolidate with @alga-psa/ui/lib/i18n/config after circular dependency is resolved
// This is a temporary duplication to break the email -> ui cycle

export const LOCALE_CONFIG = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'sv'] as const,
  localeNames: {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
    nl: 'Nederlands',
    it: 'Italiano',
    pl: 'Polski',
    pt: 'Português (Brasil)',
    sv: 'Svenska',
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

/**
 * The locales an email or notification template ships copy for.
 *
 * Templates carry written copy, so they are stored per *language pack* rather
 * than per selectable locale. That is narrower than `supportedLocales` in two
 * ways: a regional variant (`en-AU`) has no pack of its own and renders the
 * language it falls back to, and the `xx`/`yy` pseudo-locales are QA fills that
 * must never reach a recipient's mailbox. Seeding either would write duplicate
 * or unreadable rows into every tenant's template table.
 *
 * The migrations keep their own copy of this list (they are `.cjs` and cannot
 * import this module); `templateLocaleParity.test.ts` holds the two in step.
 */
export const TEMPLATE_LOCALES: readonly SupportedLocale[] = LOCALE_CONFIG.supportedLocales;
