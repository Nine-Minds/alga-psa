import { getConnection } from '@alga-psa/db';
import { cleanupCoManagedUploads, cleanupCoManagedThreadTransfers } from '@alga-psa/co-managed';
import { defineJob, getJobDescriptor } from '../jobDescriptors';
import { withCapabilityJob } from '../jobs/capabilityJob';

export const CO_MANAGED_UPLOAD_CLEANUP_JOB = 'co-managed-upload-cleanup';

/**
 * One upload-cleanup handler, two adapters. The co-managed adapter sweeps the
 * `co_management_*` upload tables; the base adapter (native comment-attachment
 * drafts) lives in `server` and is registered from there, since this package
 * cannot import it. Adapters run in registration order; the job itself is
 * capability-filtered, so native-only tenants never reach either adapter here.
 */
export interface UploadCleanupAdapter {
  name: string;
  run: (tenantId: string, limit?: number) => Promise<unknown>;
}

const adapters = new Map<string, UploadCleanupAdapter>();

export function registerUploadCleanupAdapter(adapter: UploadCleanupAdapter): void {
  adapters.set(adapter.name, adapter);
}

/** Test-only. */
export function resetUploadCleanupAdapters(): void {
  adapters.clear();
  registerUploadCleanupAdapter(coManagedUploadCleanupAdapter);
}

async function removeFromStorage(path: string): Promise<void> {
  const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
  await (await StorageProviderFactory.createProvider()).delete(path);
}

export const coManagedUploadCleanupAdapter: UploadCleanupAdapter = {
  name: 'co-managed',
  async run(tenantId, limit) {
    const db = await getConnection(tenantId);
    return {
      uploads: await cleanupCoManagedUploads(db, tenantId, removeFromStorage, limit),
      transfers: await cleanupCoManagedThreadTransfers(db, tenantId, removeFromStorage, limit),
    };
  },
};
registerUploadCleanupAdapter(coManagedUploadCleanupAdapter);

export async function coManagedUploadCleanupHandler(input: { tenantId: string; limit?: number }) {
  const out: Record<string, unknown> = {};
  for (const adapter of adapters.values()) out[adapter.name] = await adapter.run(input.tenantId, input.limit);
  return out;
}

/** Direct (per-tenant) entry: a tenant the capability does not serve completes as a logged skip, before any SQL. */
export const coManagedUploadCleanupJob = withCapabilityJob<{ tenantId: string; limit?: number }>('co-managed',
  async (_jobId, data) => { await coManagedUploadCleanupHandler(data); });

/** Declares the job as data; idempotent. Capability-gated: runs only for tenants `co-managed` serves. */
export function registerCoManagedUploadCleanupJob(): void {
  if (getJobDescriptor(CO_MANAGED_UPLOAD_CLEANUP_JOB)) return;
  defineJob({
    name: CO_MANAGED_UPLOAD_CLEANUP_JOB,
    scope: 'tenant',
    capability: 'co-managed',
    schedule: { cron: '17 * * * *' },
    run: (tenantId) => coManagedUploadCleanupHandler({ tenantId }),
  });
}
