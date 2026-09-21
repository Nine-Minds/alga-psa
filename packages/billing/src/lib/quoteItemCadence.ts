/**
 * One cadence vocabulary for quote line items.
 *
 * The view-model adapter, the editor draft summary and the PDF label
 * localization all need to answer the same question — "which cadence band does
 * this row belong to?" — and to order those bands the same way. Keeping the
 * mapping here (rather than re-deriving it per consumer) is what makes the
 * editor summary and the rendered PDF agree on mixed-cadence quotes.
 *
 * The canonical mapping itself lives in `cadenceVocabulary`, shared with the
 * contract service-period materializers so quotes and contracts speak the same
 * cadence language.
 */

import {
  CADENCE_ANNUALLY,
  CADENCE_MONTHLY,
  CADENCE_QUARTERLY,
  CADENCE_SEMI_ANNUALLY,
  normalizeCadenceBillingCycle,
} from './cadenceVocabulary';

export type QuoteCadenceKey = string;

export type QuoteCadenceItem = {
  is_recurring?: boolean | null;
  billing_frequency?: string | null;
};

export const QUOTE_CADENCE_MONTHLY = CADENCE_MONTHLY;
export const QUOTE_CADENCE_QUARTERLY = CADENCE_QUARTERLY;
export const QUOTE_CADENCE_SEMI_ANNUALLY = CADENCE_SEMI_ANNUALLY;
export const QUOTE_CADENCE_ANNUALLY = CADENCE_ANNUALLY;
export const QUOTE_CADENCE_ONE_TIME = 'onetime';

/** Recurring cadences in display order; one-time always sorts last. */
export const RECURRING_CADENCE_ORDER: readonly string[] = [
  QUOTE_CADENCE_MONTHLY,
  QUOTE_CADENCE_QUARTERLY,
  QUOTE_CADENCE_SEMI_ANNUALLY,
  QUOTE_CADENCE_ANNUALLY,
];

/**
 * Normalize a raw `billing_frequency` to its canonical cadence key, or null
 * when it is blank/unrecognized. Recurring rows with a blank value default to
 * monthly at the call site; an unrecognized value is returned as-is so it can
 * claim its own band rather than silently joining monthly.
 */
export function normalizeQuoteCadenceBillingFrequency(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return normalizeCadenceBillingCycle(raw) ?? raw;
}

/**
 * Canonical cadence key for a line item. One-time rows are always `onetime`;
 * recurring rows use their normalized `billing_frequency`, defaulting to
 * `monthly` when the frequency is null/blank (matching the editor default).
 */
export function resolveCadenceKey(item: QuoteCadenceItem): string {
  if (!item.is_recurring) return QUOTE_CADENCE_ONE_TIME;
  return normalizeQuoteCadenceBillingFrequency(item.billing_frequency) ?? QUOTE_CADENCE_MONTHLY;
}

const cadenceOrderIndex = (key: string): number => {
  const canonicalIndex = RECURRING_CADENCE_ORDER.indexOf(key);
  if (canonicalIndex >= 0) return canonicalIndex;
  if (key === QUOTE_CADENCE_ONE_TIME) return Number.MAX_SAFE_INTEGER;
  return RECURRING_CADENCE_ORDER.length; // other recurring: after known, before one-time
};

/**
 * Display-order comparator for cadence keys:
 * monthly → quarterly → semi-annually → annually → other recurring (alpha) →
 * one-time last.
 */
export function compareCadenceKeys(left: string, right: string): number {
  const leftIndex = cadenceOrderIndex(left);
  const rightIndex = cadenceOrderIndex(right);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return left.localeCompare(right);
}

/** True for every cadence except the trailing one-time band. */
export const isRecurringCadenceKey = (key: string): boolean => key !== QUOTE_CADENCE_ONE_TIME;

/** i18n key for a known cadence band; unknown keys have no translation. */
export const CADENCE_LABEL_KEYS: Record<string, string> = {
  [QUOTE_CADENCE_MONTHLY]: 'labels.cadence.monthly',
  [QUOTE_CADENCE_QUARTERLY]: 'labels.cadence.quarterly',
  [QUOTE_CADENCE_SEMI_ANNUALLY]: 'labels.cadence.semiAnnually',
  [QUOTE_CADENCE_ANNUALLY]: 'labels.cadence.annually',
  [QUOTE_CADENCE_ONE_TIME]: 'labels.cadence.oneTime',
};

export const cadenceI18nKey = (key: string): string | null => CADENCE_LABEL_KEYS[key] ?? null;

/** English fallback band label (used when no locale is resolved). */
export function cadenceDefaultName(key: string): string {
  switch (key) {
    case QUOTE_CADENCE_MONTHLY:
      return 'Monthly';
    case QUOTE_CADENCE_QUARTERLY:
      return 'Quarterly';
    case QUOTE_CADENCE_SEMI_ANNUALLY:
      return 'Semi-annually';
    case QUOTE_CADENCE_ANNUALLY:
      return 'Annually';
    case QUOTE_CADENCE_ONE_TIME:
      return 'One-time';
    default:
      return key
        .split(/[\s_-]+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}
