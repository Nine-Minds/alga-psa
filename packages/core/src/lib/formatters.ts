/**
 * Utility functions for formatting values
 */
import { CURRENCY_OPTIONS } from '../constants/currency';

/** Shared ISO currency metadata, including currencies outside the usual picker shortlist. */
export function supportedCurrencyCodes(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('currency') ?? [...CURRENCY_OPTIONS.map(option => option.value), 'BHD'];
}

export function isSupportedCurrency(code: string): boolean {
  return supportedCurrencyCodes().includes(code);
}

export type MoneyInputErrorCode = 'currency' | 'negative' | 'precision' | 'invalid' | 'overflow';

export class MoneyInputError extends Error {
  constructor(public readonly code: MoneyInputErrorCode) {
    super(code);
    this.name = 'MoneyInputError';
  }
}

function moneyLocale(locale: string): string {
  return locale === 'xx' || locale === 'yy' ? 'en' : locale;
}

function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(moneyLocale(locale)).formatToParts(1.1)
    .find(part => part.type === 'decimal')?.value ?? '.';
}

/** Strict, ungrouped decimal text to minor units. Never round a user's input. */
export function decimalTextToMinorUnits(text: string, currency: string, locale = 'en'): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!isSupportedCurrency(currency)) throw new MoneyInputError('currency');
  if (value.startsWith('-')) throw new MoneyInputError('negative');
  const separator = decimalSeparator(locale);
  const parts = value.split(separator);
  if (parts.length > 2 || !parts.every(part => /^\d+$/.test(part))) throw new MoneyInputError('invalid');
  const digits = currencyFractionDigits(currency, moneyLocale(locale));
  if (parts.length === 2 && (digits === 0 || parts[1].length > digits)) throw new MoneyInputError('precision');
  // Bound the input before constructing a BigInt, including arbitrarily long leading zeros.
  const integer = parts[0].replace(/^0+(?=\d)/, '');
  if (integer.length > 16) throw new MoneyInputError('overflow');
  const minor = BigInt(integer + (parts[1] ?? '').padEnd(digits, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyInputError('overflow');
  return Number(minor);
}

function exactMinorUnits(value: number | string): bigint {
  if ((typeof value === 'string' && !/^\d+$/.test(value)) ||
      (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) {
    throw new MoneyInputError('invalid');
  }
  const minor = BigInt(value);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyInputError('overflow');
  return minor;
}

/** Exact editable major-unit text, including values at MAX_SAFE_INTEGER minor units. */
export function minorUnitsToDecimalText(value: number | string, currency: string, locale = 'en'): string {
  if (!isSupportedCurrency(currency)) throw new MoneyInputError('currency');
  const digits = currencyFractionDigits(currency, moneyLocale(locale));
  const text = exactMinorUnits(value).toString().padStart(digits + 1, '0');
  return digits ? text.slice(0, -digits) + decimalSeparator(locale) + text.slice(-digits) : text;
}

/** Currency-code display without dividing a potentially maximum-safe number. */
export function formatExactCurrencyFromMinorUnits(value: number | string, currency: string, locale = 'en'): string {
  if (!isSupportedCurrency(currency)) throw new MoneyInputError('currency');
  const digits = currencyFractionDigits(currency, moneyLocale(locale));
  const minor = exactMinorUnits(value);
  const scale = 10n ** BigInt(digits);
  const fraction = (minor % scale).toString().padStart(digits, '0');
  return new Intl.NumberFormat(moneyLocale(locale), {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).formatToParts(minor / scale).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

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
