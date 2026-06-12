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
