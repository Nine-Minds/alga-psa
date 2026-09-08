import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { enAU } from 'date-fns/locale/en-AU';
import { fr } from 'date-fns/locale/fr';
import { es } from 'date-fns/locale/es';
import { de } from 'date-fns/locale/de';
import { nl } from 'date-fns/locale/nl';
import { it } from 'date-fns/locale/it';
import { pl } from 'date-fns/locale/pl';
import { pt } from 'date-fns/locale/pt';
import type { SupportedLocale } from './i18n/config';

const DATE_FNS_LOCALES: Record<SupportedLocale, Locale> = {
  en: enUS,
  'en-AU': enAU,
  fr,
  es,
  de,
  nl,
  it,
  pl,
  pt,
  xx: enUS,
  yy: enUS,
};

/**
 * Map the app's active locale to the date-fns locale used for 'P'-style
 * formatting. Region-tagged locales must match on the FULL tag first — an
 * `en-AU` split to `en` would silently render US month/day order — and only
 * fall back to the language code for region tags we do not ship.
 */
export function getDateFnsLocale(language?: string): Locale {
  if (language) {
    if (language in DATE_FNS_LOCALES) {
      return DATE_FNS_LOCALES[language as SupportedLocale];
    }
    const normalized = language.split('-')[0] as SupportedLocale;
    if (normalized in DATE_FNS_LOCALES) {
      return DATE_FNS_LOCALES[normalized];
    }
  }

  return enUS;
}
