import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import * as Localization from "expo-localization";
import i18next from "./i18n";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "./config";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";

const LOCALE_STORAGE_KEY = "alga.mobile.locale";

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  supportedLocales: readonly SupportedLocale[];
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  supportedLocales: SUPPORTED_LOCALES,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

function resolveDeviceLocale(): SupportedLocale {
  const tag = Localization.getLocales()[0]?.languageTag;
  if (!tag) return DEFAULT_LOCALE;
  const lang = tag.split("-")[0]?.toLowerCase();
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
    return lang as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    (i18next.language as SupportedLocale) ?? DEFAULT_LOCALE,
  );

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const stored = await getSecureJson<SupportedLocale>(LOCALE_STORAGE_KEY);
      if (canceled) return;
      const resolvedLocale =
        stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)
          ? stored
          : resolveDeviceLocale();
      if (resolvedLocale !== i18next.language) {
        await i18next.changeLanguage(resolvedLocale);
      }
      if (!canceled) setLocaleState(resolvedLocale);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, []);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    void i18next.changeLanguage(next);
    void setSecureJson(LOCALE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      supportedLocales: SUPPORTED_LOCALES,
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>
      <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}
