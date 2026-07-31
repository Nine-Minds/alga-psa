/**
 * Utility functions for formatting values
 */

import { LOCALE_CONFIG } from '@alga-psa/core/i18n/config';

/**
 * System default locale used as the final fallback when a caller does not
 * pass a resolved locale. Prefer threading the recipient/tenant locale from
 * the hierarchical resolver (user -> client -> tenant -> system) and only
 * relying on this constant as a last resort. Intl gracefully handles a plain
 * language code like 'en'.
 */
const DEFAULT_LOCALE = LOCALE_CONFIG.defaultLocale;

/**
 * Format a number as currency
 * @param value The number to format
 * @param locale The locale to use (default: system default locale, currently 'en')
 * @param currency The currency code (default: 'USD')
 * @returns Formatted currency string
 */
export function formatCurrency(
  value: number,
  locale: string = DEFAULT_LOCALE,
  currency: string = 'USD'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Format an amount expressed in a currency's minor units (e.g. cents) using the
 * currency's exponent (e.g. USD=2, JPY=0).
 */
export function formatCurrencyFromMinorUnits(
  minorUnits: number,
  locale: string = DEFAULT_LOCALE,
  currency: string = 'USD'
): string {
  const resolved = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions();
  const fractionDigits = resolved.maximumFractionDigits ?? 2;
  const value = minorUnits / Math.pow(10, fractionDigits);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Format a date as a string
 * @param date The date to format
 * @param locale The locale to use (default: system default locale, currently 'en')
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | string | null | undefined,
  locale: string = DEFAULT_LOCALE
): string {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleDateString(locale);
}

/**
 * Format bytes as human-readable file size
 * @param bytes The number of bytes
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted file size string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
