import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../jobs/capabilityJob', () => ({ withCapabilityJob: (_k: string, fn: unknown) => fn }));
import { coManagedUploadCleanupHandler, registerUploadCleanupAdapter, resetUploadCleanupAdapters, coManagedUploadCleanupJobDef, CO_MANAGED_UPLOAD_CLEANUP_JOB } from './coManagedUploadCleanupHandler';

beforeEach(() => { resetUploadCleanupAdapters(); });

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
  it('is a tenant-scoped fan-out definition gated on the co-managed capability', () => {
    expect(CO_MANAGED_UPLOAD_CLEANUP_JOB).toBe('co-managed-upload-cleanup');
    expect(coManagedUploadCleanupJobDef).toMatchObject({ scope: 'tenant', capability: 'co-managed' });
  });
});
