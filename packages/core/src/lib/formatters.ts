/**
 * Utility functions for formatting values
 */

/**
 * Format a number as currency
 * @param value The number to format
 * @param locale The locale to use (default: 'en-US')
 * @param currency The currency code (default: 'USD')
 * @returns Formatted currency string
 */
export function formatCurrency(value: number, locale: string = 'en-US', currency: string = 'USD'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format an amount expressed in a currency's minor units (e.g. cents) using the
 * currency's exponent (e.g. USD=2, JPY=0).
 */
export function formatCurrencyFromMinorUnits(
  minorUnits: number,
  locale: string = 'en-US',
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
 * The number of minor-unit fraction digits a currency uses (USD=2, JPY=0, some=3),
 * derived from `Intl.NumberFormat` so it stays correct without a hand-kept table.
 */
export function currencyFractionDigits(currency: string = 'USD', locale: string = 'en-US'): number {
  const resolved = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions();
  return resolved.maximumFractionDigits ?? 2;
}

/**
 * Convert a major-unit amount (e.g. dollars) to the currency's integer minor units
 * (e.g. cents), using the currency's own exponent — so JPY multiplies by 1, not 100.
 * The inverse of {@link formatCurrencyFromMinorUnits}; replaces hardcoded `× 100`.
 */
export function toMinorUnits(value: number, locale: string = 'en-US', currency: string = 'USD'): number {
  return Math.round(value * Math.pow(10, currencyFractionDigits(currency, locale)));
}

/**
 * Format a date as a string
 * @param date The date to format
 * @param locale The locale to use (default: 'en-US')
 * @returns Formatted date string
 */
export function formatDate(date: Date | string | null | undefined, locale: string = 'en-US'): string {
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

  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Placeholder values stamped on client_locations rows whose real address is
// unknown (tenant provisioning, the company→location migration). Storage keeps
// them to satisfy NOT NULL constraints; rendered addresses must omit them.
export const ADDRESS_PLACEHOLDER = 'N/A';
export const COUNTRY_CODE_PLACEHOLDER = 'XX';
export const COUNTRY_NAME_PLACEHOLDER = 'Unknown';

/** Address field for display: trimmed, with the 'N/A' placeholder blanked. */
export function displayAddressField(value?: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === ADDRESS_PLACEHOLDER ? '' : trimmed;
}

/** Country for display: empty when only the XX/Unknown placeholder is stored. */
export function displayCountry(countryName?: unknown, countryCode?: unknown): string {
  const name = typeof countryName === 'string' ? countryName.trim() : '';
  const code = typeof countryCode === 'string' ? countryCode.trim() : '';
  if (name === COUNTRY_NAME_PLACEHOLDER || code.toUpperCase() === COUNTRY_CODE_PLACEHOLDER) {
    return '';
  }
  return name || code;
}

