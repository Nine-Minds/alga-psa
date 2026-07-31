/**
 * Hudu asset↔Alga asset mapping persistence (F211, EE-only).
 *
 * Sibling of companyMapping.ts on the SHARED CE table
 * `tenant_external_entity_mappings` (`integration_type='hudu'`,
 * `alga_entity_type='asset'`). One-to-one per tenant, both directions;
 * replace is explicit clear+set only.
 *
 * IMPORTANT: idx_unique_external_mapping is NOT scoped by alga_entity_type, so
 * a Hudu asset id that numerically equals a mapped Hudu company id would
 * collide with the Phase 1 client mapping row. Asset rows therefore carry
 * `external_realm_id = String(hudu company id)` (client rows use null),
 * keeping the external unique index disjoint between the two entity types.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { HUDU_INTEGRATION_TYPE, HUDU_MAPPING_TABLE } from './contracts';
import { HUDU_MAPPING_SYNC_STATUS } from './companyMapping';

export const HUDU_ASSET_MAPPING_ENTITY_TYPE = 'asset' as const;

export interface HuduAssetMappingMetadata {
  hudu_asset_name?: string | null;
  hudu_company_id?: string | number | null;
  asset_layout_id?: number | null;
  asset_layout_name?: string | null;
  primary_serial?: string | null;
  url?: string | null;
  stale?: boolean;
}

export interface HuduAssetMappingRow {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  last_synced_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export type HuduAssetMappingErrorCode =
  | 'asset_already_mapped'
  | 'hudu_asset_already_mapped'
  | 'mapping_conflict'
  | 'not_found';

export type HuduAssetMappingWriteResult =
  | { ok: true; mapping: HuduAssetMappingRow }
  | { ok: false; code: HuduAssetMappingErrorCode; message: string };

export interface SetHuduAssetMappingInput {
  assetId: string;
  huduAssetId: string | number;
  huduCompanyId: string | number;
  metadata?: HuduAssetMappingMetadata;
}

const huduAssetMappingScope = {
  integration_type: HUDU_INTEGRATION_TYPE,
  alga_entity_type: HUDU_ASSET_MAPPING_ENTITY_TYPE,
};

/**
 * Create a mapping row. Rejects (typed) when the Alga asset OR the Hudu asset
 * is already mapped for this tenant — replace requires an explicit clear first.
 */
export async function setHuduAssetMappingRow(
  knex: Knex,
  tenant: string,
  input: SetHuduAssetMappingInput
): Promise<HuduAssetMappingWriteResult> {
  const externalId = String(input.huduAssetId);
  const db = tenantDb(knex, tenant);

  const assetTaken = await db.table(HUDU_MAPPING_TABLE)
    .where({ ...huduAssetMappingScope, alga_entity_id: input.assetId })
    .first('id', 'external_entity_id');
  if (assetTaken) {
    return {
      ok: false,
      code: 'asset_already_mapped',
      message: `Asset is already mapped to Hudu asset ${assetTaken.external_entity_id}. Clear that mapping first.`,
    };
  }

  const huduAssetTaken = await db.table(HUDU_MAPPING_TABLE)
    .where({ ...huduAssetMappingScope, external_entity_id: externalId })
    .first('id', 'alga_entity_id');
  if (huduAssetTaken) {
    return {
      ok: false,
      code: 'hudu_asset_already_mapped',
      message: `Hudu asset ${externalId} is already mapped to another asset. Clear that mapping first.`,
    };
  }

  try {
    const [row] = await db.table(HUDU_MAPPING_TABLE)
      .insert({
        tenant,
        ...huduAssetMappingScope,
        alga_entity_id: input.assetId,
        external_entity_id: externalId,
        external_realm_id: String(input.huduCompanyId),
        sync_status: HUDU_MAPPING_SYNC_STATUS,
        metadata: JSON.stringify({
          hudu_asset_name: input.metadata?.hudu_asset_name ?? null,
          hudu_company_id: String(input.huduCompanyId),
          asset_layout_id: input.metadata?.asset_layout_id ?? null,
          asset_layout_name: input.metadata?.asset_layout_name ?? null,
          primary_serial: input.metadata?.primary_serial ?? null,
          url: input.metadata?.url ?? null,
          stale: input.metadata?.stale ?? false,
        }),
      })
      .returning('*');
    return { ok: true, mapping: row as HuduAssetMappingRow };
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return {
        ok: false,
        code: 'mapping_conflict',
        message: 'This asset or Hudu asset was just mapped by someone else. Refresh and try again.',
      };
    }
    throw error;
  }
}

