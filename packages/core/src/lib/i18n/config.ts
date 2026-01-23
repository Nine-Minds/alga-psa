/**
 * Central configuration for internationalization (i18n) support
 * This config drives all language-related functionality in the application
 *
 * Moved from @alga-psa/ui to break circular dependency:
 * ui -> analytics -> tenancy -> ui
 */

export const LOCALE_CONFIG = {
  /**
   * The default locale to use when no preference is set
   */
  defaultLocale: 'en',

  /**
   * Array of supported locales
   * Add new languages here to enable them throughout the application
   */
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt_BR'] as const,

  /**
   * Human-readable names for each locale
   * Used in language switcher UI components
   */
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

  /**
   * Locales that require right-to-left text direction
   * Add locale codes here for RTL languages (e.g., 'ar', 'he')
   */
  rtlLocales: [] as string[],

  /**
   * Cookie configuration for storing user locale preference
   */
  cookie: {
    name: 'locale',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  },
} as const;

/**
 * Type for supported locales derived from config
 */
export type SupportedLocale = typeof LOCALE_CONFIG.supportedLocales[number];

/**
 * Type guard to check if a string is a supported locale
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return LOCALE_CONFIG.supportedLocales.includes(locale as SupportedLocale);
}

/**
 * Get the best matching locale from a list of preferred locales
 */
export function getBestMatchingLocale(
  preferredLocales: readonly string[],
): SupportedLocale {
  for (const locale of preferredLocales) {
    // Exact match
    if (isSupportedLocale(locale)) {
      return locale;
    }

    // Try language part only (e.g., 'en' from 'en-US')
    const languagePart = locale.split('-')[0];
    if (isSupportedLocale(languagePart)) {
      return languagePart as SupportedLocale;
    }
  }

  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

/**
 * Configuration for i18next
 */
export const I18N_CONFIG = {
  debug: process.env.NODE_ENV === 'development',
  fallbackLng: LOCALE_CONFIG.defaultLocale,
  supportedLngs: [...LOCALE_CONFIG.supportedLocales],
  defaultNS: 'common',
  ns: ['common', 'clientPortal'],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  load: 'languageOnly' as const, // Don't load region-specific variants
  cleanCode: true,
  nonExplicitSupportedLngs: true,
};

/**
 * Paths for translation resources
 */
export const TRANSLATION_PATHS = {
  server: '/locales/{{lng}}/{{ns}}.json',
  client: '/locales/{{lng}}/{{ns}}.json',
} as const;
