import logger from '@alga-psa/core/logger';

import { getConnection, tenantDb } from '@alga-psa/db';

// Mirrors QUARANTINE_DISMISSED_RETENTION_DAYS in shared/services/email/inboundQuarantine.ts
// (the jobs package does not depend on shared/).
const QUARANTINE_DISMISSED_RETENTION_DAYS = 90;
const QUARANTINE_CLEANUP_BATCH_SIZE = 5_000;
const QUARANTINE_CLEANUP_TENANT = '__inbound_email_quarantine_retention_cleanup__';
const QUARANTINE_CLEANUP_REASON =
  'inbound email quarantine retention cleanup prunes dismissed rows older than the retention window across tenants';

/**
 * Prunes DISMISSED quarantine rows older than the retention window. Open rows
 * are never pruned (an admin has not acted on them yet); the per-mailbox daily
 * cap in recordInboundQuarantine bounds how fast they can accumulate.
 */
export async function cleanupInboundEmailQuarantineJob(): Promise<{
  success: boolean;
  deletedCount: number;
}> {
  try {
    const knex = await getConnection(null);
    let deletedCount = 0;

    while (true) {
      const retentionDb = tenantDb(knex, QUARANTINE_CLEANUP_TENANT);
      const doomedRows = retentionDb
        .unscoped('inbound_email_quarantine', QUARANTINE_CLEANUP_REASON)
        .select('tenant', 'id')
        .where('status', 'dismissed')
        .where(
          'dismissed_at',
          '<',
          knex.raw("now() - (? * interval '1 day')", [QUARANTINE_DISMISSED_RETENTION_DAYS]),
        )
        .orderBy('dismissed_at', 'asc')
        .limit(QUARANTINE_CLEANUP_BATCH_SIZE);

      const deleted = await retentionDb
        .unscoped('inbound_email_quarantine as q', QUARANTINE_CLEANUP_REASON)
        .with('doomed', doomedRows)
        .using(['doomed'])
        .where('q.tenant', knex.ref('doomed.tenant'))
        .where('q.id', knex.ref('doomed.id'))
        .delete()
        .returning('q.id');

      const batchDeleted = Array.isArray(deleted) ? deleted.length : 0;
      deletedCount += batchDeleted;
      if (batchDeleted < QUARANTINE_CLEANUP_BATCH_SIZE) break;
    }

    logger.info('[InboundQuarantineCleanupJob] Completed quarantine retention cleanup', {
      deletedCount,
      retentionDays: QUARANTINE_DISMISSED_RETENTION_DAYS,
    });
    return { success: true, deletedCount };
  } catch (error) {
    logger.error('[InboundQuarantineCleanupJob] Failed quarantine retention cleanup', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { success: false, deletedCount: 0 };
  }
}
