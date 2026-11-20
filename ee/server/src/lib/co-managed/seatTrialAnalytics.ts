import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

/** Submit committed receipts through the configured analytics client. Recovery can safely retry
 * a receipt with the same insertion ID. A telemetry outage never decides admission or funding. */
export async function reportSeatTrialMilestones(db: Knex, tenant: string) {
  try {
    const { analytics } = await import('@alga-psa/analytics');
    const client = analytics.getClient();
    if (!client) return;
    await db.transaction(async trx => {
      const rows = () => tenantDb(trx, tenant).table('co_managed_seat_trial_milestones');
      for (const row of await rows().whereNull('reported_at').forUpdate().skipLocked()) {
        await client.captureImmediate({ distinctId: await analytics.getDistinctId(), event: 'co_managed_seat_trial_' + row.milestone,
          uuid: row.event_id, properties: { trial_id: row.trial_id } });
        // write-admission: exempt — telemetry delivery acknowledges a locked receipt independently of trial access.
        await rows().where({ trial_id: row.trial_id, milestone: row.milestone }).update({ reported_at: trx.fn.now() });
      }
    });
  } catch {
    logger.warn('Co-managed Seat trial analytics delivery deferred');
  }
}
