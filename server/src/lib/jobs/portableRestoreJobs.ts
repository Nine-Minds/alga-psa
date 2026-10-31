import { defineJob, getJobDescriptor } from '@alga-psa/jobs/fanout';
import { cleanupPortableRestoreUploadsForInstallation } from '@alga-psa/co-managed';
import { getAdminConnection } from '@alga-psa/db/admin';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';

export const PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB = 'portable-restore-upload-cleanup';

/** `FORCE_CAPABILITIES=co-managed:off` (or a malformed entry) disables the sweep entirely. */
function forcedOff(raw = process.env.FORCE_CAPABILITIES) {
  return (raw ?? '').split(',').some(part => {
    const [key, ...rest] = part.trim().split(':');
    return key.trim().toLowerCase() === 'co-managed' && rest.join(':').trim().toLowerCase() !== 'on';
  });
}

/** Installation-wide sweep of abandoned portable-restore byte uploads. Runs with no tenant context, and
 * only does work where the journal table exists and holds attempts. */
export async function portableRestoreUploadCleanup() {
  if (forcedOff()) return { disabled: true };
  const db = await getAdminConnection();
  if (!await db.schema.hasTable('portable_workspace_restore_uploads')) return { schemaReady: false };
  const result = await cleanupPortableRestoreUploadsForInstallation(db, await StorageProviderFactory.createProvider());
  // Throwing lets the runner record/retry; per-attempt backoff in the journal prevents hammering one key.
  if (result.failed > 0) throw new Error('Portable restore upload recovery has failed attempts');
  return { schemaReady: true, ...result };
}

/** Declares the sweep through the L0b job registry (one Temporal/pg-boss schedule row, system scope). Idempotent. */
export function registerPortableRestoreJobs() {
  if (forcedOff() || getJobDescriptor(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB)) return;
  defineJob({ name: PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB, scope: 'system', schedule: { cron: '*/15 * * * *' }, run: portableRestoreUploadCleanup });
}
