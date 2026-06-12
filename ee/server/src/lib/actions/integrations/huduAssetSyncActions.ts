'use server';

/**
 * Hudu manual pull-sync server actions (F219–F222, EE-only).
 *
 * Sibling of huduAssetMappingActions.ts (same guard chain, asset RBAC, here
 * `update`). Sync force-refreshes the mapped company's Hudu assets through
 * the Phase 1 fetch and pull-updates ONLY the synced fields (`name`,
 * `serial_number`) on mapped Alga assets — never `asset_type` or any other
 * field, never deletes assets or mappings. Archived/missing Hudu assets flag
 * the mapping `stale`; reappearance clears the flag.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { updateAsset } from '@alga-psa/assets/actions/assetActions';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { getHuduCompanyAssets } from './huduDataActions';
import type { HuduErrorKind } from '../../integrations/hudu/huduClient';
import type { HuduAsset } from '../../integrations/hudu/contracts';
import {
  getHuduAssetMappingRows,
  setHuduAssetMappingStale,
  touchHuduAssetMappingsSynced,
} from '../../integrations/hudu/assetMapping';

export interface SyncHuduClientAssetsInput {
  clientId: string;
}

export type HuduAssetSyncResult =
  | { state: 'ok'; updated: number; unchanged: number; stale: number; syncedAt: string }
  | { state: 'unmapped' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

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

async function listMappedAssets(
  knex: Knex,
  tenant: string,
  assetIds: string[]
): Promise<Array<{ asset_id: string; name: string; serial_number: string | null }>> {
  if (assetIds.length === 0) {
    return [];
  }
  return knex('assets').where({ tenant }).whereIn('asset_id', assetIds).select('asset_id', 'name', 'serial_number');
}

/** The only fields sync ever writes (FR7/F220: Hudu wins on these alone). */
function syncedFieldChanges(
  huduAsset: HuduAsset,
  algaAsset: { name: string; serial_number: string | null } | undefined
): { name?: string; serial_number?: string } {
  const changes: { name?: string; serial_number?: string } = {};
  if (!algaAsset) {
    return changes;
  }
  if (huduAsset.name && huduAsset.name !== algaAsset.name) {
    changes.name = huduAsset.name;
  }
  const huduSerial = huduAsset.primary_serial ?? null;
  if (huduSerial !== null && huduSerial !== (algaAsset.serial_number ?? null)) {
    changes.serial_number = huduSerial;
  }
  return changes;
}

/**
 * F219–F222: re-fetch the mapped company's Hudu assets (cache bypassed) and
 * walk the company's mapping rows: present+live ⇒ update changed synced
 * fields and clear `stale`; archived/missing ⇒ set `stale` (never delete).
 * All processed rows get `last_synced_at`; returns the count summary.
 */
export const syncHuduClientAssets = withHuduAssetAccess(
  'update',
  async (_user, { tenant }, input: SyncHuduClientAssetsInput): Promise<HuduAssetSyncResult> => {
    try {
      if (!input?.clientId) {
        return { state: 'error', error: 'clientId is required.' };
      }

      const assetsResult = await getHuduCompanyAssets(input.clientId, { refresh: true });
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

      const huduAssetById = new Map(assetsResult.items.map((asset) => [String(asset.id), asset]));
      const { knex } = await createTenantKnex(tenant);

      const mappingRows = await getHuduAssetMappingRows(knex, tenant, {
        huduCompanyId: assetsResult.huduCompanyId,
      });
      const algaAssets = await listMappedAssets(knex, tenant, mappingRows.map((m) => m.alga_entity_id));
      const algaAssetById = new Map(algaAssets.map((a) => [String(a.asset_id), a]));

      let updated = 0;
      let unchanged = 0;
      let stale = 0;

      for (const mapping of mappingRows) {
        const huduAsset = huduAssetById.get(mapping.external_entity_id);
        const wasStale = mapping.metadata?.stale === true;

        if (!huduAsset || huduAsset.archived === true) {
          stale += 1;
          if (!wasStale) {
            await setHuduAssetMappingStale(knex, tenant, { mappingId: mapping.id }, true);
          }
          continue;
        }

        const changes = syncedFieldChanges(huduAsset, algaAssetById.get(mapping.alga_entity_id));
        if (Object.keys(changes).length > 0) {
          await updateAsset(mapping.alga_entity_id, changes);
          updated += 1;
        } else {
          unchanged += 1;
        }
        if (wasStale) {
          await setHuduAssetMappingStale(knex, tenant, { mappingId: mapping.id }, false);
        }
      }

      const syncedAt = new Date().toISOString();
      await touchHuduAssetMappingsSynced(knex, tenant, mappingRows.map((m) => m.id), syncedAt);

      logger.info('[HuduAssetSyncActions] sync completed', {
        tenant,
        clientId: input.clientId,
        huduCompanyId: assetsResult.huduCompanyId,
        updated,
        unchanged,
        stale,
      });

      return { state: 'ok', updated, unchanged, stale, syncedAt };
    } catch (error) {
      logger.error('[HuduAssetSyncActions] syncHuduClientAssets failed', {
        tenant,
        clientId: input?.clientId,
        error: toErrorMessage(error),
      });
      return { state: 'error', error: toErrorMessage(error) };
    }
  }
);
