/**
 * Hudu layout fields ↔ asset-type fields_schema (F316/F317, EE-only).
 *
 * Pure mapping seam between a Hudu layout's field definitions and the asset
 * type registry: build a fields_schema for "Create type from this layout",
 * and project a Hudu asset's field values onto a custom type's schema keys
 * at import time. Key derivation and label normalization are the SAME
 * function, so generated types round-trip 1:1 on import.
 *
 * Field-kind mapping (verified live, see plan scratchpad):
 * Text/RichText/AddressData→text, Number→number, Date→date,
 * ListSelect→select (options parsed from the options string), CheckBox→
 * boolean, Website→url; unknown kinds→text; required null→false.
 */

import type { AssetTypeField, AssetTypeFieldKind } from '@alga-psa/types';
import { validateAttributesAgainstSchema } from '@alga-psa/assets/lib/assetTypeAttributes';
import type { HuduAsset, HuduAssetLayoutFieldDef } from './contracts';

const HUDU_FIELD_KIND_MAP: Record<string, AssetTypeFieldKind> = {
  text: 'text',
  richtext: 'text',
  addressdata: 'text',
  number: 'number',
  date: 'date',
  listselect: 'select',
  checkbox: 'boolean',
  website: 'url',
};

const MAX_FIELD_KEY_LENGTH = 63; // assetTypeRegistry FIELD_KEY_PATTERN cap

/**
 * Derive a schema field key from a Hudu label: lowercase, collapse non-alnum
 * runs to '_', trim, prefix non-letter starts, cap at 63 chars. Also the
 * import-time label normalization (F317) — keep the two in lockstep.
 */
export function deriveAssetFieldKey(label: unknown): string {
  const base = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  return (/^[a-z]/.test(base) ? base : `f_${base}`).slice(0, MAX_FIELD_KEY_LENGTH);
}

/**
 * ListSelect options arrive as one string; split on newlines AND commas
 * (both occur in the wild), trim, drop blanks, dedupe preserving order.
 */
export function parseHuduListSelectOptions(options: unknown): string[] {
  const parts = Array.isArray(options)
    ? options.map((option) => String(option ?? ''))
    : typeof options === 'string'
      ? options.split(/[\r\n,]+/)
      : [];
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parsed.push(value);
  }
  return parsed;
}

/**
 * F316: position-ordered fields_schema mirroring a Hudu layout's fields.
 * Blank-label fields are dropped; duplicate derived keys get _2/_3 suffixes;
 * a ListSelect whose options parse empty falls back to a text field.
 */
export function buildFieldsSchemaFromHuduLayout(
  fields: HuduAssetLayoutFieldDef[] | null | undefined
): AssetTypeField[] {
  const sorted = [...(fields ?? [])]
    .filter((field) => field && typeof field === 'object')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const usedKeys = new Set<string>();
  const schema: AssetTypeField[] = [];

  for (const field of sorted) {
    const label = String(field.label ?? '').trim();
    if (!label) continue;

    let key = deriveAssetFieldKey(label);
    if (!key) continue;
    for (let n = 2; usedKeys.has(key); n += 1) {
      const suffix = `_${n}`;
      key = `${deriveAssetFieldKey(label).slice(0, MAX_FIELD_KEY_LENGTH - suffix.length)}${suffix}`;
    }
    usedKeys.add(key);

    const normalizedType = String(field.field_type ?? '').toLowerCase();
    let kind: AssetTypeFieldKind = HUDU_FIELD_KIND_MAP[normalizedType] ?? 'text';
    let options: string[] | undefined;
    if (kind === 'select') {
      options = parseHuduListSelectOptions(field.options);
      if (options.length === 0) {
        kind = 'text'; // optionless ListSelect degrades to text
        options = undefined;
      }
    }

    schema.push({
      key,
      label,
      kind,
      ...(field.required === true ? { required: true } : {}),
      ...(options ? { options } : {}),
    });
  }

  return schema;
}

function hasProjectableValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

const BOOLEAN_TRUE_STRINGS = new Set(['true', 'yes', '1', 'on', 'checked']);
const BOOLEAN_FALSE_STRINGS = new Set(['false', 'no', '0', 'off', 'unchecked']);

/** Best-effort per-kind coercion; un-coercible values pass through (and get skipped by validation). */
function coerceValueForKind(kind: AssetTypeFieldKind, value: unknown): unknown {
  switch (kind) {
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (BOOLEAN_TRUE_STRINGS.has(normalized)) return true;
        if (BOOLEAN_FALSE_STRINGS.has(normalized)) return false;
      }
      return value;
    }
    case 'number': {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        const parsed = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(parsed)) return parsed;
      }
      return value;
    }
    case 'text':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
    // select values and date/url strings are kept as-is.
    default:
      return value;
  }
}

export interface HuduSchemaProjection {
  /** Schema-keyed values that passed validation — safe for createAsset's attributes. */
  attributes: Record<string, unknown>;
  /** Schema keys whose Hudu value failed validation (still visible in hudu_fields). */
  skipped: string[];
}

/**
 * F317: project Hudu field values onto a custom type's schema keys by
 * normalized-label match. Invalid values never fail the import — the key is
 * skipped (reported) and the raw value stays visible in hudu_fields.
 */
export function projectHuduFieldsOntoSchema(
  schema: AssetTypeField[],
  fields: HuduAsset['fields']
): HuduSchemaProjection {
  const valueByKey = new Map<string, unknown>();
  for (const field of [...(fields ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const key = deriveAssetFieldKey(field?.label);
    if (key && !valueByKey.has(key)) {
      valueByKey.set(key, field.value);
    }
  }

  const candidate: Record<string, unknown> = {};
  for (const field of schema) {
    if (!valueByKey.has(field.key)) continue;
    const raw = valueByKey.get(field.key);
    if (!hasProjectableValue(raw)) continue;
    candidate[field.key] = coerceValueForKind(field.kind, raw);
  }

  const issues = validateAttributesAgainstSchema(schema, candidate, { requireAll: false });
  const skipped = issues
    .map((issue) => issue.key)
    .filter((key) => Object.prototype.hasOwnProperty.call(candidate, key));
  for (const key of skipped) {
    delete candidate[key];
  }

  return { attributes: candidate, skipped };
}
