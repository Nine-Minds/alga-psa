import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import type { SupportedLocale } from 'server/src/lib/i18n/config';

const DATE_FNS_LOCALES: Record<SupportedLocale, Locale> = {
  en: enUS,
  fr,
};

export function getDateFnsLocale(language?: string): Locale {
  if (language) {
    const normalized = language.split('-')[0] as SupportedLocale;
    if (normalized in DATE_FNS_LOCALES) {
      return DATE_FNS_LOCALES[normalized];
    }
  }

  return enUS;
}
