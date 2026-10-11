import { getAdminConnection } from '@alga-psa/db/admin';
import { cleanupPortableRestoreUploadsForInstallation } from '@alga-psa/co-managed';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';

export const PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB = 'portable-restore-upload-cleanup';

/** System maintenance includes absent, suspended and deleted destinations.
 * It is independent of product tier and the UI release flag. */
export async function portableRestoreUploadCleanupHandler() {
  const db = await getAdminConnection();
  if (!await db.schema.hasTable('portable_workspace_restore_uploads')) return { schemaReady: false };
  const result = await cleanupPortableRestoreUploadsForInstallation(db, await StorageProviderFactory.createProvider());
  // Let the job runner record/retry a failed sweep; per-attempt backoff remains
  // in the journal and prevents the retry from repeatedly hitting the same key.
  if (result.failed > 0) throw new Error('Portable restore upload recovery has failed attempts');
  return { schemaReady: true, ...result };
}
