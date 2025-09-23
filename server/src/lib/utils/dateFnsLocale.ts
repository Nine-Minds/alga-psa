import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import { es } from 'date-fns/locale/es';
import { de } from 'date-fns/locale/de';
import { nl } from 'date-fns/locale/nl';
import type { SupportedLocale } from 'server/src/lib/i18n/config';

const DATE_FNS_LOCALES: Record<SupportedLocale, Locale> = {
  en: enUS,
  fr,
  es,
  de,
  nl,
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
