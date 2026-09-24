import type { Knex } from 'knex';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import { getAssetTypeBySlug } from './assetTypeRegistry';
import {
  invalidAssetTypeError,
  isBuiltinAssetTypeSlug,
  validateAttributesAgainstSchema,
  type AttributeIssue,
} from './assetTypeAttributes';

export async function resolveWritableAssetType(
  knex: Knex,
  tenant: string,
  assetType: string
): Promise<AssetTypeRegistryEntry | null> {
  if (isBuiltinAssetTypeSlug(assetType)) return null;
  const entry = await getAssetTypeBySlug(knex, tenant, assetType);
  if (!entry) throw invalidAssetTypeError(assetType);
  return entry.is_builtin ? null : entry;
}

export async function resolveAttributeSchemaForWrite(
  knex: Knex,
  tenant: string,
  input: { nextAssetType?: string; storedAssetType?: string; attributesProvided: boolean }
): Promise<AssetTypeRegistryEntry | null> {
  if (input.nextAssetType !== undefined) return resolveWritableAssetType(knex, tenant, input.nextAssetType);
  if (!input.attributesProvided || !input.storedAssetType || isBuiltinAssetTypeSlug(input.storedAssetType)) return null;
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
