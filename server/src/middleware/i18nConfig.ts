/**
 * Minimal i18n config/helpers that are safe to import from Next.js Middleware (Edge runtime).
 *
 * NOTE: Keep this file dependency-free (no imports from workspace packages that might pull in Node-only deps).
 */

export const LOCALE_CONFIG = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt_BR'] as const,
  cookie: {
    name: 'locale',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  },
} as const;

export type SupportedLocale = typeof LOCALE_CONFIG.supportedLocales[number];

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return LOCALE_CONFIG.supportedLocales.includes(locale as SupportedLocale);
}

export function getBestMatchingLocale(
  preferredLocales: readonly string[],
): SupportedLocale {
  for (const locale of preferredLocales) {
    if (isSupportedLocale(locale)) {
      return locale;
    }

    const languagePart = locale.split('-')[0];
    if (isSupportedLocale(languagePart)) {
      return languagePart as SupportedLocale;
    }
  }

  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

