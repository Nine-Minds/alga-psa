import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ uploads: vi.fn(), transfers: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => 'db' }));
vi.mock('@alga-psa/co-managed', () => ({ cleanupCoManagedUploads: mocks.uploads, cleanupCoManagedThreadTransfers: mocks.transfers }));

vi.mock('../jobs/capabilityJob', () => ({ withCapabilityJob: (_k: string, fn: unknown) => fn }));
import { coManagedUploadCleanupHandler, registerUploadCleanupAdapter, resetUploadCleanupAdapters, registerCoManagedUploadCleanupJob, CO_MANAGED_UPLOAD_CLEANUP_JOB } from './coManagedUploadCleanupHandler';
import { getJobDescriptor } from '../jobDescriptors';

beforeEach(() => { vi.resetAllMocks(); resetUploadCleanupAdapters(); });

describe('one upload-cleanup handler, two adapters (A3)', () => {
  it('runs the co-managed adapter (uploads and thread transfers) and every adapter registered beside it, in order', async () => {
    mocks.uploads.mockResolvedValue({ purgedFiles: 2 }); mocks.transfers.mockResolvedValue({ purged: 1 });
    const base = vi.fn().mockResolvedValue({ removed: 3 });
    registerUploadCleanupAdapter({ name: 'comment-attachment-drafts', run: base });
    const out = await coManagedUploadCleanupHandler({ tenantId: 'tenant', limit: 5 });
    expect(Object.keys(out)).toEqual(['co-managed', 'comment-attachment-drafts']);
    expect(mocks.uploads).toHaveBeenCalledWith('db', 'tenant', expect.any(Function), 5);
    expect(mocks.transfers).toHaveBeenCalledWith('db', 'tenant', expect.any(Function), 5);
    expect(base).toHaveBeenCalledWith('tenant', 5);
  });
  it('re-registering an adapter by name replaces it rather than doubling the sweep', async () => {
    const a = vi.fn().mockResolvedValue(1), b = vi.fn().mockResolvedValue(2);
    mocks.uploads.mockResolvedValue({}); mocks.transfers.mockResolvedValue({});
    registerUploadCleanupAdapter({ name: 'x', run: a }); registerUploadCleanupAdapter({ name: 'x', run: b });
    await coManagedUploadCleanupHandler({ tenantId: 'tenant' });
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1);
  });
  it('is declared as data, capability-gated and idempotent', () => {
    registerCoManagedUploadCleanupJob(); registerCoManagedUploadCleanupJob();
    expect(getJobDescriptor(CO_MANAGED_UPLOAD_CLEANUP_JOB)).toMatchObject({ scope: 'tenant', capability: 'co-managed' });
  });
});
