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
import { formatDateValue } from './formatDateValue';
import { useDateFormat } from '../dateFormat/useDateFormat';

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
type I18nInitializationAttempt = {
  promise: Promise<void>;
  state: 'pending' | 'timed-out' | 'ready' | 'failed';
};
let i18nInitialization: I18nInitializationAttempt | null = null;
let i18nReconciliation: Promise<void> = Promise.resolve();
// A fallback deadline for the UI readiness gate; it is not a diagnosis that
// this timeout caused any particular browser bootstrap failure.
const I18N_READINESS_TIMEOUT_MS = 10_000;

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
  sv: {
    translations: 'Laddar översättningar...',
    languagePreferences: 'Laddar språkinställningar...',
  },
  // Mirrors scripts/generate-pseudo-locales.cjs; these two never reach a pack.
  xx: {
    translations: '⟦Ŀȯȧḓīƞɠ ŧřȧƞşŀȧŧīȯƞş...⟧',
    languagePreferences: '⟦Ŀȯȧḓīƞɠ ŀȧƞɠŭȧɠḗ ƥřḗƒḗřḗƞƈḗş...⟧',
  },
  yy: {
    translations: '〖Ŀȯȧḓīƞɠ ŧřȧƞşŀȧŧīȯƞş... ··········〗',
    languagePreferences: '〖Ŀȯȧḓīƞɠ ŀȧƞɠŭȧɠḗ ƥřḗƒḗřḗƞƈḗş... ·············〗',
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
 *
 * Locales are language codes, so a bundle is keyed by the locale itself.
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

/**
 * Pull in any of the route's namespaces that aren't in memory yet.
 *
 * Without this awaited before children render, the first `t()` call in a
 * namespace still in flight logs i18next's "was not yet loaded ... something
 * IS WRONG in your setup" warning and returns the key's English defaultValue
 * until the fetch lands. On a fast connection that resolves too quickly to
 * see; on a cold cache or a slow link it is a visible flash of English — or a
 * raw key for any call site without a defaultValue.
 */
async function ensureNamespacesLoaded(
  locale: SupportedLocale,
  namespaces?: string[],
) {
  if (!namespaces || namespaces.length === 0) return;

  const missing = namespaces.filter(
    (namespace) => !i18next.hasResourceBundle(locale, namespace)
  );
  if (missing.length === 0) return;

  try {
    await i18next.loadNamespaces(missing);
  } catch (error) {
    // A namespace that fails to load must not strand the page on its spinner;
    // keys fall back to their defaultValue, as they did before this awaited.
    console.error('Failed to load namespaces:', error);
  }
}

async function reconcileProviderI18n(
  locale: SupportedLocale,
  preloaded: PreloadedNamespaceResources | undefined,
  namespaces: string[] | undefined,
  isProviderActive: () => boolean,
) {
  // Keep provider-specific locale/resource work ordered. If an old provider's
  // language change is already in flight when it unmounts, the current
  // provider's reconciliation runs after it and becomes the final state.
  const reconciliation = i18nReconciliation.then(async () => {
    if (!isProviderActive()) return;

    applyPreloadedResources(locale, preloaded);
    if (i18next.language !== locale) {
      await i18next.changeLanguage(locale);
    }
  });
  i18nReconciliation = reconciliation.catch(() => undefined);
  await reconciliation;

  // Namespace loads do not mutate the active language, so do not keep the
  // locale-reconciliation queue locked while a stale provider's load is
  // pending. Cleanup skips loads that have not started yet.
  if (!isProviderActive()) return;
  await ensureNamespacesLoaded(locale, namespaces);
}

async function initI18n(
  locale?: SupportedLocale,
  preloaded?: PreloadedNamespaceResources,
  namespaces?: string[],
  isProviderActive: () => boolean = () => true,
) {
  const resolvedLocale = (locale || LOCALE_CONFIG.defaultLocale) as SupportedLocale;
  if (!i18nInitialized) {
    if (i18nInitialization?.state === 'timed-out') {
      // Render the provider's fallback immediately, but keep its current
      // inputs attached to the shared attempt for reconciliation on settlement.
      const attempt = i18nInitialization;
      void attempt.promise
        .then(() => reconcileProviderI18n(
          resolvedLocale,
          preloaded,
          namespaces,
          isProviderActive,
        ))
        .catch((error) => {
          if (isProviderActive()) {
            console.error('Failed to initialize translations:', error);
          }
        });
      return;
    }

    // React StrictMode mounts effects twice in development. Share the in-flight
    // init so concurrent effects/providers cannot call i18next.init twice.
    if (!i18nInitialization) {
      // Seed only when the server actually embedded namespace data — an empty
      // seed would mark the bundle as loaded and mask fetched translations.
      const hasPreloadedContent = preloaded && Object.keys(preloaded).length > 0;
      const seededResources = hasPreloadedContent
        ? { [resolvedLocale]: preloaded }
        : undefined;

      const attempt: I18nInitializationAttempt = {
        state: 'pending',
        // The promise is assigned synchronously before its work starts so
        // another provider cannot enter i18next.init in the same tick.
        promise: Promise.resolve(),
      };
      i18nInitialization = attempt;
      const initialization = i18next
        .use(HttpBackend)
        .use(initReactI18next)
        .init({
          ...I18N_CONFIG,
          lng: resolvedLocale,
          react: { useSuspense: false },
          resources: seededResources,
          partialBundledLanguages: true,
          backend: {
            loadPath: '/locales/{{lng}}/{{ns}}.json',
          },
        });
      attempt.promise = Promise.resolve(initialization)
        .then(() => {
          if (i18nInitialization === attempt) {
            attempt.state = 'ready';
            i18nInitialized = true;
          }
        })
        .catch((error) => {
          attempt.state = 'failed';
          // Only the attempt that owns the slot may release it. A stale
          // completion cannot clear a newer initialization.
          if (i18nInitialization === attempt) i18nInitialization = null;
          throw error;
        });
    }
    await i18nInitialization.promise;
  }

  await reconcileProviderI18n(resolvedLocale, preloaded, namespaces, isProviderActive);
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
  /** Render auth children while i18next initializes in the background. */
  renderChildrenWhileLoading?: boolean;
}

export function I18nProvider({
  children,
  initialLocale,
  portal = 'client',
  namespaces,
  preloadedResources,
  renderChildrenWhileLoading = false,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    initialLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Identity, not contents, is what would re-run the effect: callers that build
  // this array inline would otherwise reload namespaces on every render.
  const namespaceKey = namespaces ? namespaces.join(',') : '';

  // Auth pages can render their forms while the backend loads. Install the
  // shared i18next instance synchronously so useTranslation is ready before
  // those children render; the effect below still owns the readiness fallback.
  if (renderChildrenWhileLoading && typeof window !== 'undefined' && !i18nInitialization) {
    void initI18n(
      locale,
      preloadedResources,
      namespaceKey ? namespaceKey.split(',') : undefined,
    ).catch(() => undefined);
  }

  useEffect(() => {
    let cancelled = false;
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    // The route's namespaces are awaited as part of initialization rather than
    // in a follow-up effect. The readiness deadline below is a fallback for a
    // request that never settles; it does not mean translations are ready.
    const readiness = initI18n(
      locale,
      preloadedResources,
      namespaceKey ? namespaceKey.split(',') : undefined,
      () => !cancelled,
    );
    const initializationAttempt = i18nInitialization;
    const readinessDeadline = new Promise<never>((_, reject) => {
      readinessTimer = setTimeout(() => {
        if (
          initializationAttempt &&
          i18nInitialization === initializationAttempt &&
          initializationAttempt.state === 'pending'
        ) {
          // Keep ownership of the singleton while its init promise is pending.
          // This prevents a timed-out provider remount from overlapping init.
          i18nInitialization.state = 'timed-out';
        }
        reject(new Error(`Translation initialization exceeded ${I18N_READINESS_TIMEOUT_MS}ms`));
      }, I18N_READINESS_TIMEOUT_MS);
    });

    Promise.race([readiness, readinessDeadline])
      .then(() => {
        if (!cancelled) setIsInitialized(true);
      })
      .catch((error) => {
        // Initialization failures must not strand sign-in or other pages behind
        // the bootstrap screen. i18next can still render keys/default values.
        if (!cancelled) {
          console.error('Failed to initialize translations:', error);
          setIsInitialized(true);
        }
      })
      .finally(() => {
        if (readinessTimer) clearTimeout(readinessTimer);
      });
    return () => {
      cancelled = true;
      if (readinessTimer) clearTimeout(readinessTimer);
    };
  }, [locale, preloadedResources, namespaceKey]);

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

  if (!isInitialized && !renderChildrenWhileLoading) {
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
export function useTranslation(namespace?: string | string[], options?: any) {
  return useI18nextTranslation(namespace as any, options);
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
 * Format utilities for client-side use.
 *
 * Reads the locale optionally: a formatter must not crash the tree it renders
 * in just because no provider is above it (drawers, print views and component
 * tests all render outside one). Without a provider it falls back to the
 * default locale, which at least stays deterministic rather than following
 * whatever the browser happens to be set to. `locale` is returned so callers
 * can pass it to module-scope helpers that have no hook of their own.
 *
 * `dateFormat` comes from the country, not the locale: digit order, separator
 * and the 12/24h clock are the tenant's (or client's) country's, while the
 * locale still supplies month and weekday names. Outside a DateFormatProvider
 * it is the fixed system default, so provider-less trees stay deterministic.
 */
export function useFormatters() {
  const context = useOptionalI18n();
  const locale = context?.locale ?? (LOCALE_CONFIG.defaultLocale as SupportedLocale);
  const dateFormat = useDateFormat();

  return useMemo(() => ({
    locale,
    dateFormat,

    formatDate: (
      date: Date | string,
      options?: Intl.DateTimeFormatOptions
    ) => {
      // Date-only strings are calendar dates and must not shift through the
      // browser timezone; see formatDateValue.
      return formatDateValue(date, locale, options, dateFormat);
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
      const absoluteDiff = Math.abs(diff);

      if (absoluteDiff >= 24 * 60 * 60 * 1000) {
        return rtf.format(Math.trunc(diff / (24 * 60 * 60 * 1000)), 'day');
      }
      if (absoluteDiff >= 60 * 60 * 1000) {
        return rtf.format(Math.trunc(diff / (60 * 60 * 1000)), 'hour');
      }
      if (absoluteDiff >= 60 * 1000) {
        return rtf.format(Math.trunc(diff / (60 * 1000)), 'minute');
      }
      return rtf.format(Math.trunc(diff / 1000), 'second');
    },
  }), [locale, dateFormat]);
}
