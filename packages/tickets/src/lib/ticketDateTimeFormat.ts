import { formatDistanceToNow } from 'date-fns';
import type { CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { formatDateValue } from '@alga-psa/ui/lib/i18n/formatDateValue';
import { getDateFnsLocale } from '@alga-psa/ui/lib/dateFnsLocale';

/**
 * A ticket timestamp, in the tenant's country shape and the app's language.
 *
 * What used to live here — a map from a stored date-fns pattern to its Intl
 * equivalent, so ticket surfaces would not disagree with the settings preview —
 * has moved into formatDateValue, which now owns the "country orders the
 * digits, language names the months" split for every surface. The tenant no
 * longer chooses a pattern at all; the only thing left to choose is whether the
 * weekday is written, and that is a name, so the language supplies it.
 */
export function formatTicketDateTime(
  value: Date | string,
  locale: string,
  timeZone: string,
  dateFormat?: CountryDateFormat,
  showWeekday = false,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }

  return formatDateValue(
    date,
    locale,
    {
      ...(showWeekday ? { weekday: 'short' as const } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    },
    dateFormat,
  );
}

/**
 * Relative age of a ticket timestamp ("about 1 month ago") in the app locale.
 * date-fns defaults to English and to no suffix, so the caller used to append
 * a hardcoded " ago" that no other language wants.
 */
export function formatTicketRelativeToNow(value: Date | string, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return formatDistanceToNow(date, { addSuffix: true, locale: getDateFnsLocale(locale) });
}
