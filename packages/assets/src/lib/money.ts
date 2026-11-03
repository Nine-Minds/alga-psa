/**
 * Purchase cost is stored as `bigint` minor units with an explicit currency
 * (the inventory money convention). These two helpers are the only place the
 * asset surfaces convert between that and what a technician types.
 */

/**
 * "1,234.56" and "1.234,56" → 123456. Blank or unparseable input returns null
 * ("cleared"), and a negative amount clamps to zero — a device does not cost
 * minus four hundred pounds.
 *
 * The separator is read from the value rather than assumed: stripping commas
 * turned the European "1.234,56" into 1.23, so a four-figure laptop was saved
 * as one pound twenty-three.
 */
export function parseMoneyToMinorUnits(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  const digitsAndSeparators = raw.replace(/[^0-9.,]/g, '');
  if (!digitsAndSeparators) return null;

  const lastComma = digitsAndSeparators.lastIndexOf(',');
  const lastDot = digitsAndSeparators.lastIndexOf('.');
  const commaCount = (digitsAndSeparators.match(/,/g) ?? []).length;

  let decimalIndex = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal point.
    decimalIndex = Math.max(lastComma, lastDot);
  } else if (lastDot >= 0) {
    // A dot has always been the decimal point here; several dots are groups.
    decimalIndex = (digitsAndSeparators.match(/\./g) ?? []).length === 1 ? lastDot : -1;
  } else if (lastComma >= 0) {
    // One comma followed by exactly three digits is a thousands group
    // ("1,234"); anything else is a decimal comma ("12,50").
    const isGroup = commaCount > 1 || digitsAndSeparators.length - lastComma - 1 === 3;
    decimalIndex = isGroup ? -1 : lastComma;
  }

  const normalized = decimalIndex >= 0
    ? `${digitsAndSeparators.slice(0, decimalIndex).replace(/[.,]/g, '')}.${digitsAndSeparators.slice(decimalIndex + 1).replace(/[.,]/g, '')}`
    : digitsAndSeparators.replace(/[.,]/g, '');

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  // A device does not cost minus four hundred: a typed negative reads as zero.
  if (/-/.test(raw)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

/** 123456 → "1234.56", the editable form of the stored value. */
export function minorUnitsToInputValue(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return '';
  const numeric = Number(minorUnits);
  if (!Number.isFinite(numeric)) return '';
  return (numeric / 100).toFixed(2);
}

/** 123456 + 'USD' → "$1,234.56" for read-only surfaces. */
export function formatMinorUnits(
  minorUnits: number | null | undefined,
  currency: string | null | undefined,
  locale?: string
): string | null {
  if (minorUnits === null || minorUnits === undefined) return null;
  const numeric = Number(minorUnits);
  if (!Number.isFinite(numeric)) return null;
  const amount = numeric / 100;
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
  } catch {
    // Unknown currency code: show the amount with the code alongside it.
    return `${amount.toFixed(2)} ${code}`;
  }
}
