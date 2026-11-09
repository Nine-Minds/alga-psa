import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CONVERSATION_FILE_CLEANUP_MAX_BATCH, CONVERSATION_FILE_RETENTION_DAYS } from '../limits';
import { FILES, PUBLICATIONS } from './access';
import { claimedConversationFileIds } from './retention';
import { isConversationFileUuid } from './snapshot';
import { assertConversationFilePath } from './storagePath';

const DAY_MS = 86_400_000;
/** 2^attempts minutes, capped at one hour. */
export const conversationFileBackoffMs = (attempts: number): number => Math.min(3600, 2 ** Math.min(attempts, 10) * 60) * 1000;

/** Trusted tenant maintenance. Ships UNSCHEDULED (the co-managed job is capability-gated to
 * co-managed tenants); the ticket-conversations card registers it. Spared: files a retention hook
 * claims (selected editor files) and every copy whose receipt is `published` (accepted copies).
 * Timestamps are bound, never `now()` inside UPDATE (Citus). */
export async function cleanupConversationFiles(db: Knex, tenantInput: string, remove: (path: string) => Promise<void>, limit = 100, now: Date = new Date()) {
  if ((db as Knex.Transaction).isTransaction || !isConversationFileUuid(tenantInput) || !Number.isInteger(limit) || limit < 1 || limit > CONVERSATION_FILE_CLEANUP_MAX_BATCH) throw new Error('Invalid conversation file cleanup request');
  const tenant = tenantInput.toLowerCase();
  const cutoff = new Date(now.getTime() - CONVERSATION_FILE_RETENTION_DAYS * DAY_MS);
  const result = { abandonedReceipts: 0, discardedFiles: 0, purgedFiles: 0, completedReceipts: 0, failedFiles: 0 };

  await db.transaction(async trx => {
    const owner = tenantDb(trx, tenant);
    const stale = await owner.table(PUBLICATIONS).where('status', 'prepared').where('last_activity_at', '<=', cutoff)
      .orderBy('last_activity_at').orderBy('operation_id').limit(limit).forUpdate().skipLocked();
    for (const receipt of stale) {
      await owner.table(PUBLICATIONS).where('operation_id', receipt.operation_id).update({ status: 'abandoned', abandoned_at: now, last_activity_at: now });
      await owner.table(FILES).where('publication_operation_id', receipt.operation_id).whereNull('discarded_at').update({ discarded_at: now, cleanup_next_attempt_at: now });
      result.abandonedReceipts++;
    }
    const uploads = await owner.table(FILES).whereNull('publication_operation_id').whereNull('discarded_at').where('last_activity_at', '<=', cutoff)
      .orderBy('last_activity_at').orderBy('file_id').limit(limit).forUpdate().skipLocked();
    const claimed = await claimedConversationFileIds(trx, tenant, uploads.map((row: any) => row.file_id));
    for (const row of uploads) {
      if (claimed.has(row.file_id)) continue;
      await owner.table(FILES).where('file_id', row.file_id).update({ discarded_at: now, cleanup_next_attempt_at: now });
      result.discardedFiles++;
    }
  });

  const candidates = await tenantDb(db, tenant).table(FILES).whereNotNull('discarded_at').whereNull('purged_at').where('cleanup_next_attempt_at', '<=', now)
    .orderBy('cleanup_next_attempt_at').orderBy('file_id').limit(limit).select('file_id');
  for (const candidate of candidates) {
    try {
      const purged = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant);
        const row = await owner.table(FILES).where('file_id', candidate.file_id).whereNotNull('discarded_at').whereNull('purged_at').where('cleanup_next_attempt_at', '<=', now).forUpdate().skipLocked().first();
        if (!row) return false;
        assertConversationFilePath(row);
        await remove(row.storage_path);
        await owner.table(FILES).where('file_id', row.file_id).update({ purged_at: now, file_name: 'Removed file', mime_type: 'application/octet-stream', cleanup_error_code: null });
        return true;
      });
      if (purged) result.purgedFiles++;
    } catch {
      result.failedFiles++;
      await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant);
        const row = await owner.table(FILES).where('file_id', candidate.file_id).whereNotNull('discarded_at').whereNull('purged_at').forUpdate().first();
        if (!row) return;
        await owner.table(FILES).where('file_id', row.file_id).update({ cleanup_attempts: row.cleanup_attempts + 1, cleanup_error_code: 'file_cleanup_failed',
          cleanup_next_attempt_at: new Date(now.getTime() + conversationFileBackoffMs(row.cleanup_attempts)) });
      });
    }
  }

  await db.transaction(async trx => {
    const owner = tenantDb(trx, tenant);
    const receipts = await owner.table(PUBLICATIONS).where('status', 'abandoned').whereNull('cleanup_completed_at').orderBy('abandoned_at').orderBy('operation_id').limit(limit).forUpdate().skipLocked();
    for (const receipt of receipts) {
      if (await owner.table(FILES).where('publication_operation_id', receipt.operation_id).whereNull('purged_at').first()) continue;
      await owner.table(PUBLICATIONS).where('operation_id', receipt.operation_id).update({ cleanup_completed_at: now });
      result.completedReceipts++;
    }
  });
  return result;
}

/** Adapter factory for the job runner that L1 mounts: binds the storage delete once. */
export const createConversationFileCleanupAdapter = (remove: (path: string) => Promise<void>) =>
  (db: Knex, tenant: string, limit?: number) => cleanupConversationFiles(db, tenant, remove, limit);
