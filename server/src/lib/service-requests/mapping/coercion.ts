import type {
  MappingCoercionResult,
  MappingFieldDataType,
  MappingValidationResult,
} from './types';

/**
 * Coercion + validation primitives shared by every destination provider. Each
 * target field declares its `dataType`, `coerce` and `validate`; these helpers
 * implement the common cases so providers only spell out their allowlists.
 */

export function coerceToString(raw: unknown): MappingCoercionResult {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'Value is empty' };
  }
  if (typeof raw === 'string') {
    return { ok: true, value: raw };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { ok: true, value: String(raw) };
  }
  if (typeof raw === 'boolean') {
    return { ok: true, value: String(raw) };
  }
  return { ok: false, error: 'Value must be text' };
}

export function coerceToNumber(raw: unknown): MappingCoercionResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, error: 'Value must be a finite number' };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, error: 'Value must be a number' };
  }
  return { ok: false, error: 'Value must be a number' };
}

export function coerceToBoolean(raw: unknown): MappingCoercionResult {
  if (typeof raw === 'boolean') {
    return { ok: true, value: raw };
  }
  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true, value: true };
    if (raw === 0) return { ok: true, value: false };
    return { ok: false, error: 'Value must be true or false' };
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return { ok: true, value: true };
    if (['false', 'no', '0', 'off'].includes(normalized)) return { ok: true, value: false };
  }
  return { ok: false, error: 'Value must be true or false' };
}

export function coerceToDate(raw: unknown): MappingCoercionResult {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime())
      ? { ok: false, error: 'Value must be a date' }
      : { ok: true, value: raw.toISOString() };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? { ok: false, error: 'Value must be a date' }
      : { ok: true, value: parsed.toISOString() };
  }
  return { ok: false, error: 'Value must be a date' };
}

export function alwaysValid(): MappingValidationResult {
  return { ok: true };
}

export function validateEnum(values: string[]): (value: unknown) => MappingValidationResult {
  const allowed = new Set(values);
  return (value: unknown) => {
    if (typeof value !== 'string' || !allowed.has(value)) {
      return { ok: false, error: `Value must be one of: ${values.join(', ')}` };
    }
    return { ok: true };
  };
}

/** Structural equality used to detect converging replays (skipped_no_change). */
export function mappingValuesEqual(dataType: MappingFieldDataType, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }
  switch (dataType) {
    case 'number': {
      const left = Number(a);
      const right = Number(b);
      return Number.isFinite(left) && Number.isFinite(right) && left === right;
    }
    case 'boolean':
      return Boolean(a) === Boolean(b);
    case 'date': {
      const left = new Date(a as string);
      const right = new Date(b as string);
      if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
        return false;
      }
      return left.getTime() === right.getTime();
    }
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}
