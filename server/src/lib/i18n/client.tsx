/**
 * Client-side i18n utilities and React components
 */

'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import i18next from 'i18next';
import { initReactI18next, useTranslation as useI18nextTranslation } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { getCookie, setCookie } from 'cookies-next';
import {
  LOCALE_CONFIG,
  I18N_CONFIG,
  SupportedLocale,
  isSupportedLocale,
} from './config';

/**
 * Initialize i18next on the client side
 */
let i18nInitialized = false;

async function initI18n(locale?: SupportedLocale) {
  if (i18nInitialized) return;

  await i18next
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      ...I18N_CONFIG,
      lng: locale || LOCALE_CONFIG.defaultLocale,
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      detection: {
        order: ['cookie', 'localStorage', 'navigator'],
        caches: ['cookie', 'localStorage'],
        lookupCookie: LOCALE_CONFIG.cookie.name,
        lookupLocalStorage: 'locale',
        cookieOptions: {
          sameSite: LOCALE_CONFIG.cookie.sameSite,
        },
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
}

export function I18nProvider({
  children,
  initialLocale,
  portal = 'client',
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    initialLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Initialize i18next
    initI18n(locale).then(() => {
      setIsInitialized(true);
    });
  }, [locale]);

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
    supportedLocales: LOCALE_CONFIG.supportedLocales,
    localeNames: LOCALE_CONFIG.localeNames,
    isRTL: LOCALE_CONFIG.rtlLocales.includes(locale),
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading translations...</div>
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
 * Hook for translations (wrapper around react-i18next)
 */
export function useTranslation(namespace?: string) {
  return useI18nextTranslation(namespace);
}

/**
 * Client-side locale detection
 */
export function detectClientLocale(): SupportedLocale {
  // Only run on client side
  if (typeof window === 'undefined') {
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }

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

  return {
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
  };
}