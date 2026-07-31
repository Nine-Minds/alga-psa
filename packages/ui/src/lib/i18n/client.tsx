/**
 * Client-side i18n utilities and React components
 */

'use client';

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import i18next from 'i18next';
import { initReactI18next, useTranslation as useI18nextTranslation } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import { getCookie, setCookie } from 'cookies-next';
import {
  LOCALE_CONFIG,
  I18N_CONFIG,
  SupportedLocale,
  isSupportedLocale,
  filterPseudoLocales,
} from './config';

/**
 * Initialize i18next on the client side.
 *
 * The locale is supplied explicitly by `I18nProvider` (which receives it from
 * `I18nWrapper` → `getHierarchicalLocaleAction`, the same DB-pref-aware
 * resolver the server uses). We deliberately do NOT use `LanguageDetector`:
 * cookie/localStorage/navigator detection used to silently override the user's
 * stored DB preference, producing the server-vs-client locale drift where
 * server text rendered in one language and client text in another.
 */
let i18nInitialized = false;

const BOOTSTRAP_LOADING_TEXT: Record<
  SupportedLocale,
  { translations: string; languagePreferences: string }
> = {
  en: {
    translations: 'Loading translations...',
    languagePreferences: 'Loading language preferences...',
  },
  fr: {
    translations: 'Chargement des traductions...',
    languagePreferences: 'Chargement des préférences linguistiques...',
  },
  es: {
    translations: 'Cargando traducciones...',
    languagePreferences: 'Cargando preferencias de idioma...',
  },
  de: {
    translations: 'Übersetzungen werden geladen...',
    languagePreferences: 'Spracheinstellungen werden geladen...',
  },
  nl: {
    translations: 'Vertalingen worden geladen...',
    languagePreferences: 'Taalvoorkeuren worden geladen...',
  },
  it: {
    translations: 'Caricamento delle traduzioni...',
    languagePreferences: 'Caricamento delle preferenze lingua...',
  },
  pl: {
    translations: 'Ładowanie tłumaczeń...',
    languagePreferences: 'Ładowanie preferencji językowych...',
  },
  pt: {
    translations: 'Carregando traduções...',
    languagePreferences: 'Carregando preferências de idioma...',
  },
  xx: {
    translations: '11111',
    languagePreferences: '11111',
  },
  yy: {
    translations: '55555',
    languagePreferences: '55555',
  },
};

export function getBootstrapLoadingText(
  locale: SupportedLocale | undefined,
  key: keyof (typeof BOOTSTRAP_LOADING_TEXT)[SupportedLocale],
) {
  const resolvedLocale = locale && isSupportedLocale(locale)
    ? locale
    : (LOCALE_CONFIG.defaultLocale as SupportedLocale);

  return BOOTSTRAP_LOADING_TEXT[resolvedLocale]?.[key] ?? BOOTSTRAP_LOADING_TEXT.en[key];
}

/** Namespace resources embedded in the initial HTML, keyed by namespace. */
export type PreloadedNamespaceResources = Record<string, Record<string, unknown>>;

/**
 * Merge server-embedded namespace resources into i18next so the HTTP backend
 * never fetches them. Safe to call before or after init (addResourceBundle is
 * idempotent with the merge flag).
 */
function applyPreloadedResources(
  locale: SupportedLocale,
  preloaded?: PreloadedNamespaceResources,
) {
  if (!preloaded) return;
  for (const [namespace, resources] of Object.entries(preloaded)) {
    if (!i18next.hasResourceBundle(locale, namespace)) {
      i18next.addResourceBundle(locale, namespace, resources, true, true);
    }
  }
}

async function initI18n(locale?: SupportedLocale, preloaded?: PreloadedNamespaceResources) {
  const resolvedLocale = (locale || LOCALE_CONFIG.defaultLocale) as SupportedLocale;
  if (i18nInitialized) {
    applyPreloadedResources(resolvedLocale, preloaded);
    if (locale && i18next.language !== locale) {
      await i18next.changeLanguage(locale);
    }
    return;
  }

  await i18next
    .use(HttpBackend)
    .use(initReactI18next)
    .init({
      ...I18N_CONFIG,
      lng: resolvedLocale,
      // Seed the route's namespaces so useTranslation() resolves them without a
      // network round-trip; the HTTP backend still covers anything not seeded.
      resources: preloaded ? { [resolvedLocale]: preloaded } : undefined,
      partialBundledLanguages: true,
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
    });

  i18nInitialized = true;
}

/**
 * I18n context for managing locale state
 */
interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  supportedLocales: readonly SupportedLocale[];
  localeNames: Record<string, string>;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * I18n Provider component
 */
interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  portal?: 'msp' | 'client';
  namespaces?: string[];
  /** Server-embedded namespace resources for the current route (no HTTP fetch). */
  preloadedResources?: PreloadedNamespaceResources;
}

