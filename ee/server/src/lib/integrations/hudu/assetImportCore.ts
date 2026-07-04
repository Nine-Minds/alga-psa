/**
 * Hudu asset-import core (EE-only, session-free).
 *
 * The import logic behind huduAssetImportActions.ts, lifted out of the
 * `'use server'` action file so it can also run from the tenant-wide sync core
 * (runHuduTenantSync) in a background job with no session. Asset writes go
 * through the actor-injectable createAssetRecord/deleteAssetRecord services
 * (the withAuth createAsset needs a session the daily job doesn't have); the
 * caller supplies the actor user id (clicking admin, or resolved audit user).
 *
 * // LEVERAGE: friction hudu-import-core — this logic was only reachable via
 * // 'use server', so the daily auto-sync couldn't reuse it.
 */

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { createAssetRecord, deleteAssetRecord } from '@alga-psa/assets/actions/assetActions';
import { listAssetTypes } from '@alga-psa/assets/lib/assetTypeRegistry';
import { fetchHuduCompanyAssets } from './huduDataCore';
import type { HuduCompanyDataResult, HuduLinkedItem } from './huduDataCore';
import type { HuduErrorKind } from './huduClient';
import type { HuduAsset } from './contracts';
import {
  getHuduAssetLayoutTypeMap,
  isLayoutExcluded,
  resolveAssetTypeForLayout,
} from './assetLayoutMap';
import { projectHuduFieldsOntoSchema } from './layoutFieldSchema';
import { suggestHuduAssetMappings } from './assetMatching';
import type { AlgaMatcherAsset } from './assetMatching';
import {
  getHuduAssetMappingRows,
  resolveAlgaAssetIdForHuduAsset,
  setHuduAssetMappingRow,
} from './assetMapping';
import type { HuduAssetMappingWriteResult } from './assetMapping';
import { deriveHuduAssetTag, huduImportAssetStatus } from './assetImport';
import { buildHuduFieldsAttribute } from './assetAttributes';

export type HuduAssetImportErrorCode =
  | 'client_not_mapped'
  | 'hudu_asset_not_found'
  | 'hudu_asset_already_mapped'
  | 'layout_excluded'
  | 'serial_conflict'
  | 'fetch_failed'
  | 'rate_limited'
  | 'create_failed'
  | 'mapping_failed';

export interface HuduAssetImportFailure {
  success: false;
  error: string;
  code?: HuduAssetImportErrorCode;
  errorKind?: HuduErrorKind;
  /** mapping_failed: the asset created right before the mapping write failed. */
  orphanAssetId?: string;
  orphanCleanedUp?: boolean;
  /** serial_conflict: the tenant asset already carrying the serial (F261). */
  existing_asset_id?: string;
  existing_asset_name?: string;
  existing_client_id?: string;
}

export type HuduAssetImportResult =
  | {
      success: true;
      data: {
        asset_id: string;
        mapping_id: string;
        asset_tag: string;
        asset_type: string;
        status: string;
        projection_skipped?: string[];
      };
    }
  | HuduAssetImportFailure;

export interface HuduAssetBulkImportSummary {
  created: number;
  skipped: number;
  failed: Array<{
    huduAssetId: number;
    error: string;
    code?: HuduAssetImportErrorCode;
    existing_asset_name?: string;
  }>;
}

export type HuduAssetBulkImportResult =
  | { success: true; data: HuduAssetBulkImportSummary }
  | {
      success: false;
      error: string;
      code?: HuduAssetImportErrorCode;
      errorKind?: HuduErrorKind;
      partial: HuduAssetBulkImportSummary;
    };

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fetchFailure(
  result: Exclude<HuduCompanyDataResult<HuduAsset>, { state: 'ok' }>
): HuduAssetImportFailure {
  if (result.state === 'unmapped') {
    return { success: false, error: 'Client is not mapped to a Hudu company.', code: 'client_not_mapped' };
  }
  const error = result.state === 'error' ? result.error : result.state;
  const errorKind = result.state === 'error' ? result.errorKind : undefined;
  return {
    success: false,
    error,
    code: errorKind === 'rate_limited' ? 'rate_limited' : 'fetch_failed',
    ...(errorKind ? { errorKind } : {}),
  };
}

async function cleanUpOrphanAsset(
  knex: Knex,
  tenant: string,
  actorUserId: string,
  assetId: string
): Promise<boolean> {
  try {
    const result = await deleteAssetRecord(knex, tenant, actorUserId, assetId, { suppressRevalidate: true });
    return result?.success === true;
  } catch {
    return false;
  }
}

