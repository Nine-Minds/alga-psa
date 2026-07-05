'use server';

/**
 * Hudu asset↔Alga asset mapping server actions (F212/F213, EE-only).
 *
 * Sibling of huduMappingActions.ts, but RBAC-gated on the `asset` resource
 * (FR16/FR6/FR10: mapping is a Technician flow — read=view, update=mutate)
 * instead of system_settings. Same EE tier gate otherwise.
 *
 * The Hudu asset list is fetched through the Phase 1 path
 * (getHuduCompanyAssets: per-mapped-company, short server cache) — never a
 * second fetch/cache implementation.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { getHuduCompanyAssets } from './huduDataActions';
import type { HuduCompanyFetchOptions, HuduLinkedItem } from '../../integrations/hudu/huduDataCore';
import type { HuduErrorKind } from '../../integrations/hudu/huduClient';
import type { HuduAsset } from '../../integrations/hudu/contracts';
import { resolveHuduCompanyIdForClient as resolveHuduCompanyIdForClientRow } from '../../integrations/hudu/companyMapping';
import { getHuduAssetLayoutTypeMap, isLayoutExcluded } from '../../integrations/hudu/assetLayoutMap';
import { getCachedHuduList } from '../../integrations/hudu/referenceData';
import { suggestHuduAssetMappings } from '../../integrations/hudu/assetMatching';
import type { AlgaMatcherAsset, HuduAssetMappingSuggestion } from '../../integrations/hudu/assetMatching';
import {
  setHuduAssetMappingRow,
  clearHuduAssetMappingRow,
  getHuduAssetMappingRows,
} from '../../integrations/hudu/assetMapping';
import type {
  HuduAssetMappingErrorCode,
  HuduAssetMappingMetadata,
  HuduAssetMappingWriteResult,
} from '../../integrations/hudu/assetMapping';

export type HuduAssetMappingActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: HuduAssetMappingErrorCode };

export interface HuduAssetMappingView {
  hudu_asset_id: number;
  hudu_asset_name: string;
  asset_layout_id: number | null;
  asset_layout_name: string | null;
  primary_serial: string | null;
  url: string | null;
  archived: boolean;
  /** F259: the asset's layout is marked "Don't import" — not importable, still mappable. */
  layout_excluded: boolean;
  mapping: { mapping_id: string; asset_id: string; asset_name: string | null; stale: boolean } | null;
  suggestion: HuduAssetMappingSuggestion | null;
}

