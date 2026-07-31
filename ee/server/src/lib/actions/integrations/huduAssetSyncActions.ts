'use server';

/**
 * Hudu manual pull-sync server action (F219–F222, EE-only).
 *
 * Thin `withAuth` wrapper over the session-free sync core
 * (integrations/hudu/assetSyncCore). Enforces EE tier + `asset` UPDATE and
 * passes the clicking user as the asset audit actor;
 * the core does the work and is shared with the tenant-wide auto-sync.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { syncHuduClientAssetsCore } from '../../integrations/hudu/assetSyncCore';
import type { HuduAssetSyncResult } from '../../integrations/hudu/assetSyncCore';

// HuduAssetSyncResult is not re-exported (this is a `'use server'` module —
// only async actions may be exported). Import it from assetSyncCore directly.

export interface SyncHuduClientAssetsInput {
  clientId: string;
}

type HuduActionPermission = 'read' | 'update';

function huduSyncActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('Forbidden')) {
    return 'You do not have permission to sync Hudu assets.';
  }
  return 'Unable to sync Hudu assets. Check the Hudu connection and try again.';
}

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

export const syncHuduClientAssets = withHuduAssetAccess(
  'update',
  async (user, { tenant }, input: SyncHuduClientAssetsInput): Promise<HuduAssetSyncResult> => {
    if (!input?.clientId) {
      return { state: 'error', error: 'clientId is required.' };
    }
    try {
      return await syncHuduClientAssetsCore(tenant, user.user_id, input.clientId);
    } catch (error) {
      logger.error('[HuduAssetSyncActions] syncHuduClientAssets failed', {
        tenant,
        clientId: input?.clientId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { state: 'error', error: huduSyncActionErrorMessage(error) };
    }
  }
);
