export type UnitKind = 'time' | 'count' | 'volume' | 'mass' | 'length' | 'other';
export interface UnitOfMeasure {
  /** Stable UI identity; multiple business labels may share a Rec 20 code. */
  key: string;
  code: string;
  label: string;
  labelKey: string;
  kind: UnitKind;
  pluralLabel: string;
  shortLabel: string;
}

// Canonical Rec 20 vocabulary used by the API, picker, and migration seed.
// Seat/license/device/user/kit are business labels without a distinct Rec 20
// unit, so they retain distinct stable keys while mapping to C62.
export const unitOfMeasureVocabulary: readonly UnitOfMeasure[] = [
  { key: 'each', code: 'C62', label: 'Each', labelKey: 'unitOfMeasure.labels.each', kind: 'count', pluralLabel: 'units', shortLabel: 'units' },
  { key: 'piece', code: 'H87', label: 'Piece', labelKey: 'unitOfMeasure.labels.piece', kind: 'count', pluralLabel: 'pieces', shortLabel: 'pc' },
  { key: 'box', code: 'BX', label: 'Box', labelKey: 'unitOfMeasure.labels.box', kind: 'count', pluralLabel: 'boxes', shortLabel: 'bx' },
  { key: 'seat', code: 'C62', label: 'Seat', labelKey: 'unitOfMeasure.labels.seat', kind: 'count', pluralLabel: 'seats', shortLabel: 'seats' },
  { key: 'license', code: 'C62', label: 'License', labelKey: 'unitOfMeasure.labels.license', kind: 'count', pluralLabel: 'licenses', shortLabel: 'licenses' },
  { key: 'device', code: 'C62', label: 'Device', labelKey: 'unitOfMeasure.labels.device', kind: 'count', pluralLabel: 'devices', shortLabel: 'devices' },
  { key: 'user', code: 'C62', label: 'User', labelKey: 'unitOfMeasure.labels.user', kind: 'count', pluralLabel: 'users', shortLabel: 'users' },
  { key: 'kit', code: 'C62', label: 'Kit', labelKey: 'unitOfMeasure.labels.kit', kind: 'count', pluralLabel: 'kits', shortLabel: 'kits' },
  { key: 'hour', code: 'HUR', label: 'Hour', labelKey: 'unitOfMeasure.labels.hour', kind: 'time', pluralLabel: 'hours', shortLabel: 'hrs' },
  { key: 'day', code: 'DAY', label: 'Day', labelKey: 'unitOfMeasure.labels.day', kind: 'time', pluralLabel: 'days', shortLabel: 'days' },
  { key: 'week', code: 'WEE', label: 'Week', labelKey: 'unitOfMeasure.labels.week', kind: 'time', pluralLabel: 'weeks', shortLabel: 'wks' },
  { key: 'month', code: 'MON', label: 'Month', labelKey: 'unitOfMeasure.labels.month', kind: 'time', pluralLabel: 'months', shortLabel: 'mos' },
  { key: 'year', code: 'ANN', label: 'Year', labelKey: 'unitOfMeasure.labels.year', kind: 'time', pluralLabel: 'years', shortLabel: 'yrs' },
  { key: 'minute', code: 'MIN', label: 'Minute', labelKey: 'unitOfMeasure.labels.minute', kind: 'time', pluralLabel: 'minutes', shortLabel: 'mins' },
  { key: 'gigabyte', code: 'E34', label: 'Gigabyte', labelKey: 'unitOfMeasure.labels.gigabyte', kind: 'volume', pluralLabel: 'gigabytes', shortLabel: 'GB' },
  { key: 'terabyte', code: '4L', label: 'Terabyte', labelKey: 'unitOfMeasure.labels.terabyte', kind: 'volume', pluralLabel: 'terabytes', shortLabel: 'TB' },
  { key: 'liter', code: 'LTR', label: 'Liter', labelKey: 'unitOfMeasure.labels.liter', kind: 'volume', pluralLabel: 'liters', shortLabel: 'L' },
  { key: 'kilogram', code: 'KGM', label: 'Kilogram', labelKey: 'unitOfMeasure.labels.kilogram', kind: 'mass', pluralLabel: 'kilograms', shortLabel: 'kg' },
  { key: 'meter', code: 'MTR', label: 'Meter', labelKey: 'unitOfMeasure.labels.meter', kind: 'length', pluralLabel: 'meters', shortLabel: 'm' },
] as const;

export const REC20_CODES = [...new Set(unitOfMeasureVocabulary.map((unit) => unit.code))] as readonly string[];
const byCode = new Map<string, UnitOfMeasure>();
for (const unit of unitOfMeasureVocabulary) if (!byCode.has(unit.code)) byCode.set(unit.code, unit);
export function defaultUnitCodeForKind(kind: 'product' | 'fixed' | 'hourly' | 'usage'): string | null {
  if (kind === 'usage') return null;
  return kind === 'hourly' ? 'HUR' : 'C62';
}
export interface UnitSource { code?: string | null; label?: string | null }
export function resolveUnitOfMeasure(input: {
  catalog?: UnitSource | null; config?: UnitSource | null; fallback?: string | null;
}): UnitOfMeasure {
  const selected = input.catalog?.code ? input.catalog : input.config?.code ? input.config : null;
  const code = selected?.code ?? input.fallback ?? 'C62';
  const unit = byCode.get(code) ?? unitOfMeasureVocabulary[0];
  return { ...unit, code, label: selected?.label || unit.label };
}
export function isUnitOfMeasureCode(code: string): boolean { return REC20_CODES.includes(code); }
export function labelForUnitCode(code: string): string {
  return unitOfMeasureVocabulary.find((unit) => unit.code === code)?.label ?? 'Each';
}
const LABEL_CODES: Record<string, string> = {
  each: 'C62', ea: 'C62', unit: 'C62', 'each.': 'C62', piece: 'H87', pc: 'H87', box: 'BX',
  hour: 'HUR', hours: 'HUR', hrs: 'HUR', hr: 'HUR', day: 'DAY', days: 'DAY', week: 'WEE', weeks: 'WEE',
  month: 'MON', mon: 'MON', year: 'ANN', annum: 'ANN', minute: 'MIN', min: 'MIN', gb: 'E34', tb: '4L',
  liter: 'LTR', litre: 'LTR', kg: 'KGM', kilogram: 'KGM', meter: 'MTR', metre: 'MTR',
};
export function knownUnitCodeForLabel(label?: string | null): string | null {
  return label ? LABEL_CODES[label.trim().toLowerCase()] ?? null : null;
}
