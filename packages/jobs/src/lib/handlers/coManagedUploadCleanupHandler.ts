import { defineJob, getJobDescriptor } from '../jobDescriptors';
import { withCapabilityJob } from '../jobs/capabilityJob';

export const CO_MANAGED_UPLOAD_CLEANUP_JOB = 'co-managed-upload-cleanup';

/**
 * One upload-cleanup handler over a registry of adapters. This package cannot
 * depend on the co-managed package (noCoManagedNativeImports), so the co-managed
 * adapter is registered from `server` (lib/jobs/handlers/coManagedUploadCleanupHandler.ts).
 * Adapters run in registration order; the job is capability-filtered, so tenants
 * `co-managed` does not serve never reach any adapter.
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
}

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
