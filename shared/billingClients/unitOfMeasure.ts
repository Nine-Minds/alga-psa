export type UnitKind = 'time' | 'count' | 'volume' | 'mass' | 'length' | 'other';

export interface ResolvedUnitOfMeasure {
  code: string;
  label: string;
  labelKey: string;
}

const UNITS: Record<string, Omit<ResolvedUnitOfMeasure, 'code'>> = {
  C62: { label: 'Each', labelKey: 'billing.units.each' },
  HUR: { label: 'Hour', labelKey: 'billing.units.hour' },
  DAY: { label: 'Day', labelKey: 'billing.units.day' },
  WEE: { label: 'Week', labelKey: 'billing.units.week' },
  MON: { label: 'Month', labelKey: 'billing.units.month' },
  ANN: { label: 'Year', labelKey: 'billing.units.year' },
  E34: { label: 'Gigabyte', labelKey: 'billing.units.gigabyte' },
  '4L': { label: 'Terabyte', labelKey: 'billing.units.terabyte' },
  KGM: { label: 'Kilogram', labelKey: 'billing.units.kilogram' },
  MTR: { label: 'Meter', labelKey: 'billing.units.meter' },
};

export function defaultUnitCodeForKind(kind: 'product' | 'fixed' | 'hourly' | 'usage'): string | null {
  if (kind === 'usage') return null;
  return kind === 'hourly' ? 'HUR' : 'C62';
}

export function resolveUnitOfMeasure(input: {
  catalogUnitCode?: string | null;
  configUnitCode?: string | null;
  fallback?: string | null;
  label?: string | null;
}): ResolvedUnitOfMeasure {
  const code = input.catalogUnitCode || input.configUnitCode || input.fallback || 'C62';
  const known = UNITS[code];
  return { code, label: input.label || known?.label || code, labelKey: known?.labelKey || 'billing.units.custom' };
}

export function isUnitOfMeasureCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNITS, code);
}

export function codeForUnitLabel(label?: string | null): string {
  const normalized = label?.trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    each: 'C62', ea: 'C62', unit: 'C62', 'each.': 'C62', hour: 'HUR', hrs: 'HUR', hr: 'HUR',
    day: 'DAY', days: 'DAY', week: 'WEE', weeks: 'WEE', month: 'MON', mon: 'MON',
    year: 'ANN', annum: 'ANN', gb: 'E34', tb: '4L',
  };
  return known[normalized] ?? 'C62';
}

export const unitOfMeasureVocabulary = Object.entries(UNITS).map(([code, unit]) => ({ code, ...unit }));
