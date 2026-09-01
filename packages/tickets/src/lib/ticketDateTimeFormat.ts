import { formatDistanceToNow } from 'date-fns';
import { formatDateTime } from '@alga-psa/core';
import { getDateFnsLocale } from '@alga-psa/ui/lib/dateFnsLocale';

/**
 * Intl equivalents of the locale-sensitive ticketing date/time patterns.
 *
 * The tenant setting stores a date-fns pattern, but the settings screen
 * previews each choice with Intl in the app locale. Rendering the stored
 * pattern literally makes every ticket surface disagree with that preview:
 * "Aug 22, 2025 1:23 PM" under a preview promising "22 août 2025 13:23".
 * The two purely numeric choices ('yyyy-MM-dd HH:mm', 'dd/MM/yyyy HH:mm') are
 * deliberately fixed — their previews are literal too — so they stay on
 * date-fns and fall through this map untouched.
 */
const INTL_EQUIVALENTS: Record<string, Intl.DateTimeFormatOptions> = {
  'MMM d, yyyy h:mm a': {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  'MM/dd/yyyy h:mm a': {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  'EEE, MMM d, yyyy h:mm a': {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
};

/** Format a ticket timestamp with the tenant's chosen pattern, in the app locale. */
export function formatTicketDateTime(
  value: Date | string,
  pattern: string,
  locale: string,
  timeZone: string,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }

  const intlOptions = INTL_EQUIVALENTS[pattern];
  if (intlOptions) {
    return new Intl.DateTimeFormat(locale, { ...intlOptions, timeZone }).format(date);
  }

  return formatDateTime(date, timeZone, pattern);
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
