import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  isTenantSuspended: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alga-psa/db', () => ({
  getAdminConnection: mocks.getAdminConnection,
  isTenantSuspended: mocks.isTenantSuspended,
}));

import { JobHandlerRegistry } from './jobHandlerRegistry';

describe('JobHandlerRegistry tenant suspension gate', () => {
  const handler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    JobHandlerRegistry.clear();
    JobHandlerRegistry.register({ name: 'test-job', handler } as any);
    mocks.getAdminConnection.mockResolvedValue({ conn: 'admin' });
    mocks.isTenantSuspended.mockResolvedValue(false);
  });

  it('T015: skips the handler for a suspended tenant and resolves successfully', async () => {
    mocks.isTenantSuspended.mockResolvedValue(true);

    await expect(
      JobHandlerRegistry.execute('test-job', 'job-1', { tenantId: 'tenant-suspended' })
    ).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(mocks.isTenantSuspended).toHaveBeenCalledWith({ conn: 'admin' }, 'tenant-suspended');
  });

  it('T016: runs handlers for non-suspended tenants and for jobs without tenantId', async () => {
    await JobHandlerRegistry.execute('test-job', 'job-2', { tenantId: 'tenant-active' });
    expect(handler).toHaveBeenCalledWith('job-2', { tenantId: 'tenant-active' });

    handler.mockClear();
    mocks.isTenantSuspended.mockClear();
    await JobHandlerRegistry.execute('test-job', 'job-3', {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.isTenantSuspended).not.toHaveBeenCalled();
  });

  it('T017: fails open when the suspension probe errors', async () => {
    mocks.getAdminConnection.mockRejectedValue(new Error('db unreachable'));

    await JobHandlerRegistry.execute('test-job', 'job-4', { tenantId: 'tenant-active' });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
