import { currencyFractionDigits, fromMinorUnits, toMinorUnits } from '@alga-psa/core';

/**
 * Catalog rates, product costs and invoice amounts are all stored in the currency's own
 * minor units, which the renderer and the invoice lists scale by that currency's exponent
 * (USD 2, JPY 0, KWD 3). A price editor that assumes hundredths therefore banks ¥50 as
 * 5000 and bills ¥5,000. These helpers keep an editor's text and its stored minor units
 * on the row's own currency.
 */

/** Stored minor units → editable major-unit text with the currency's digit count. */
export function minorUnitsToRateText(minorUnits: number, currency: string): string {
  return fromMinorUnits(Number(minorUnits) || 0, undefined, currency)
    .toFixed(currencyFractionDigits(currency));
}

/** Typed major-unit text (or number) → the currency's own minor units. */
export function rateTextToMinorUnits(value: string | number, currency: string): number {
  const major = typeof value === 'number' ? value : parseFloat(value);
  return toMinorUnits(Number.isFinite(major) ? major : 0, undefined, currency);
}

/**
 * Re-scale a stored rate when an editor row switches currency, so the operator keeps the
 * amount they typed (50 stays 50) instead of inheriting the old currency's minor units.
 */
export function rescaleRateToCurrency(minorUnits: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return Number(minorUnits) || 0;
  return rateTextToMinorUnits(fromMinorUnits(Number(minorUnits) || 0, undefined, fromCurrency), toCurrency);
}

/** `step` for a major-unit money input: whole units on a zero-decimal currency. */
export function rateInputStep(currency: string): string {
  const digits = currencyFractionDigits(currency);
  return digits === 0 ? '1' : fromMinorUnits(1, undefined, currency).toFixed(digits);
}