/**
 * F261: tenant-wide lookup for an existing asset already carrying the Hudu
 * asset's serial (trimmed, case-insensitive). Blank serials never conflict.
 */
async function findSerialConflict(
  knex: Knex,
  tenant: string,
  primarySerial: string | null | undefined
): Promise<{ asset_id: string; name: string; client_id: string | null } | null> {
  const serial = (primarySerial ?? '').trim();
  if (!serial) {
    return null;
  }
  const existing = await knex('assets')
    .where({ tenant })
    .whereRaw('lower(trim(serial_number)) = ?', [serial.toLowerCase()])
    .first('asset_id', 'name', 'client_id');
  return existing ?? null;
}

/**
 * Single-asset import core. Fetches via the Phase 1 cached path (session-free),
 * so bulk callers mostly hit the server cache per item — and a mid-batch 429
 * surfaces here as a typed rate_limited failure (F218). Asset creation goes
 * through createAssetRecord with the supplied actor.
 */
export async function importHuduAssetCore(
  tenant: string,
  actorUserId: string,
  clientId: string,
  huduAssetId: string | number
): Promise<HuduAssetImportResult> {
  const assetsResult = await fetchHuduCompanyAssets(tenant, clientId);
  if (assetsResult.state !== 'ok') {
    return fetchFailure(assetsResult);
  }

  const huduAsset = (assetsResult.items as Array<HuduLinkedItem<HuduAsset>>).find(
    (a) => String(a.id) === String(huduAssetId)
  );
  if (!huduAsset) {
    return {
      success: false,
      error: `Hudu asset ${huduAssetId} was not found for this company.`,
      code: 'hudu_asset_not_found',
    };
  }

  const { knex } = await createTenantKnex(tenant);

  const mappedAssetId = await resolveAlgaAssetIdForHuduAsset(knex, tenant, huduAsset.id);
  if (mappedAssetId) {
    return {
      success: false,
      error: `Hudu asset ${huduAsset.id} is already mapped to an asset. Clear that mapping first.`,
      code: 'hudu_asset_already_mapped',
    };
  }

  const layoutMap = await getHuduAssetLayoutTypeMap(knex, tenant);
  // F258: excluded layouts fail typed before any serial/tag work (FR8).
  if (huduAsset.asset_layout_id != null && isLayoutExcluded(layoutMap, huduAsset.asset_layout_id)) {
    return {
      success: false,
      error: `Hudu asset ${huduAsset.id} belongs to a layout marked "Don't import".`,
      code: 'layout_excluded',
    };
  }

  // F261: a tenant-wide serial collision fails typed before anything is created.
  const serialConflict = await findSerialConflict(knex, tenant, huduAsset.primary_serial);
  if (serialConflict) {
    return {
      success: false,
      error: `An asset with serial number "${(huduAsset.primary_serial ?? '').trim()}" already exists: "${serialConflict.name}".`,
      code: 'serial_conflict',
      existing_asset_id: serialConflict.asset_id,
      existing_asset_name: serialConflict.name,
      ...(serialConflict.client_id ? { existing_client_id: serialConflict.client_id } : {}),
    };
  }

  // F315/F317: a configured custom slug only resolves when it's still in the
  // tenant's registry; a custom target additionally gets the Hudu field values
  // projected onto its fields_schema keys.
  const registryTypes = await listAssetTypes(knex, tenant);
  const assetType =
    huduAsset.asset_layout_id != null
      ? resolveAssetTypeForLayout(
          layoutMap,
          huduAsset.asset_layout_id,
          new Set(registryTypes.map((type) => type.slug))
        )
      : 'unknown';
  const customType = registryTypes.find((type) => type.slug === assetType && !type.is_builtin);
  const projection = customType
    ? projectHuduFieldsOntoSchema(customType.fields_schema, huduAsset.fields)
    : { attributes: {}, skipped: [] };

  const assetTag = await deriveHuduAssetTag(knex, tenant, {
    huduAssetId: huduAsset.id,
    primarySerial: huduAsset.primary_serial,
  });
  const status = huduImportAssetStatus();

  let createdAssetId: string;
  try {
    const created = await createAssetRecord(
      knex,
      tenant,
      actorUserId,
      {
        asset_type: assetType,
        client_id: clientId,
        asset_tag: assetTag,
        name: huduAsset.name,
        status,
        serial_number: huduAsset.primary_serial ?? undefined,
        attributes: {
          ...projection.attributes,
          hudu_fields: buildHuduFieldsAttribute(huduAsset.fields),
          hudu_synced_at: new Date().toISOString(),
        },
      },
      { requireCustomAttributes: false }
    );
    createdAssetId = created.asset_id;
  } catch (error) {
    return { success: false, error: toErrorMessage(error), code: 'create_failed' };
  }

  let mappingError: string;
  try {
    const mappingResult = await setHuduAssetMappingRow(knex, tenant, {
      assetId: createdAssetId,
      huduAssetId: huduAsset.id,
      huduCompanyId: assetsResult.huduCompanyId,
      metadata: {
        hudu_asset_name: huduAsset.name,
        asset_layout_id: huduAsset.asset_layout_id ?? null,
        asset_layout_name: huduAsset.asset_type ?? null,
        primary_serial: huduAsset.primary_serial ?? null,
        url: huduAsset.hudu_url ?? huduAsset.url ?? null,
      },
    });
    if (mappingResult.ok) {
      return {
        success: true,
        data: {
          asset_id: createdAssetId,
          mapping_id: mappingResult.mapping.id,
          asset_tag: assetTag,
          asset_type: assetType,
          status,
          ...(projection.skipped.length > 0 ? { projection_skipped: projection.skipped } : {}),
        },
      };
    }
    mappingError = (mappingResult as Extract<HuduAssetMappingWriteResult, { ok: false }>).message;
  } catch (error) {
    mappingError = toErrorMessage(error);
  }

  const cleanedUp = await cleanUpOrphanAsset(knex, tenant, actorUserId, createdAssetId);
  return {
    success: false,
    error: cleanedUp
      ? `Mapping failed after asset creation; the created asset ${createdAssetId} was removed. ${mappingError}`
      : `Mapping failed after asset creation; asset ${createdAssetId} was created but is not mapped. ${mappingError}`,
    code: 'mapping_failed',
    orphanAssetId: createdAssetId,
    orphanCleanedUp: cleanedUp,
  };
}

