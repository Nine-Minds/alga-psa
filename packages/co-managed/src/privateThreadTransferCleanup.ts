import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { disclosedAttachmentPath } from './attachmentStoragePath';
import { CO_MANAGED_UPLOAD_RETENTION_DAYS } from './uploadCleanup';
const TABLE = 'co_management_thread_transfers';
/** Source-owned maintenance only. Published objects belong to their customer
 * attachment records; this sweep can delete only unpublished transfer paths. */
export async function cleanupCoManagedThreadTransfers(db: Knex, tenant: string, remove: (path: string) => Promise<void>, limit = 100) {
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid thread transfer cleanup request');
  tenant = tenant.toLowerCase(); const result = { abandonedTransfers: 0, cleanedTransfers: 0, failedTransfers: 0 };
  await db.transaction(async trx => {
    const owner = tenantDb(trx, tenant), rows = await owner.table(TABLE).where('status', 'prepared')
      .whereRaw("last_activity_at <= clock_timestamp() - ? * interval '1 day'", [CO_MANAGED_UPLOAD_RETENTION_DAYS]).orderBy('last_activity_at').limit(limit).forUpdate().skipLocked();
    for (const row of rows) { await owner.table(TABLE).where('operation_id', row.operation_id).update({ status: 'abandoned', abandoned_at: trx.raw('clock_timestamp()') }); result.abandonedTransfers++; }
  });
  const due = await tenantDb(db, tenant).table(TABLE).where('status', 'abandoned').whereNull('cleaned_at').where('cleanup_next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .orderBy('cleanup_next_attempt_at').orderBy('operation_id').limit(limit).select('operation_id');
  for (const candidate of due) {
    try {
      const cleaned = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant), row = await owner.table(TABLE).where({ operation_id: candidate.operation_id, status: 'abandoned' }).whereNull('cleaned_at')
          .where('cleanup_next_attempt_at', '<=', trx.raw('clock_timestamp()')).forUpdate().skipLocked().first();
        if (!row) return false;
        for (const file of row.manifest) {
          if (file.path !== disclosedAttachmentPath(row.customer_tenant, tenant, row.operation_id, file.targetId, row.project_task_id ? 'project_task' : 'ticket')) throw new Error('Invalid transfer cleanup path');
          await remove(file.path);
        }
        await owner.table(TABLE).where('operation_id', row.operation_id).update({ cleaned_at: trx.raw('clock_timestamp()'), comment_map: {}, manifest: '[]', cleanup_error_code: null });
        return true;
      });
      if (cleaned) result.cleanedTransfers++;
    } catch {
      result.failedTransfers++;
      await tenantDb(db, tenant).table(TABLE).where({ operation_id: candidate.operation_id, status: 'abandoned' }).whereNull('cleaned_at').update({ cleanup_attempts: db.raw('cleanup_attempts + 1'),
        cleanup_error_code: 'thread_transfer_cleanup_failed', cleanup_next_attempt_at: db.raw("clock_timestamp() + least(3600, power(2, least(cleanup_attempts, 10)) * 60) * interval '1 second'") });
    }
  }
  return result;
}
