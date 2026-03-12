import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import { DEFAULT_LOCALE, DEFAULT_NS, NAMESPACES, SUPPORTED_LOCALES, type SupportedLocale } from "./config";
import commonEn from "./locales/en/common.json";
import authEn from "./locales/en/auth.json";
import ticketsEn from "./locales/en/tickets.json";
import settingsEn from "./locales/en/settings.json";

function resolveDeviceLocale(): SupportedLocale {
  const tag = Localization.getLocales()[0]?.languageTag;
  if (!tag) return DEFAULT_LOCALE;
  const lang = tag.split("-")[0]?.toLowerCase();
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
    return lang as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    tickets: ticketsEn,
    settings: settingsEn,
  },
} as const;

i18next.use(initReactI18next).init({
  resources,
  lng: resolveDeviceLocale(),
  fallbackLng: "en",
  defaultNS: DEFAULT_NS,
  ns: [...NAMESPACES],
  interpolation: {
    escapeValue: false,
  },
  ...(__DEV__
    ? {
        missingKeyHandler: (_lngs: readonly string[], ns: string, key: string) => {
          console.warn(`[i18n] Missing key: ${ns}:${key}`);
        },
        saveMissing: true,
      }
    : {}),
});

/** Backward-compatible t() export */
export const t: typeof i18next.t = i18next.t.bind(i18next);

export default i18next;