/**
 * F217/F218: import every plain-unmatched Hudu asset (no mapping row, no
 * suggestion) for one mapped client, sequentially. Excluded-layout assets are
 * skipped (counted, F258). Per-item failures are isolated; a rate-limited Hudu
 * fetch stops the batch with the partial summary.
 */
export async function importUnmatchedHuduAssetsCore(
  tenant: string,
  actorUserId: string,
  clientId: string
): Promise<HuduAssetBulkImportResult> {
  const summary: HuduAssetBulkImportSummary = { created: 0, skipped: 0, failed: [] };

  const result = await fetchHuduCompanyAssets(tenant, clientId);
  if (result.state !== 'ok') {
    const failure = fetchFailure(result);
    return { ...failure, partial: summary };
  }

  const huduAssets = result.items as Array<HuduLinkedItem<HuduAsset>>;
  const { knex } = await createTenantKnex(tenant);

  const mappingRows = await getHuduAssetMappingRows(knex, tenant, {
    huduCompanyId: result.huduCompanyId,
  });
  const mappedHuduAssetIds = new Set(mappingRows.map((m) => m.external_entity_id));

  const algaAssets: AlgaMatcherAsset[] = await knex('assets')
    .where({ tenant, client_id: clientId })
    .select('asset_id', 'name as asset_name', 'serial_number');
  const suggestions = suggestHuduAssetMappings(
    huduAssets,
    algaAssets,
    mappingRows.map((m) => ({ asset_id: m.alga_entity_id, hudu_asset_id: m.external_entity_id }))
  );

  const unmatched = huduAssets.filter(
    (asset) => !mappedHuduAssetIds.has(String(asset.id)) && !suggestions.has(asset.id)
  );

  const layoutMap = await getHuduAssetLayoutTypeMap(knex, tenant);
  const importable = unmatched.filter(
    (asset) => !(asset.asset_layout_id != null && isLayoutExcluded(layoutMap, asset.asset_layout_id))
  );
  summary.skipped = unmatched.length - importable.length;

  for (const asset of importable) {
    const importResult = await importHuduAssetCore(tenant, actorUserId, clientId, asset.id);
    if (importResult.success) {
      summary.created += 1;
      continue;
    }
    const failure = importResult as HuduAssetImportFailure;
    if (failure.code === 'rate_limited') {
      logger.warn('[HuduAssetImportCore] bulk import stopped on rate limit', {
        tenant,
        clientId,
        created: summary.created,
        skipped: summary.skipped,
        failed: summary.failed.length,
      });
      return {
        success: false,
        error: failure.error,
        code: 'rate_limited',
        errorKind: 'rate_limited',
        partial: summary,
      };
    }
    summary.failed.push({
      huduAssetId: asset.id,
      error: failure.error,
      ...(failure.code ? { code: failure.code } : {}),
      ...(failure.existing_asset_name ? { existing_asset_name: failure.existing_asset_name } : {}),
    });
  }

  return { success: true, data: summary };
}
