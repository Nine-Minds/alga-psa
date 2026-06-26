import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AssetTypeField,
  AssetTypeFieldKind,
  AssetTypeRegistryEntry,
  CreateAssetTypeInput,
  UpdateAssetTypeInput,
} from '@alga-psa/types';

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

const BUILTIN_ASSET_TYPES: ReadonlyArray<{ slug: string; name: string; display_order: number }> = [
  { slug: 'workstation', name: 'Workstation', display_order: 0 },
  { slug: 'network_device', name: 'Network Device', display_order: 1 },
  { slug: 'server', name: 'Server', display_order: 2 },
  { slug: 'mobile_device', name: 'Mobile Device', display_order: 3 },
  { slug: 'printer', name: 'Printer', display_order: 4 },
  { slug: 'unknown', name: 'Unknown', display_order: 5 },
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

const ok = <T>(value: T): AssetTypeRegistryResult<T> => ({ ok: true, value });
const fail = <T>(error: AssetTypeRegistryError): AssetTypeRegistryResult<T> => ({ ok: false, error });

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

function parseFieldsSchema(value: unknown): AssetTypeField[] {
  if (Array.isArray(value)) return value as AssetTypeField[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as AssetTypeField[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoOrEmpty(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function mapRow(row: any): AssetTypeRegistryEntry {
  return {
    tenant: row.tenant,
    type_id: row.type_id,
    slug: row.slug,
    name: row.name,
    icon: row.icon ?? null,
    fields_schema: parseFieldsSchema(row.fields_schema),
    is_builtin: Boolean(row.is_builtin),
    display_order: Number(row.display_order ?? 0),
    created_at: toIsoOrEmpty(row.created_at),
    updated_at: toIsoOrEmpty(row.updated_at),
  };
}

function tenantScopedTable(knex: Knex, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(knex, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

function builtinAssetTypeEntries(tenant: string): AssetTypeRegistryEntry[] {
  return BUILTIN_ASSET_TYPES.map((type) => ({
    tenant,
    type_id: `builtin_${type.slug}`,
    slug: type.slug,
    name: type.name,
    icon: null,
    fields_schema: [],
    is_builtin: true,
    display_order: type.display_order,
    created_at: '',
    updated_at: '',
  }));
}

function isMissingAssetTypeRegistryTable(error: unknown): boolean {
  const dbError = error as { code?: string; table?: string; message?: string };
  return (
    dbError?.code === '42P01' &&
    (dbError.table === 'asset_type_registry' ||
      dbError.table === undefined ||
      dbError.message?.includes('asset_type_registry') === true)
  );
}

export async function listAssetTypes(knex: Knex, tenant: string): Promise<AssetTypeRegistryEntry[]> {
  try {
    const rows = await tenantScopedTable(knex, tenant, 'asset_type_registry')
      .orderBy('is_builtin', 'desc')
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc');
    return rows.map(mapRow);
  } catch (error) {
    if (isMissingAssetTypeRegistryTable(error)) {
      return builtinAssetTypeEntries(tenant);
    }
    throw error;
  }
}

export async function getAssetTypeBySlug(
  knex: Knex,
  tenant: string,
  slug: string
): Promise<AssetTypeRegistryEntry | null> {
  try {
    const row = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
    return row ? mapRow(row) : null;
  } catch (error) {
    if (isMissingAssetTypeRegistryTable(error)) {
      return builtinAssetTypeEntries(tenant).find((entry) => entry.slug === slug) ?? null;
    }
    throw error;
  }
}

export async function createAssetType(
  knex: Knex,
  tenant: string,
  input: CreateAssetTypeInput
): Promise<AssetTypeRegistryResult<AssetTypeRegistryEntry>> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return fail({ code: 'invalid_name', message: 'Asset type name is required' });
  }

  const validation = validateFieldsSchema(input.fields_schema ?? []);
  if (!validation.valid) {
    return fail({ code: 'invalid_schema', issues: validation.issues });
  }

  const slug = generateAssetTypeSlug(name);
  if (!slug) {
    return fail({ code: 'invalid_name', message: `Asset type name "${name}" does not produce a usable slug` });
  }

  if (RESERVED_ASSET_TYPE_SLUGS.includes(slug)) {
    return fail({ code: 'reserved_slug', slug });
  }

  const existing = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
  if (existing) {
    return fail({ code: 'slug_conflict', slug });
  }

  try {
    await tenantScopedTable(knex, tenant, 'asset_type_registry').insert({
      tenant,
      slug,
      name,
      icon: input.icon ?? null,
      fields_schema: JSON.stringify(validation.fields),
      is_builtin: false,
      display_order: input.display_order ?? 0,
    });
  } catch (error: any) {
    // Unique (tenant, slug) violation raced past the pre-check.
    if (error?.code === '23505') {
      return fail({ code: 'slug_conflict', slug });
    }
    throw error;
  }

  const created = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
  return ok(mapRow(created));
}

export async function updateAssetType(
  knex: Knex,
  tenant: string,
  slug: string,
  input: UpdateAssetTypeInput
): Promise<AssetTypeRegistryResult<AssetTypeRegistryEntry>> {
  const row = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
  if (!row) {
    return fail({ code: 'not_found', slug });
  }

  if (row.is_builtin) {
    const attempted: string[] = [];
    if (input.fields_schema !== undefined) attempted.push('fields_schema');
    if (input.display_order !== undefined) attempted.push('display_order');
    if (attempted.length > 0) {
      return fail({ code: 'builtin_immutable', slug, attempted });
    }
  }

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      return fail({ code: 'invalid_name', message: 'Asset type name is required' });
    }
    patch.name = name;
  }

  if (input.icon !== undefined) {
    patch.icon = input.icon ?? null;
  }

  if (input.fields_schema !== undefined) {
    const validation = validateFieldsSchema(input.fields_schema);
    if (!validation.valid) {
      return fail({ code: 'invalid_schema', issues: validation.issues });
    }
    patch.fields_schema = JSON.stringify(validation.fields);
  }

  if (input.display_order !== undefined) {
    patch.display_order = input.display_order;
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = knex.fn.now();
    await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).update(patch);
  }

  const updated = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
  return ok(mapRow(updated));
}

export async function deleteAssetType(
  knex: Knex,
  tenant: string,
  slug: string
): Promise<AssetTypeRegistryResult<{ slug: string }>> {
  const row = await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).first();
  if (!row) {
    return fail({ code: 'not_found', slug });
  }

  if (row.is_builtin) {
    return fail({ code: 'builtin_undeletable', slug });
  }

  const countRow = await tenantScopedTable(knex, tenant, 'assets')
    .where({ asset_type: slug })
    .count<{ count: string }>('asset_id as count')
    .first();
  const assetCount = Number(countRow?.count ?? 0);
  if (assetCount > 0) {
    return fail({ code: 'in_use', slug, asset_count: assetCount });
  }

  await tenantScopedTable(knex, tenant, 'asset_type_registry').where({ slug }).delete();
  return ok({ slug });
}
