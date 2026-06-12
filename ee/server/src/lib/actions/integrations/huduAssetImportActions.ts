'use server';

/**
 * Hudu asset import server actions (F214–F218, EE-only).
 *
 * Sibling of huduAssetMappingActions.ts — same EE tier + Enterprise add-on +
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
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { createAsset, deleteAsset } from '@alga-psa/assets/actions/assetActions';
import { getHuduCompanyAssets } from './huduDataActions';
import type { HuduErrorKind } from '../../integrations/hudu/huduClient';
import type { HuduAsset } from '../../integrations/hudu/contracts';
import {
  getHuduAssetLayoutTypeMap,
  resolveAssetTypeForLayout,
} from '../../integrations/hudu/assetLayoutMap';
import type { AlgaAssetType } from '../../integrations/hudu/assetLayoutMap';
import { suggestHuduAssetMappings } from '../../integrations/hudu/assetMatching';
import type { AlgaMatcherAsset } from '../../integrations/hudu/assetMatching';
import {
  getHuduAssetMappingRows,
  resolveAlgaAssetIdForHuduAsset,
  setHuduAssetMappingRow,
} from '../../integrations/hudu/assetMapping';
import type { HuduAssetMappingWriteResult } from '../../integrations/hudu/assetMapping';
import { deriveHuduAssetTag, huduImportAssetStatus } from '../../integrations/hudu/assetImport';

/** Hudu asset rows carry the layout id at runtime (not in the Phase 1 contract). */
type HuduAssetListItem = HuduAsset & { asset_layout_id?: number | null; hudu_url?: string | null };

export type HuduAssetImportErrorCode =
  | 'client_not_mapped'
  | 'hudu_asset_not_found'
  | 'hudu_asset_already_mapped'
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
}

export type HuduAssetImportResult =
  | {
      success: true;
      data: {
        asset_id: string;
        mapping_id: string;
        asset_tag: string;
        asset_type: AlgaAssetType;
        status: string;
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
  failed: Array<{ huduAssetId: number; error: string; code?: HuduAssetImportErrorCode }>;
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
    await assertAddOnAccess(ADD_ONS.ENTERPRISE);

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

  const huduAsset = (assetsResult.items as HuduAssetListItem[]).find(
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
  const assetType =
    huduAsset.asset_layout_id != null ? resolveAssetTypeForLayout(layoutMap, huduAsset.asset_layout_id) : 'unknown';
  const assetTag = await deriveHuduAssetTag(knex, tenant, {
    huduAssetId: huduAsset.id,
    primarySerial: huduAsset.primary_serial,
  });
  const status = huduImportAssetStatus();

  let createdAssetId: string;
  try {
    const created = await createAsset({
      asset_type: assetType,
      client_id: clientId,
      asset_tag: assetTag,
      name: huduAsset.name,
      status,
      serial_number: huduAsset.primary_serial ?? undefined,
    });
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
 * suggestion) sequentially. Per-item failures are isolated into the summary;
 * a rate-limited Hudu fetch stops the batch with the partial summary.
 */
export const importAllUnmatchedHuduAssets = withHuduAssetCreateAccess(
  async (_user, { tenant }, input: ImportAllUnmatchedHuduAssetsInput): Promise<HuduAssetBulkImportResult> => {
    const summary: HuduAssetBulkImportSummary = { created: 0, failed: [] };
    try {
      if (!input?.clientId) {
        return { success: false, error: 'clientId is required.', partial: summary };
      }

      const assetsResult = await getHuduCompanyAssets(input.clientId);
      if (assetsResult.state !== 'ok') {
        const failure = fetchFailure(assetsResult);
        return { ...failure, partial: summary };
      }

      const huduAssets = assetsResult.items as HuduAssetListItem[];
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

      for (const asset of unmatched) {
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
        });
      }

      logger.info('[HuduAssetImportActions] bulk import finished', {
        tenant,
        clientId: input.clientId,
        created: summary.created,
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
