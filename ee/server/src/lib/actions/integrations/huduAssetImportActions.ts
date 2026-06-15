'use server';

/**
 * Hudu asset import server actions (F214–F218, EE-only).
 *
 * Sibling of huduAssetMappingActions.ts — same EE tier +
 * `hudu-integration` flag chain, but RBAC-gated on `asset` CREATE (FR6).
 * The Hudu asset list rides the Phase 1 fetch+cache path
 * (getHuduCompanyAssets); asset creation goes through the existing
 * createAsset action (FR4). "Atomic" import = create asset → create mapping
 * row; if the mapping write fails the just-created asset is best-effort
 * deleted and the typed failure names the orphan either way.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { createAsset, deleteAsset } from '@alga-psa/assets/actions/assetActions';
import { listAssetTypes } from '@alga-psa/assets/lib/assetTypeRegistry';
import { getHuduCompanyAssets } from './huduDataActions';
import type { HuduLinkedItem } from './huduDataActions';
import type { HuduErrorKind } from '../../integrations/hudu/huduClient';
import type { HuduAsset } from '../../integrations/hudu/contracts';
import {
  getHuduAssetLayoutTypeMap,
  isLayoutExcluded,
  resolveAssetTypeForLayout,
} from '../../integrations/hudu/assetLayoutMap';
import { projectHuduFieldsOntoSchema } from '../../integrations/hudu/layoutFieldSchema';
import { suggestHuduAssetMappings } from '../../integrations/hudu/assetMatching';
import type { AlgaMatcherAsset } from '../../integrations/hudu/assetMatching';
import {
  getHuduAssetMappingRows,
  resolveAlgaAssetIdForHuduAsset,
  setHuduAssetMappingRow,
} from '../../integrations/hudu/assetMapping';
import type { HuduAssetMappingWriteResult } from '../../integrations/hudu/assetMapping';
import { deriveHuduAssetTag, huduImportAssetStatus } from '../../integrations/hudu/assetImport';
import { buildHuduFieldsAttribute } from '../../integrations/hudu/assetAttributes';

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
        /** Built-in slug or a registry custom slug (F315). */
        asset_type: string;
        status: string;
        /** F317: schema keys whose Hudu value failed projection validation. */
        projection_skipped?: string[];
      };
    }
  | HuduAssetImportFailure;

export interface ImportHuduAssetInput {
  clientId: string;
  huduAssetId: string | number;
}

export interface ImportAllUnmatchedHuduAssetsInput {
  clientId: string;
}

