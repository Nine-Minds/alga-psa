/**
 * Huntress poll dispatcher: a single recurring pg-boss job that iterates all
 * active Huntress integrations and polls the ones whose per-tenant interval
 * has elapsed. Registered from initializeApp in enterprise builds.
 */

import { isFeatureFlagEnabled } from '@alga-psa/core';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { runWithTenant } from '@/lib/db';
import type { IJobScheduler } from 'server/src/lib/jobs/jobScheduler';
import { isPollDue, parseHuntressSettings } from './settings';
import { runHuntressIncidentPoll } from './incidents/incidentPoller';

export const HUNTRESS_POLL_JOB_NAME = 'huntress-incident-poll-dispatch';
const HUNTRESS_FEATURE_FLAG = 'huntress-rmm-integration';
const DISPATCH_INTERVAL = process.env.HUNTRESS_POLL_DISPATCH_INTERVAL || '5 minutes';

export async function dispatchHuntressPolls(now: Date = new Date()): Promise<void> {
  const knex = await getAdminConnection();
  const integrations = await knex('rmm_integrations')
    .where({ provider: 'huntress', is_active: true })
    .select('tenant', 'integration_id', 'settings', 'last_incremental_sync_at');

  for (const row of integrations) {
    const settings = parseHuntressSettings(row.settings);
    if (!isPollDue(row.last_incremental_sync_at, settings.pollIntervalMinutes, now)) continue;

    const flagEnabled = await isFeatureFlagEnabled(HUNTRESS_FEATURE_FLAG, {
      tenantId: String(row.tenant),
    });
    if (!flagEnabled) continue;

    try {
      await runWithTenant(String(row.tenant), async () => {
        await runHuntressIncidentPoll({
          tenantId: String(row.tenant),
          integrationId: String(row.integration_id),
          trigger: 'scheduled',
        });
      });
    } catch (error) {
      // One tenant's failure must never block the others.
      logger.error('[Huntress] Scheduled poll failed', { tenant: row.tenant, error });
    }
  }
}

export async function registerHuntressPolling(jobScheduler: IJobScheduler): Promise<void> {
  jobScheduler.registerJobHandler<{ tenantId: string }>(HUNTRESS_POLL_JOB_NAME, async () => {
    try {
      await dispatchHuntressPolls();
    } finally {
      // Re-enqueue keeps the dispatcher ticking; singletonKey dedups retries.
      await jobScheduler.scheduleRecurringJob(HUNTRESS_POLL_JOB_NAME, DISPATCH_INTERVAL, {
        tenantId: 'system',
      });
    }
  });

  await jobScheduler.scheduleRecurringJob(HUNTRESS_POLL_JOB_NAME, DISPATCH_INTERVAL, {
    tenantId: 'system',
  });
  logger.info('[Huntress] Incident poll dispatcher registered');
}