export interface ClearHuduAssetMappingRef {
  mappingId?: string;
  huduAssetId?: string | number;
}

/** Delete a mapping row by mapping id or by Hudu asset id. Returns rows cleared. */
export async function clearHuduAssetMappingRow(
  knex: Knex,
  tenant: string,
  ref: ClearHuduAssetMappingRef
): Promise<number> {
  if (!ref.mappingId && ref.huduAssetId === undefined) {
    throw new Error('clearHuduAssetMappingRow requires mappingId or huduAssetId');
  }

  const query = tenantDb(knex, tenant).table(HUDU_MAPPING_TABLE).where(huduAssetMappingScope);
  if (ref.mappingId) {
    query.andWhere({ id: ref.mappingId });
  } else {
    query.andWhere({ external_entity_id: String(ref.huduAssetId) });
  }
  return query.del();
}

export interface GetHuduAssetMappingRowsFilter {
  /** Restrict to one Hudu company's assets (rows carry it as external_realm_id). */
  huduCompanyId?: string | number;
}

/** The tenant's Hudu asset mappings, with the mapped asset's name joined on. */
export async function getHuduAssetMappingRows(
  knex: Knex,
  tenant: string,
  filter: GetHuduAssetMappingRowsFilter = {}
): Promise<Array<HuduAssetMappingRow & { asset_name: string | null }>> {
  const db = tenantDb(knex, tenant);
  const query = db.table(`${HUDU_MAPPING_TABLE} as m`);
  db.tenantJoin(query, 'assets as a', 'a.tenant', 'm.tenant', {
    type: 'left',
    on(join) {
      join.andOn(knex.raw('a.asset_id::text = m.alga_entity_id'));
    },
  });
  query
    .where({
      'm.integration_type': HUDU_INTEGRATION_TYPE,
      'm.alga_entity_type': HUDU_ASSET_MAPPING_ENTITY_TYPE,
    })
    .select('m.*', 'a.name as asset_name');
  if (filter.huduCompanyId !== undefined) {
    query.andWhere({ 'm.external_realm_id': String(filter.huduCompanyId) });
  }
  return query;
}

export interface HuduAssetMappingStaleRef {
  mappingId?: string;
  huduAssetId?: string | number;
}

/** Merge `stale` into a mapping row's metadata (other keys preserved). Returns rows updated. */
export async function setHuduAssetMappingStale(
  knex: Knex,
  tenant: string,
  ref: HuduAssetMappingStaleRef,
  stale: boolean
): Promise<number> {
  if (!ref.mappingId && ref.huduAssetId === undefined) {
    throw new Error('setHuduAssetMappingStale requires mappingId or huduAssetId');
  }

  const query = tenantDb(knex, tenant).table(HUDU_MAPPING_TABLE).where(huduAssetMappingScope);
  if (ref.mappingId) {
    query.andWhere({ id: ref.mappingId });
  } else {
    query.andWhere({ external_entity_id: String(ref.huduAssetId) });
  }
  return query.update({
    metadata: knex.raw(`coalesce(metadata, '{}'::jsonb) || ?::jsonb`, JSON.stringify({ stale })),
  });
}

/** Stamp last_synced_at on the given mapping rows. Returns rows updated. */
export async function touchHuduAssetMappingsSynced(
  knex: Knex,
  tenant: string,
  mappingIds: string[],
  at: Date | string = new Date()
): Promise<number> {
  if (mappingIds.length === 0) {
    return 0;
  }
  return tenantDb(knex, tenant).table(HUDU_MAPPING_TABLE)
    .where(huduAssetMappingScope)
    .whereIn('id', mappingIds)
    .update({ last_synced_at: at });
}

// ============ Resolvers ============

export async function resolveAlgaAssetIdForHuduAsset(
  knex: Knex,
  tenant: string,
  huduAssetId: string | number
): Promise<string | null> {
  const row = await tenantDb(knex, tenant).table(HUDU_MAPPING_TABLE)
    .where({ ...huduAssetMappingScope, external_entity_id: String(huduAssetId) })
    .first('alga_entity_id');
  return row?.alga_entity_id ?? null;
}

export async function resolveHuduAssetIdForAlgaAsset(
  knex: Knex,
  tenant: string,
  assetId: string
): Promise<string | null> {
  const row = await tenantDb(knex, tenant).table(HUDU_MAPPING_TABLE)
    .where({ ...huduAssetMappingScope, alga_entity_id: assetId })
    .first('external_entity_id');
  return row?.external_entity_id ?? null;
}
