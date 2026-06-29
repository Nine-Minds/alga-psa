'use server';

/**
 * Hudu asset import server actions (F214–F218, EE-only).
 *
 * Thin `withAuth` wrappers over the session-free import core
 * (integrations/hudu/assetImportCore). The wrapper enforces EE tier +
 * `hudu-integration` flag + `asset` CREATE (FR6) and passes the clicking
 * user as the asset audit actor; the core does the work and is shared with the
 * tenant-wide auto-sync (runHuduTenantSync).
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  importHuduAssetCore,
  importUnmatchedHuduAssetsCore,
} from '../../integrations/hudu/assetImportCore';
import type {
  HuduAssetBulkImportResult,
  HuduAssetBulkImportSummary,
  HuduAssetImportErrorCode,
  HuduAssetImportFailure,
  HuduAssetImportResult,
} from '../../integrations/hudu/assetImportCore';

// These types are NOT re-exported: a `'use server'` module may only export
// async actions (Next turns a type re-export into a missing value export).
// Import them from integrations/hudu/assetImportCore directly.

export interface ImportHuduAssetInput {
  clientId: string;
  huduAssetId: string | number;
}

export interface ImportAllUnmatchedHuduAssetsInput {
  clientId: string;
}

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

/** F214–F216: import one Hudu asset into Alga and map it. */
export const importHuduAsset = withHuduAssetCreateAccess(
  async (user, { tenant }, input: ImportHuduAssetInput): Promise<HuduAssetImportResult> => {
    try {
      if (!input?.clientId || input?.huduAssetId === undefined || input?.huduAssetId === null) {
        return { success: false, error: 'clientId and huduAssetId are required.' };
      }

      const result = await importHuduAssetCore(tenant, user.user_id, input.clientId, input.huduAssetId);

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

/** F217/F218: import every plain-unmatched Hudu asset for a mapped client. */
export const importAllUnmatchedHuduAssets = withHuduAssetCreateAccess(
  async (user, { tenant }, input: ImportAllUnmatchedHuduAssetsInput): Promise<HuduAssetBulkImportResult> => {
    const summary: HuduAssetBulkImportSummary = { created: 0, skipped: 0, failed: [] };
    try {
      if (!input?.clientId) {
        return { success: false, error: 'clientId is required.', partial: summary };
      }

      const result = await importUnmatchedHuduAssetsCore(tenant, user.user_id, input.clientId);

      logger.info('[HuduAssetImportActions] bulk import finished', {
        tenant,
        clientId: input.clientId,
        ...(result.success ? result.data : result.partial),
      });

      return result;
    } catch (error) {
      logger.error('[HuduAssetImportActions] importAllUnmatchedHuduAssets failed', {
        tenant,
        error: toErrorMessage(error),
      });
      return { success: false, error: toErrorMessage(error), partial: summary };
    }
  }
);
