/**
 * Purchase cost is stored as `bigint` minor units with an explicit currency
 * (the inventory money convention). These two helpers are the only place the
 * asset surfaces convert between that and what a technician types.
 */

/** "1,234.56" → 123456. Blank or unparseable input returns null ("cleared"). */
export function parseMoneyToMinorUnits(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[\s,]/g, '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
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
