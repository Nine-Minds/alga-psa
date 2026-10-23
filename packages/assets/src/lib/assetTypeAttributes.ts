import type { AssetTypeField } from '@alga-psa/types';

/** The six reserved built-in slugs (assets.asset_type values with bespoke UI). */
export const BUILTIN_ASSET_TYPE_SLUGS: readonly string[] = [
  'workstation',
  'network_device',
  'server',
  'mobile_device',
  'printer',
  'unknown',
];

/** The five built-ins backed by a dedicated extension table ('unknown' has none). */
export const EXTENSION_TABLE_BY_ASSET_TYPE: Readonly<Record<string, string>> = {
  workstation: 'workstation_assets',
  network_device: 'network_device_assets',
  server: 'server_assets',
  mobile_device: 'mobile_device_assets',
  printer: 'printer_assets',
};

export function isBuiltinAssetTypeSlug(slug: string): boolean {
  return BUILTIN_ASSET_TYPE_SLUGS.includes(slug);
}

export interface AttributeIssue {
  key: string;
  code: 'required' | 'invalid_value';
  message: string;
}

// LEVERAGE: pattern asset-attribute-coercion — shared by migration preflight and apply.
export function coerceAttributeValue(
  field: AssetTypeField,
  raw: unknown
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const fail = (): { ok: false; reason: string } => ({ ok: false, reason: `is not a ${field.kind}` });
  switch (field.kind) {
    case 'text':
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
        ? { ok: true, value: String(raw).trim() }
        : fail();
    case 'url':
      return typeof raw === 'string' ? { ok: true, value: raw.trim() } : fail();
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : fail();
      if (typeof raw !== 'string' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw.trim())) return fail();
      const value = Number(raw.trim());
      return Number.isFinite(value) ? { ok: true, value } : fail();
    }
    case 'date': {
      if (typeof raw !== 'string') return fail();
      const date = raw.trim();
      const dateOnly = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnly) {
        const [, y, m, d] = dateOnly;
        const parsed = new Date(0);
        parsed.setUTCHours(0, 0, 0, 0);
        parsed.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
        if (parsed.toISOString().slice(0, 10) === date) return { ok: true, value: date };
        return fail();
      }
      const timestamp = date.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/);
      if (!timestamp) return fail();
      const [, year, month, day, hour, minute, second, , zone, , offsetHour, offsetMinute] = timestamp;
      const calendarDate = new Date(0);
      calendarDate.setUTCHours(0, 0, 0, 0);
      calendarDate.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
      if (calendarDate.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return fail();
      if (!Number.isFinite(Date.parse(date))) return fail();
      return { ok: true, value: new Date(date).toISOString().slice(0, 10) };
    }
    case 'select': {
      if (typeof raw !== 'string') return fail();
      const options = field.options ?? [];
      const value = raw.trim();
      if (options.includes(value)) return { ok: true, value };
      const matches = options.filter((option) => option.trim().toLowerCase() === value.toLowerCase());
      return matches.length === 1 ? { ok: true, value: matches[0] } : fail();
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 1 || raw === 0) return { ok: true, value: raw === 1 };
      if (typeof raw !== 'string') return fail();
      const value = raw.trim().toLowerCase();
      if (['true', 'yes', 'y', 't', '1', 'on'].includes(value)) return { ok: true, value: true };
      if (['false', 'no', 'n', 'f', '0', 'off'].includes(value)) return { ok: true, value: false };
      return fail();
    }
    default: return fail();
  }
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function isValidValueForField(field: AssetTypeField, value: unknown): boolean {
  switch (field.kind) {
    case 'text':
    case 'url':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'date':
      return typeof value === 'string' && Number.isFinite(Date.parse(value));
    case 'select':
      return typeof value === 'string' && (field.options ?? []).includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

/**
 * Validates an attributes payload against a custom type's fields_schema.
 * Only schema-declared keys are checked; extra keys (integration namespaces
 * like hudu_fields) are allowed and left untouched.
 *
 * requireAll=true (create): every required field must carry a value.
 * requireAll=false (update/merge): only provided keys are checked — a
 * required field may be omitted (merge keeps the stored value) but cannot
 * be blanked.
 */
export function validateAttributesAgainstSchema(
  fields: AssetTypeField[],
  attributes: Record<string, unknown>,
  opts: { requireAll: boolean }
): AttributeIssue[] {
  const issues: AttributeIssue[] = [];

  for (const field of fields) {
    const provided = Object.prototype.hasOwnProperty.call(attributes, field.key);
    const value = attributes[field.key];
    const present = hasValue(value);

    if (field.required && !present && (opts.requireAll || provided)) {
      issues.push({
        key: field.key,
        code: 'required',
        message: `${field.label} is required`,
      });
      continue;
    }

    if (present && !isValidValueForField(field, value)) {
      issues.push({
        key: field.key,
        code: 'invalid_value',
        message: `${field.label} must be a valid ${field.kind} value`,
      });
    }
  }

  return issues;
}

/** Schema-declared keys with defined values — what a form should submit. */
export function pickSchemaAttributes(
  fields: AssetTypeField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value !== undefined) {
      picked[field.key] = value;
    }
  }
  return picked;
}

export function invalidAssetTypeError(assetType: string): Error {
  return new Error(JSON.stringify({ kind: 'invalid_asset_type', asset_type: assetType }));
}

export function attributeValidationError(issues: AttributeIssue[]): Error {
  return new Error(
    JSON.stringify({
      kind: 'validation',
      issues: issues.map((issue) => ({
        path: ['attributes', issue.key],
        message: issue.message,
        code: issue.code,
      })),
    })
  );
}

/** True for the typed errors above so action catch blocks can rethrow them intact. */
export function isTypedAssetWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  try {
    const parsed = JSON.parse(error.message);
    return parsed?.kind === 'invalid_asset_type' || parsed?.kind === 'validation';
  } catch {
    return false;
  }
}
