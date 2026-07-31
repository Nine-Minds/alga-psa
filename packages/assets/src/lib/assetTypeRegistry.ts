import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AssetTypeField,
  AssetTypeRegistryEntry,
  CreateAssetTypeInput,
  UpdateAssetTypeInput,
} from '@alga-psa/types';
import {
  RESERVED_ASSET_TYPE_SLUGS,
  validateFieldsSchema,
  generateAssetTypeSlug,
  type AssetTypeRegistryError,
  type AssetTypeRegistryResult,
} from './assetTypeSchema';

// Re-export the client-safe schema helpers (constants, types, validateFieldsSchema,
// generateAssetTypeSlug) so existing server importers can keep importing them from
// this module. Client components must import them from './assetTypeSchema' directly
// to avoid pulling the server-only `@alga-psa/db` barrel into the browser bundle.
export * from './assetTypeSchema';

const BUILTIN_ASSET_TYPES: ReadonlyArray<{ slug: string; name: string; display_order: number }> = [
  { slug: 'workstation', name: 'Workstation', display_order: 0 },
  { slug: 'network_device', name: 'Network Device', display_order: 1 },
  { slug: 'server', name: 'Server', display_order: 2 },
  { slug: 'mobile_device', name: 'Mobile Device', display_order: 3 },
  { slug: 'printer', name: 'Printer', display_order: 4 },
  { slug: 'unknown', name: 'Unknown', display_order: 5 },
];

const ok = <T>(value: T): AssetTypeRegistryResult<T> => ({ ok: true, value });
const fail = <T>(error: AssetTypeRegistryError): AssetTypeRegistryResult<T> => ({ ok: false, error });

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
