import type { Knex } from 'knex';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import { getAssetTypeBySlug } from './assetTypeRegistry';
import {
  invalidAssetTypeError,
  isBuiltinAssetTypeSlug,
  validateAttributesAgainstSchema,
  type AttributeIssue,
} from './assetTypeAttributes';

// F310: asset_type must be one of the six built-ins or a tenant registry slug.
// Returns the registry entry for both built-in and custom schemas.
export async function resolveWritableAssetType(
  knex: Knex,
  tenant: string,
  assetType: string
): Promise<AssetTypeRegistryEntry | null> {
  const entry = await getAssetTypeBySlug(knex, tenant, assetType);
  if (entry) return entry;
  if (isBuiltinAssetTypeSlug(assetType)) return null;
  throw invalidAssetTypeError(assetType);
}

export async function resolveAttributeSchemaForWrite(
  knex: Knex,
  tenant: string,
  input: { nextAssetType?: string; storedAssetType?: string; attributesProvided: boolean }
): Promise<AssetTypeRegistryEntry | null> {
  if (input.nextAssetType !== undefined) return resolveWritableAssetType(knex, tenant, input.nextAssetType);
  if (!input.attributesProvided || !input.storedAssetType) return null;
  return getAssetTypeBySlug(knex, tenant, input.storedAssetType);
}

export function validateAttributesForWrite(
  entry: AssetTypeRegistryEntry | null,
  attributes: Record<string, unknown> | undefined,
  mode: 'create' | 'merge',
  opts?: { requireCustomAttributes?: boolean }
): AttributeIssue[] {
  if (!entry) return [];
  return validateAttributesAgainstSchema(entry.fields_schema, attributes ?? {}, {
    requireAll: mode === 'create' && opts?.requireCustomAttributes !== false,
  });
}

export function attributesMergeExpression(
  knex: Knex | Knex.Transaction,
  attributes: Record<string, unknown>
): Knex.Raw {
  return knex.raw(`coalesce(attributes, '{}'::jsonb) || ?::jsonb`, JSON.stringify(attributes));
}

export function serializeAttributesForInsert(attributes: Record<string, unknown>): string {
  return JSON.stringify(attributes);
}
