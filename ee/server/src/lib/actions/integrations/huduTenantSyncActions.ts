'use server';

/**
 * Hudu tenant-wide sync server actions (EE-only).
 *
 * Config-screen triggers for the whole tenant: import every mapped client's
 * unmatched assets (+ refresh), refresh-only, and the opt-in daily auto-sync
 * toggle. All run the shared runHuduTenantSync engine and report an
 * RMM-style summary; the toggle persists settings.autoSync and converges the
 * recurring job schedule. Gating mirrors the per-client Hudu actions: EE tier +
 * `asset` create/update for the runs, `system_settings`
 * update for the toggle.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { runHuduTenantSync } from '../../integrations/hudu/tenantSync';
import type { HuduTenantSyncSummary } from '../../integrations/hudu/tenantSync';
import { mergeHuduSettings } from '../../integrations/hudu/huduIntegrationRepository';

export type HuduCadence = 'daily';

export interface HuduAutoSyncSettings {
  enabled: boolean;
  cadence: HuduCadence;
}

export type HuduTenantSyncActionResult =
  | { success: true; data: HuduTenantSyncSummary }
  | { success: false; error: string };

interface HuduResourcePermission {
  resource: 'asset' | 'system_settings';
  action: 'create' | 'update';
}

function withHuduAccess<TArgs extends unknown[], TResult>(
  perm: HuduResourcePermission,
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, perm.resource, perm.action);
    if (!allowed) {
      throw new Error(`Forbidden: insufficient permissions (${perm.action})`);
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Import every mapped client's unmatched Hudu assets, then refresh existing. */
export const importAllHuduClients = withHuduAccess(
  { resource: 'asset', action: 'create' },
  async (user, { tenant }): Promise<HuduTenantSyncActionResult> => {
    try {
      const summary = await runHuduTenantSync(tenant, { importNew: true, actorUserId: user.user_id });
      return { success: true, data: summary };
    } catch (error) {
      logger.error('[HuduTenantSyncActions] importAllHuduClients failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/** Refresh (name/serial/fields) every mapped client's already-imported assets. */
export const syncAllHuduClients = withHuduAccess(
  { resource: 'asset', action: 'update' },
  async (user, { tenant }): Promise<HuduTenantSyncActionResult> => {
    try {
      const summary = await runHuduTenantSync(tenant, { importNew: false, actorUserId: user.user_id });
      return { success: true, data: summary };
    } catch (error) {
      logger.error('[HuduTenantSyncActions] syncAllHuduClients failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * Persist the auto-sync toggle (settings.autoSync) and converge the recurring
 * schedule (creates the daily job when enabled, cancels it when disabled).
 */
export const setHuduAutoSync = withHuduAccess(
  { resource: 'system_settings', action: 'update' },
  async (
    _user,
    { tenant },
    input: { enabled: boolean; cadence?: HuduCadence }
  ): Promise<{ success: true; data: HuduAutoSyncSettings } | { success: false; error: string }> => {
    try {
      const autoSync: HuduAutoSyncSettings = {
        enabled: input?.enabled === true,
        cadence: input?.cadence ?? 'daily',
      };

      const { knex } = await createTenantKnex(tenant);
      await mergeHuduSettings(knex, tenant, { autoSync });

      // Converge the recurring schedule to match the new desired state.
      try {
        const { scheduleHuduAutoSyncJob } = await import(
          'server/src/lib/jobs/handlers/huduAutoSyncHandler'
        );
        await scheduleHuduAutoSyncJob(tenant);
      } catch (error) {
        logger.warn('[HuduTenantSyncActions] auto-sync schedule converge skipped', {
          tenant,
          error: toErrorMessage(error),
        });
      }

      logger.info('[HuduTenantSyncActions] auto-sync updated', { tenant, enabled: autoSync.enabled });
      return { success: true, data: autoSync };
    } catch (error) {
      logger.error('[HuduTenantSyncActions] setHuduAutoSync failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);
