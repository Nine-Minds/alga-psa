/**
 * Coded unit-of-measure vocabulary (UN/ECE Recommendation 20) and the single
 * resolver every billing/catalog reader uses.
 *
 * Storage model: a row carries `unit_code` (Rec 20 code, the machine value) and
 * `unit_of_measure` (the display label snapshot). Several business labels can
 * share one code (seat/license/device/user/kit are all `C62`), so the label is
 * never derived from the code alone when a label is present.
 *
 * This module is pure (no DB access) because the web picker and the mobile app
 * import it. Tenant custom-unit registration lives in `tenantUnitsOfMeasure.ts`.
 */
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

/** Rec 20 "one" — the default code for products, fixed services, and custom units (D1/D3/D5). */
export const DEFAULT_UNIT_CODE = 'C62';
/** Rec 20 "hour" — the default code for hourly services (D2). */
export const HOUR_UNIT_CODE = 'HUR';

// Canonical Rec 20 vocabulary used by the API, picker, and migration seed
// (server/migrations/20260927100000_create_units_of_measure_vocabulary.cjs).
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

/**
 * Known free-text variants → vocabulary key. Used by the write path, the
 * resolver, and (mirrored as SQL) the backfill migration
 * server/migrations/20260927110000_add_unit_codes_and_backfill.cjs — keep the
 * two in sync; `unitOfMeasure.test.ts` asserts parity.
 */
export const UNIT_LABEL_VARIANTS: Readonly<Record<string, string>> = {
  each: 'each', ea: 'each', 'each.': 'each', unit: 'each', units: 'each', one: 'each',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  box: 'box', boxes: 'box', bx: 'box',
  seat: 'seat', seats: 'seat',
  license: 'license', licenses: 'license', licence: 'license', licences: 'license',
  device: 'device', devices: 'device',
  user: 'user', users: 'user',
  kit: 'kit', kits: 'kit',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour',
  day: 'day', days: 'day',
  week: 'week', weeks: 'week', wk: 'week', wks: 'week',
  month: 'month', months: 'month', mon: 'month', mo: 'month', mos: 'month',
  year: 'year', years: 'year', yr: 'year', yrs: 'year', annum: 'year',
  minute: 'minute', minutes: 'minute', min: 'minute', mins: 'minute',
  gb: 'gigabyte', gigabyte: 'gigabyte', gigabytes: 'gigabyte',
  tb: 'terabyte', terabyte: 'terabyte', terabytes: 'terabyte',
  liter: 'liter', liters: 'liter', litre: 'liter', litres: 'liter',
  kg: 'kilogram', kilogram: 'kilogram', kilograms: 'kilogram',
  meter: 'meter', meters: 'meter', metre: 'meter', metres: 'meter',
};
const byKey = new Map(unitOfMeasureVocabulary.map((unit) => [unit.key, unit]));

/** The vocabulary entry a free-text label denotes, or null for custom labels. */
export function vocabularyUnitForLabel(label?: string | null): UnitOfMeasure | null {
  const key = label ? UNIT_LABEL_VARIANTS[label.trim().toLowerCase()] : undefined;
  return key ? byKey.get(key) ?? null : null;
}

export function knownUnitCodeForLabel(label?: string | null): string | null {
  return vocabularyUnitForLabel(label)?.code ?? null;
}

export type UnitDefaultKind = 'product' | 'fixed' | 'hourly' | 'usage';
/** D1–D3: product/fixed → C62, hourly → HUR, usage → none (operator must choose). */
export function defaultUnitCodeForKind(kind: UnitDefaultKind): string | null {
  if (kind === 'usage') return null;
  return kind === 'hourly' ? HOUR_UNIT_CODE : DEFAULT_UNIT_CODE;
}

/** Default `{ code, label }` for a new catalog item, or null when a unit must be chosen. */
export function defaultUnitForKind(kind: UnitDefaultKind): { code: string; label: string } | null {
  const code = defaultUnitCodeForKind(kind);
  return code ? { code, label: labelForUnitCode(code) } : null;
}

export function isUnitOfMeasureCode(code: string): boolean { return REC20_CODES.includes(code); }
export function labelForUnitCode(code: string): string {
  return byCode.get(code)?.label ?? byCode.get(DEFAULT_UNIT_CODE)!.label;
}

/**
 * The code to persist for a label when the caller supplied no explicit code:
 * a known variant maps to its code; any other non-empty label is a tenant
 * custom unit coded C62 (D5). Returns null for an empty label.
 */
export function unitCodeForLabel(label?: string | null, explicitCode?: string | null): string | null {
  if (explicitCode) return explicitCode;
  if (!label?.trim()) return null;
  return knownUnitCodeForLabel(label) ?? DEFAULT_UNIT_CODE;
}

export interface UnitSource { code?: string | null; label?: string | null }

function hasUnit(source?: UnitSource | null): source is UnitSource {
  return Boolean(source && (source.code || source.label?.trim()));
}

/**
 * Resolve the unit for a billable line. Precedence (D4): catalog unit first,
 * usage-config unit second, then `fallback` code, then C62.
 *
 * A source may carry only a label (legacy rows): its code is derived from the
 * label. A custom label (not in the vocabulary) keeps its own text for
 * label/plural/short so descriptions read "12 Seats"-style, never "units".
 */
export function resolveUnitOfMeasure(input: {
  catalog?: UnitSource | null; config?: UnitSource | null; fallback?: string | null;
}): UnitOfMeasure {
  const selected = hasUnit(input.catalog) ? input.catalog : hasUnit(input.config) ? input.config : null;
  const label = selected?.label?.trim() || null;
  const code = selected?.code || unitCodeForLabel(label) || input.fallback || DEFAULT_UNIT_CODE;
  const named = vocabularyUnitForLabel(label);
  if (named && named.code === code) return named;
  const base = byCode.get(code) ?? byCode.get(DEFAULT_UNIT_CODE)!;
  if (!label || label.toLowerCase() === base.label.toLowerCase()) return { ...base, code };
  return { ...base, code, label, pluralLabel: label, shortLabel: label };
}

/**
 * Write-path guard for any row carrying the label/code pair (usage configs,
 * template usage configs, preset services, quote items): fills `unit_code`
 * from the label when the caller did not supply one, so the two columns never
 * drift. Rows that don't touch the unit pass through unchanged.
 */
export function withUnitCode<T extends { unit_of_measure?: string | null; unit_code?: string | null }>(row: T): T {
  if (row.unit_of_measure === undefined && row.unit_code === undefined) return row;
  return { ...row, unit_code: unitCodeForLabel(row.unit_of_measure, row.unit_code) };
}