export type HuduAssetMappingsResult =
  | {
      state: 'ok';
      assets: HuduAssetMappingView[];
      huduCompanyId: string;
      fetchedAt: string;
      fromCache: boolean;
    }
  | { state: 'unmapped' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

export interface SetHuduAssetMappingActionInput {
  clientId: string;
  assetId: string;
  huduAssetId: string | number;
  metadata?: HuduAssetMappingMetadata;
}

export interface ClearHuduAssetMappingActionInput {
  mappingId?: string;
  huduAssetId?: string | number;
}

type HuduActionPermission = 'read' | 'update';

function withHuduAssetAccess<TArgs extends unknown[], TResult>(
  requiredPermission: HuduActionPermission,
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'asset', requiredPermission);
    if (!allowed) {
      throw new Error(`Forbidden: insufficient permissions (${requiredPermission})`);
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listMatchableAssets(knex: Knex, tenant: string, clientId: string): Promise<AlgaMatcherAsset[]> {
  return tenantDb(knex, tenant).table('assets')
    .where({ client_id: clientId })
    .select('asset_id', 'name as asset_name', 'serial_number');
}

/**
 * F212: the mapped company's Hudu assets (Phase 1 fetch+cache) joined with the
 * client's Alga assets, current mapping rows, and a computed suggestion for
 * each unmapped Hudu asset. Unmapped clients short-circuit (typed state).
 */
export const getHuduAssetMappings = withHuduAssetAccess(
  'read',
  async (
    _user,
    { tenant },
    clientId: string,
    options?: HuduCompanyFetchOptions
  ): Promise<HuduAssetMappingsResult> => {
    try {
      const assetsResult = await getHuduCompanyAssets(clientId, options);
      if (assetsResult.state === 'unmapped') {
        return { state: 'unmapped' };
      }
      if (assetsResult.state !== 'ok') {
        return {
          state: 'error',
          error: assetsResult.state === 'error' ? assetsResult.error : assetsResult.state,
          ...(assetsResult.state === 'error' && assetsResult.errorKind ? { errorKind: assetsResult.errorKind } : {}),
        };
      }

      const huduAssets = assetsResult.items as Array<HuduLinkedItem<HuduAsset>>;
      const { knex } = await createTenantKnex(tenant);

      const mappingRows = await getHuduAssetMappingRows(knex, tenant, {
        huduCompanyId: assetsResult.huduCompanyId,
      });
      const mappingByHuduAssetId = new Map(mappingRows.map((m) => [m.external_entity_id, m]));

      const algaAssets = await listMatchableAssets(knex, tenant, clientId);
      const suggestions = suggestHuduAssetMappings(
        huduAssets,
        algaAssets,
        mappingRows.map((m) => ({ asset_id: m.alga_entity_id, hudu_asset_id: m.external_entity_id }))
      );

      // F259: exclusion is exposed on the view rows (this action is asset-read
      // gated; the layout-map action's system_settings gate would block techs).
      const layoutMap = await getHuduAssetLayoutTypeMap(knex, tenant);

      const assets: HuduAssetMappingView[] = huduAssets.map((asset) => {
        const mapping = mappingByHuduAssetId.get(String(asset.id));
        return {
          hudu_asset_id: asset.id,
          hudu_asset_name: asset.name,
          asset_layout_id: asset.asset_layout_id ?? null,
          asset_layout_name: asset.asset_type ?? null,
          primary_serial: asset.primary_serial ?? null,
          url: asset.hudu_url ?? asset.url ?? null,
          archived: asset.archived === true,
          layout_excluded: asset.asset_layout_id != null && isLayoutExcluded(layoutMap, asset.asset_layout_id),
          mapping: mapping
            ? {
                mapping_id: mapping.id,
                asset_id: mapping.alga_entity_id,
                asset_name: mapping.asset_name,
                stale: mapping.metadata?.stale === true,
              }
            : null,
          suggestion: suggestions.get(asset.id) ?? null,
        };
      });

      return {
        state: 'ok',
        assets,
        huduCompanyId: assetsResult.huduCompanyId,
        fetchedAt: assetsResult.fetchedAt,
        fromCache: assetsResult.fromCache,
      };
    } catch (error) {
      logger.error('[HuduAssetMappingActions] getHuduAssetMappings failed', {
        tenant,
        clientId,
        error: toErrorMessage(error),
      });
      return { state: 'error', error: toErrorMessage(error) };
    }
  }
);

/**
 * F213: map one Alga asset to one Hudu asset. Rejects with a typed code when
 * either side is already mapped — replace is explicit clear+set. Metadata gaps
 * are enriched from the Phase 1 assets cache when possible.
 */
export const setHuduAssetMapping = withHuduAssetAccess(
  'update',
  async (
    _user,
    { tenant },
    input: SetHuduAssetMappingActionInput
  ): Promise<HuduAssetMappingActionResult<{ mapping_id: string }>> => {
    try {
      if (!input?.clientId || !input?.assetId || input?.huduAssetId === undefined || input?.huduAssetId === null) {
        return { success: false, error: 'clientId, assetId and huduAssetId are required.' };
      }

      const { knex } = await createTenantKnex(tenant);

      const huduCompanyId = await resolveHuduCompanyIdForClientRow(knex, tenant, input.clientId);
      if (!huduCompanyId) {
        return { success: false, error: 'Client is not mapped to a Hudu company.' };
      }

      let metadata = input.metadata;
      if (!metadata?.hudu_asset_name) {
        const cached = getCachedHuduList<HuduAsset>(tenant, huduCompanyId, 'assets')?.items.find(
          (a) => String(a.id) === String(input.huduAssetId)
        );
        if (cached) {
          metadata = {
            hudu_asset_name: metadata?.hudu_asset_name ?? cached.name,
            asset_layout_id: metadata?.asset_layout_id ?? cached.asset_layout_id ?? null,
            asset_layout_name: metadata?.asset_layout_name ?? cached.asset_type ?? null,
            primary_serial: metadata?.primary_serial ?? cached.primary_serial ?? null,
            url: metadata?.url ?? cached.url ?? null,
          };
        }
      }

      const result = await setHuduAssetMappingRow(knex, tenant, {
        assetId: input.assetId,
        huduAssetId: input.huduAssetId,
        huduCompanyId,
        metadata,
      });

      if (!result.ok) {
        const failure = result as Extract<HuduAssetMappingWriteResult, { ok: false }>;
        return { success: false, error: failure.message, code: failure.code };
      }

      logger.info('[HuduAssetMappingActions] mapping set', {
        tenant,
        clientId: input.clientId,
        assetId: input.assetId,
        huduAssetId: String(input.huduAssetId),
      });

      return { success: true, data: { mapping_id: result.mapping.id } };
    } catch (error) {
      logger.error('[HuduAssetMappingActions] setHuduAssetMapping failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/** F213: clear a mapping by mapping id or Hudu asset id. */
export const clearHuduAssetMapping = withHuduAssetAccess(
  'update',
  async (
    _user,
    { tenant },
    input: ClearHuduAssetMappingActionInput
  ): Promise<HuduAssetMappingActionResult<{ cleared: number }>> => {
    try {
      if (!input?.mappingId && (input?.huduAssetId === undefined || input?.huduAssetId === null)) {
        return { success: false, error: 'mappingId or huduAssetId is required.' };
      }

      const { knex } = await createTenantKnex(tenant);
      const cleared = await clearHuduAssetMappingRow(knex, tenant, input);

      if (cleared === 0) {
        return { success: false, error: 'Mapping not found.', code: 'not_found' };
      }

      logger.info('[HuduAssetMappingActions] mapping cleared', { tenant, cleared });

      return { success: true, data: { cleared } };
    } catch (error) {
      logger.error('[HuduAssetMappingActions] clearHuduAssetMapping failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);
