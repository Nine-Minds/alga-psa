import { getConnection } from '@alga-psa/db';
import { cleanupCoManagedUploads } from '@alga-psa/co-managed';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
export const CO_MANAGED_UPLOAD_CLEANUP_JOB = 'co-managed-upload-cleanup';
export async function coManagedUploadCleanupHandler(input: { tenantId: string; limit?: number }) {
  return cleanupCoManagedUploads(await getConnection(input.tenantId), input.tenantId,
    async path => (await StorageProviderFactory.createProvider()).delete(path), input.limit);
}
