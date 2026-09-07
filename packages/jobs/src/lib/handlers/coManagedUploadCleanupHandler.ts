import { getConnection } from '@alga-psa/db';
import { cleanupCoManagedUploads, cleanupCoManagedThreadTransfers } from '@alga-psa/co-managed';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
export const CO_MANAGED_UPLOAD_CLEANUP_JOB = 'co-managed-upload-cleanup';
export async function coManagedUploadCleanupHandler(input: { tenantId: string; limit?: number }) {
  const db = await getConnection(input.tenantId), remove = async (path: string) => (await StorageProviderFactory.createProvider()).delete(path);
  const uploads = await cleanupCoManagedUploads(db, input.tenantId, remove, input.limit);
  return { ...uploads, transfers: await cleanupCoManagedThreadTransfers(db, input.tenantId, remove, input.limit) };
}