export interface HuduAssetBulkImportSummary {
  created: number;
  /** F258: unmatched assets whose layout is marked "Don't import" (FR8). */
  skipped: number;
  failed: Array<{
    huduAssetId: number;
    error: string;
    code?: HuduAssetImportErrorCode;
    /** serial_conflict rows carry the existing asset's name for the UI (F262). */
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

function withHuduAssetCreateAccess<TArgs extends unknown[], TResult>(
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'asset', 'create');
    if (!allowed) {
      throw new Error('Forbidden: insufficient permissions (create)');
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);

    const enabled = await featureFlags.isEnabled('hudu-integration', {
      userId: user.user_id,
      tenantId: context.tenant,
    });
    if (!enabled) {
      throw new Error('Hudu integration is disabled for this tenant.');
    }

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fetchFailure(
  result: Exclude<Awaited<ReturnType<typeof getHuduCompanyAssets>>, { state: 'ok' }>
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

async function cleanUpOrphanAsset(assetId: string): Promise<boolean> {
  try {
    const result = await deleteAsset(assetId, { suppressRevalidate: true });
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
 * Single-asset import core, shared by both actions. Fetches via the Phase 1
 * cached path, so bulk callers mostly hit the server cache per item — and a
 * mid-batch 429 surfaces here as a typed rate_limited failure (F218).
 */
async function importHuduAssetCore(
  tenant: string,
  clientId: string,
  huduAssetId: string | number
): Promise<HuduAssetImportResult> {
  const assetsResult = await getHuduCompanyAssets(clientId);
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

  // F315: a configured custom slug only resolves when it's still in the
  // tenant's registry; F317: a custom target additionally gets the Hudu field
  // values projected onto its fields_schema keys.
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

  // One write: projected schema keys + the Hudu namespace ride createAsset's
  // attributes payload (F317) — no post-create jsonb merge anymore.
  let createdAssetId: string;
  try {
    const created = await createAsset(
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
      // F317: a required custom field missing from Hudu must not fail the import;
      // it's skipped (raw value stays in hudu_fields), matching the projection.
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

  const cleanedUp = await cleanUpOrphanAsset(createdAssetId);
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

/** F214–F216: import one Hudu asset into Alga and map it. */
export const importHuduAsset = withHuduAssetCreateAccess(
  async (_user, { tenant }, input: ImportHuduAssetInput): Promise<HuduAssetImportResult> => {
    try {
      if (!input?.clientId || input?.huduAssetId === undefined || input?.huduAssetId === null) {
        return { success: false, error: 'clientId and huduAssetId are required.' };
      }

      const result = await importHuduAssetCore(tenant, input.clientId, input.huduAssetId);

      if (result.success) {
        logger.info('[HuduAssetImportActions] asset imported', {
          tenant,
          clientId: input.clientId,
          huduAssetId: String(input.huduAssetId),
          assetId: result.data.asset_id,
        });
      }

      return result;
    } catch (error) {
      logger.error('[HuduAssetImportActions] importHuduAsset failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * F217/F218: import every plain-Unmapped Hudu asset (no mapping row, no
 * suggestion) sequentially. Excluded-layout assets are skipped (counted in
 * the summary, F258). Per-item failures are isolated into the summary;
 * a rate-limited Hudu fetch stops the batch with the partial summary.
 */
export const importAllUnmatchedHuduAssets = withHuduAssetCreateAccess(
  async (_user, { tenant }, input: ImportAllUnmatchedHuduAssetsInput): Promise<HuduAssetBulkImportResult> => {
    const summary: HuduAssetBulkImportSummary = { created: 0, skipped: 0, failed: [] };
    try {
      if (!input?.clientId) {
        return { success: false, error: 'clientId is required.', partial: summary };
      }

      const assetsResult = await getHuduCompanyAssets(input.clientId);
      if (assetsResult.state !== 'ok') {
        const failure = fetchFailure(assetsResult);
        return { ...failure, partial: summary };
      }

      const huduAssets = assetsResult.items as Array<HuduLinkedItem<HuduAsset>>;
      const { knex } = await createTenantKnex(tenant);

      const mappingRows = await getHuduAssetMappingRows(knex, tenant, {
        huduCompanyId: assetsResult.huduCompanyId,
      });
      const mappedHuduAssetIds = new Set(mappingRows.map((m) => m.external_entity_id));

      const algaAssets: AlgaMatcherAsset[] = await knex('assets')
        .where({ tenant, client_id: input.clientId })
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
        const result = await importHuduAssetCore(tenant, input.clientId, asset.id);
        if (result.success) {
          summary.created += 1;
          continue;
        }
        const failure = result as HuduAssetImportFailure;
        if (failure.code === 'rate_limited') {
          logger.warn('[HuduAssetImportActions] bulk import stopped on rate limit', {
            tenant,
            clientId: input.clientId,
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

      logger.info('[HuduAssetImportActions] bulk import finished', {
        tenant,
        clientId: input.clientId,
        created: summary.created,
        skipped: summary.skipped,
        failed: summary.failed.length,
      });

      return { success: true, data: summary };
    } catch (error) {
      logger.error('[HuduAssetImportActions] importAllUnmatchedHuduAssets failed', {
        tenant,
        error: toErrorMessage(error),
      });
      return { success: false, error: toErrorMessage(error), partial: summary };
    }
  }
);
