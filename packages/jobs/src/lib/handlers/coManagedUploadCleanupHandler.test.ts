import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../jobs/capabilityJob', () => ({ withCapabilityJob: (_k: string, fn: unknown) => fn }));
import { coManagedUploadCleanupHandler, registerUploadCleanupAdapter, resetUploadCleanupAdapters, registerCoManagedUploadCleanupJob, CO_MANAGED_UPLOAD_CLEANUP_JOB } from './coManagedUploadCleanupHandler';
import { getJobDescriptor, resetJobDescriptors } from '../jobDescriptors';

beforeEach(() => { resetUploadCleanupAdapters(); resetJobDescriptors(); });

describe('one upload-cleanup handler over registered adapters (A3)', () => {
  it('runs every registered adapter in registration order with the tenant and limit', async () => {
    const a = vi.fn().mockResolvedValue({ purgedFiles: 2 }), b = vi.fn().mockResolvedValue({ removed: 3 });
    registerUploadCleanupAdapter({ name: 'co-managed', run: a }); registerUploadCleanupAdapter({ name: 'other', run: b });
    const out = await coManagedUploadCleanupHandler({ tenantId: 'tenant', limit: 5 });
    expect(Object.keys(out)).toEqual(['co-managed', 'other']);
    expect(a).toHaveBeenCalledWith('tenant', 5); expect(b).toHaveBeenCalledWith('tenant', 5);
  });
  it('re-registering an adapter by name replaces it rather than doubling the sweep', async () => {
    const a = vi.fn().mockResolvedValue(1), b = vi.fn().mockResolvedValue(2);
    registerUploadCleanupAdapter({ name: 'x', run: a }); registerUploadCleanupAdapter({ name: 'x', run: b });
    await coManagedUploadCleanupHandler({ tenantId: 'tenant' });
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1);
  });
  it('is declared as data, capability-gated and idempotent', () => {
    registerCoManagedUploadCleanupJob(); registerCoManagedUploadCleanupJob();
    expect(getJobDescriptor(CO_MANAGED_UPLOAD_CLEANUP_JOB)).toMatchObject({ scope: 'tenant', capability: 'co-managed' });
  });
});
