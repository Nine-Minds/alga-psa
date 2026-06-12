/**
 * Hudu asset attributes namespace (F252/F253, EE-only).
 *
 * Import and sync copy a Hudu asset's custom `fields[]` into the Alga asset's
 * `attributes` jsonb under Hudu-owned keys (`hudu_fields` + `hudu_synced_at`),
 * merged via `coalesce(attributes,'{}'::jsonb) || …` so sibling namespaces
 * survive. The copy is wholesale and read-only: position-ordered label/value
 * pairs, no per-field mapping.
 */

import type { Knex } from 'knex';
import type { HuduAsset } from './contracts';

export interface HuduFieldAttribute {
  label: string;
  value: unknown;
}

/** F252: position-ordered [{label, value}] projection of a Hudu fields[]. */
export function buildHuduFieldsAttribute(fields: HuduAsset['fields']): HuduFieldAttribute[] {
  return [...(fields ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((field) => ({ label: field.label, value: field.value ?? null }));
}

function toLabelValueArray(value: unknown): HuduFieldAttribute[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return { label: row.label as string, value: row.value ?? null };
  });
}

/**
 * F253: label/value array inequality (order-sensitive — position is meaning).
 * A row that never carried hudu_fields only counts as changed when Hudu now
 * has fields to copy.
 */
export function huduFieldsChanged(current: unknown, next: HuduFieldAttribute[]): boolean {
  const normalized = toLabelValueArray(current);
  if (normalized === null) {
    return next.length > 0;
  }
  return JSON.stringify(normalized) !== JSON.stringify(next);
}

/** F252/F253: merge the Hudu namespace into assets.attributes, preserving sibling keys. */
export async function writeHuduAssetAttributes(
  knex: Knex,
  tenant: string,
  assetId: string,
  fields: HuduFieldAttribute[],
  syncedAt: string
): Promise<number> {
  return knex('assets')
    .where({ tenant, asset_id: assetId })
    .update({
      attributes: knex.raw(
        `coalesce(attributes, '{}'::jsonb) || ?::jsonb`,
        JSON.stringify({ hudu_fields: fields, hudu_synced_at: syncedAt })
      ),
    });
}
