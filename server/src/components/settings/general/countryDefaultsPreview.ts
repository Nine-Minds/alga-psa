import { format } from 'date-fns';
import type { IClientCountryDefaultsPreview } from '@alga-psa/clients/actions/countryActions';

/**
 * A date whose parts cannot be mistaken for one another, so the example shows
 * the order rather than leaving the reader to guess which 11 is the month.
 */
const SAMPLE_DATE = new Date(2033, 10, 22);

export interface CountryDefaultsCopy {
  /** False when the client carries no usable country — the nudge case. */
  hasCountry: boolean;
  /** date-fns pattern, shown verbatim so 'DD-MM-YYYY' questions have an answer. */
  pattern: string;
  country: string;
  phoneCode: string;
  dateFormat: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The three defaults a client's country settles, as finished sentences. */
export function describeCountryDefaults(
  preview: IClientCountryDefaultsPreview,
  t: Translate,
): CountryDefaultsCopy {
  const pattern = preview.dateFormat.datePattern;

  return {
    hasCountry: Boolean(preview.country),
    pattern,
    country: preview.country
      ? t('general.clients.defaults.country', {
          country: `${preview.country.name} (${preview.country.code})`,
        })
      : t('general.clients.defaults.countryMissing'),
    phoneCode: preview.country?.phone_code
      ? t('general.clients.defaults.phoneCode', { code: preview.country.phone_code })
      : t('general.clients.defaults.phoneCodeMissing'),
    dateFormat: t('general.clients.defaults.dateFormat', {
      pattern,
      example: format(SAMPLE_DATE, pattern),
      clock: t(
        preview.dateFormat.hour12
          ? 'general.clients.defaults.clock12'
          : 'general.clients.defaults.clock24',
      ),
    }),
  };
}
