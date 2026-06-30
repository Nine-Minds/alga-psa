// Client-safe asset-type schema helpers: constants, types, and pure validation.
// Deliberately free of any `@alga-psa/db` (knex/secrets/vault) import so client
// components (AssetTypesManager, AssetTypeSchemaEditor) can use validation and
// slug helpers without dragging the server-only db barrel into the browser
// bundle. The server-only registry operations live in `./assetTypeRegistry`,
// which re-exports everything here for existing server importers.
import type { AssetTypeField, AssetTypeFieldKind } from '@alga-psa/types';

export const ASSET_TYPE_FIELD_KINDS: readonly AssetTypeFieldKind[] = [
  'text',
  'number',
  'date',
  'select',
  'url',
  'boolean',
];

export const RESERVED_ASSET_TYPE_SLUGS: readonly string[] = [
  'workstation',
  'network_device',
  'server',
  'mobile_device',
  'printer',
  'unknown',
];

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export type FieldSchemaIssueCode =
  | 'invalid_field'
  | 'invalid_key'
  | 'duplicate_key'
  | 'missing_label'
  | 'invalid_kind'
  | 'invalid_required'
  | 'missing_options'
  | 'invalid_options';

export interface FieldSchemaIssue {
  index: number;
  key?: string;
  code: FieldSchemaIssueCode;
  message: string;
}

// A flat shape (not a discriminated union) so `fields` and `issues` are always
// present: ee/server typechecks this module under tsconfig strict:false, where
// the false branch of a boolean-discriminated union does not narrow. `issues` is
// empty when valid; `fields` holds the parsed fields (best-effort when invalid).
export interface FieldsSchemaValidationResult {
  valid: boolean;
  fields: AssetTypeField[];
  issues: FieldSchemaIssue[];
}

export type AssetTypeRegistryError =
  | { code: 'invalid_name'; message: string }
  | { code: 'invalid_schema'; issues: FieldSchemaIssue[] }
  | { code: 'reserved_slug'; slug: string }
  | { code: 'slug_conflict'; slug: string }
  | { code: 'not_found'; slug: string }
  | { code: 'builtin_immutable'; slug: string; attempted: string[] }
  | { code: 'builtin_undeletable'; slug: string }
  | { code: 'in_use'; slug: string; asset_count: number };

export type AssetTypeRegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AssetTypeRegistryError };

export function validateFieldsSchema(input: unknown): FieldsSchemaValidationResult {
  if (!Array.isArray(input)) {
    return {
      valid: false,
      fields: [],
      issues: [{ index: -1, code: 'invalid_field', message: 'fields_schema must be an array' }],
    };
  }

  const issues: FieldSchemaIssue[] = [];
  const seenKeys = new Set<string>();
  const fields: AssetTypeField[] = [];

  input.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push({ index, code: 'invalid_field', message: `Field at index ${index} must be an object` });
      return;
    }

    const field = raw as Record<string, unknown>;
    const key = field.key;
    const keyLabel = typeof key === 'string' ? key : undefined;

    if (typeof key !== 'string' || !FIELD_KEY_PATTERN.test(key)) {
      issues.push({
        index,
        key: keyLabel,
        code: 'invalid_key',
        message: `Field key must match ${FIELD_KEY_PATTERN} (lowercase letter start, then lowercase letters, digits, underscores; max 63 chars)`,
      });
    } else if (seenKeys.has(key)) {
      issues.push({ index, key, code: 'duplicate_key', message: `Duplicate field key "${key}"` });
    } else {
      seenKeys.add(key);
    }

    if (typeof field.label !== 'string' || field.label.trim().length === 0) {
      issues.push({ index, key: keyLabel, code: 'missing_label', message: 'Field label is required' });
    }

    const kind = field.kind;
    const isValidKind = typeof kind === 'string' && (ASSET_TYPE_FIELD_KINDS as readonly string[]).includes(kind);
    if (!isValidKind) {
      issues.push({
        index,
        key: keyLabel,
        code: 'invalid_kind',
        message: `Field kind must be one of: ${ASSET_TYPE_FIELD_KINDS.join(', ')}`,
      });
    }

    if (field.required !== undefined && typeof field.required !== 'boolean') {
      issues.push({ index, key: keyLabel, code: 'invalid_required', message: 'Field "required" must be a boolean' });
    }

    if (kind === 'select') {
      const options = field.options;
      if (!Array.isArray(options) || options.length === 0) {
        issues.push({ index, key: keyLabel, code: 'missing_options', message: 'Select fields require a non-empty options array' });
      } else if (options.some((option) => typeof option !== 'string' || option.trim().length === 0)) {
        issues.push({ index, key: keyLabel, code: 'invalid_options', message: 'Select options must be non-empty strings' });
      }
    } else if (field.options !== undefined) {
      issues.push({ index, key: keyLabel, code: 'invalid_options', message: 'Only select fields may declare options' });
    }

    fields.push({
      key: typeof key === 'string' ? key : '',
      label: typeof field.label === 'string' ? field.label : '',
      kind: (isValidKind ? kind : 'text') as AssetTypeFieldKind,
      ...(field.required !== undefined ? { required: Boolean(field.required) } : {}),
      ...(kind === 'select' && Array.isArray(field.options) ? { options: field.options as string[] } : {}),
    });
  });

  return { valid: issues.length === 0, fields, issues };
}

export function generateAssetTypeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  // Slugs must start with a letter to satisfy consumers (e.g. the Hudu layout
  // map's /^[a-z][a-z0-9_]*$/); prefix digit-leading names like "3CX" -> "t_3cx",
  // mirroring deriveAssetFieldKey's f_ prefix.
  return /^[a-z]/.test(base) ? base : `t_${base}`;
}
