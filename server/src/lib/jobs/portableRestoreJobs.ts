import { defineJob, getJobDescriptor } from '@alga-psa/jobs/fanout';
import { cleanupPortableRestoreUploadsForInstallation } from '@alga-psa/co-managed';
import { getAdminConnection } from '@alga-psa/db/admin';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';

export const PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB = 'portable-restore-upload-cleanup';

import { forcedValue } from '@alga-psa/core/capability';

/** The shared kill switch: `FORCE_CAPABILITIES=co-managed:off` (or a malformed entry) disables the sweep entirely. */
const forcedOff = () => { const state = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed'); return state === 'off' || state === 'malformed'; };

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

/**
 * Declares the sweep through the L0b job registry (one schedule row, system scope). Idempotent.
 *
 * Dark means nothing is scheduled: a plain installation never restored a portable workspace, so it has no upload
 * journal rows and registers no job. The only cost while dark is one startup existence probe (not a hot path).
 * The sweep appears on the next start after a restore has journaled bytes. Until then, abandoned attempts wait
 * for that start; a resumed restore stages under a fresh attempt id and does not reclaim the earlier one itself.
 */
export async function registerPortableRestoreJobs() {
  if (forcedOff() || getJobDescriptor(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB)) return false;
  const db = await getAdminConnection();
  if (!await db.schema.hasTable('portable_workspace_restore_uploads')) return false;
  if (!(await db('portable_workspace_restore_uploads').select(db.raw('1')).first())) return false;
  defineJob({ name: PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB, scope: 'system', schedule: { cron: '*/15 * * * *' }, run: portableRestoreUploadCleanup });
  return true;
}