export function I18nProvider({
  children,
  initialLocale,
  portal = 'client',
  namespaces,
  preloadedResources,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    initialLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Initialize i18next
    initI18n(locale, preloadedResources).then(() => {
      setIsInitialized(true);
    });
  }, [locale, preloadedResources]);

  useEffect(() => {
    if (!isInitialized || !namespaces || namespaces.length === 0) {
      return;
    }

    const missing = namespaces.filter(
      (namespace) => !i18next.hasResourceBundle(locale, namespace)
    );

    if (missing.length === 0) {
      return;
    }

    i18next.loadNamespaces(missing).catch((error) => {
      console.error('Failed to load namespaces:', error);
    });
  }, [isInitialized, locale, namespaces]);

  const setLocale = async (newLocale: SupportedLocale) => {
    if (!isSupportedLocale(newLocale)) {
      console.error(`Unsupported locale: ${newLocale}`);
      return;
    }

    // Update i18next
    await i18next.changeLanguage(newLocale);

    // Update cookie
    setCookie(LOCALE_CONFIG.cookie.name, newLocale, LOCALE_CONFIG.cookie);

    // Update state
    setLocaleState(newLocale);

    // Save to user preferences if in MSP portal
    if (portal === 'msp') {
      try {
        await fetch('/api/user/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: newLocale }),
        });
      } catch (error) {
        console.error('Failed to save locale preference:', error);
      }
    }

    // Save to tenant settings if configuring client portal default
    if (portal === 'msp' && window.location.pathname.includes('/settings/client-portal')) {
      try {
        await fetch('/api/tenant/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_portal_settings: { defaultLocale: newLocale },
          }),
        });
      } catch (error) {
        console.error('Failed to save tenant default locale:', error);
      }
    }
  };

  const value: I18nContextValue = {
    locale,
    setLocale,
    supportedLocales: filterPseudoLocales(LOCALE_CONFIG.supportedLocales),
    localeNames: LOCALE_CONFIG.localeNames,
    isRTL: LOCALE_CONFIG.rtlLocales.includes(locale),
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">{getBootstrapLoadingText(locale, 'translations')}</div>
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Hook to access i18n context
 */
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

/**
 * Like useI18n, but returns null outside an I18nProvider instead of throwing.
 * For shared components (DatePicker, CurrencyInput, …) that also render on
 * pages without the provider (e.g. auth pages) and need a locale fallback.
 */
export function useOptionalI18n() {
  return useContext(I18nContext);
}

/**
 * Hook for translations (wrapper around react-i18next)
 */
export function useTranslation(namespace?: string | string[]) {
  return useI18nextTranslation(namespace as any);
}

/**
 * Client-side locale detection
 */
export function detectClientLocale(
  options: { includeStoredPreference?: boolean } = {}
): SupportedLocale {
  // Only run on client side
  if (typeof window === 'undefined') {
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }

  const includeStoredPreference = options.includeStoredPreference ?? true;

  if (includeStoredPreference) {
    // 1. Check cookie
    const localeCookie = getCookie(LOCALE_CONFIG.cookie.name);
    if (localeCookie && typeof localeCookie === 'string' && isSupportedLocale(localeCookie)) {
      return localeCookie;
    }

    // 2. Check localStorage (only on client)
    try {
      const localStorageLocale = localStorage.getItem(LOCALE_CONFIG.cookie.name);
      if (localStorageLocale && isSupportedLocale(localStorageLocale)) {
        return localStorageLocale;
      }
    } catch (e) {
      // localStorage might not be available
    }
  }

  // 3. Check browser language (only on client)
  try {
    const browserLocale = navigator.language.split('-')[0];
    if (isSupportedLocale(browserLocale)) {
      return browserLocale;
    }
  } catch (e) {
    // navigator might not be available
  }

  // 4. Default
  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

/**
 * Format utilities for client-side use
 */
export function useFormatters() {
  const { locale } = useI18n();

  return useMemo(() => ({
    formatDate: (
      date: Date | string,
      options?: Intl.DateTimeFormatOptions
    ) => {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat(locale, options).format(dateObj);
    },

    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => {
      return new Intl.NumberFormat(locale, options).format(value);
    },

    formatCurrency: (
      value: number,
      currency: string,
      options?: Intl.NumberFormatOptions
    ) => {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        ...options,
      }).format(value);
    },

    formatRelativeTime: (date: Date | string) => {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

      const diff = dateObj.getTime() - Date.now();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (Math.abs(days) > 0) return rtf.format(days, 'day');
      if (Math.abs(hours) > 0) return rtf.format(hours, 'hour');
      if (Math.abs(minutes) > 0) return rtf.format(minutes, 'minute');
      return rtf.format(seconds, 'second');
    },
  }), [locale]);
}
