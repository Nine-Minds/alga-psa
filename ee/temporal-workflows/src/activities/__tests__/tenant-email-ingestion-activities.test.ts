import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  tenantDb: vi.fn(),
  pauseProvider: vi.fn(),
  resumeProvider: vi.fn(),
  teardownProviderSubscriptions: vi.fn(),
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: mocks.tenantDb,
}));

vi.mock('@alga-psa/shared/services/email/EmailProviderLifecycleService.js', () => ({
  EmailProviderLifecycleService: class {
    pauseProvider = mocks.pauseProvider;
    resumeProvider = mocks.resumeProvider;
    teardownProviderSubscriptions = mocks.teardownProviderSubscriptions;
  },
}));

import {
  resumeTenantEmailIngestion,
  suspendTenantEmailIngestion,
  teardownTenantEmailIngestion,
} from '../tenant-email-ingestion-activities.js';

function providerQuery(providers: Array<{ id: string }>) {
  const query = {
    where: vi.fn(),
    whereNull: vi.fn(),
    whereNotNull: vi.fn(),
    select: vi.fn(),
  };
  query.where.mockReturnValue(query);
  query.whereNull.mockReturnValue(query);
  query.whereNotNull.mockReturnValue(query);
  query.select.mockResolvedValue(providers);
  return query;
}

describe('tenant email ingestion activities', () => {
  const tenantId = 'tenant-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue({ connection: 'admin' });
  });

  it('suspends every active, unpaused provider with the cancellation reason', async () => {
    const query = providerQuery([{ id: 'provider-1' }, { id: 'provider-2' }]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn().mockReturnValue(query) });
    mocks.pauseProvider.mockResolvedValue(true);

    await expect(suspendTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 2,
      completedCount: 2,
      errorCount: 0,
    });

    expect(mocks.tenantDb).toHaveBeenCalledWith({ connection: 'admin' }, tenantId);
    expect(query.where).toHaveBeenCalledWith({ is_active: true });
    expect(query.whereNull).toHaveBeenCalledWith('inbound_paused_at');
    expect(mocks.pauseProvider).toHaveBeenNthCalledWith(
      1,
      'provider-1',
      tenantId,
      'tenant_cancelled',
    );
    expect(mocks.pauseProvider).toHaveBeenNthCalledWith(
      2,
      'provider-2',
      tenantId,
      'tenant_cancelled',
    );
  });

  it('does not select already-paused providers, preserving manual pauses', async () => {
    const query = providerQuery([]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn().mockReturnValue(query) });

    await expect(suspendTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 0,
      completedCount: 0,
      errorCount: 0,
    });

    expect(query.whereNull).toHaveBeenCalledWith('inbound_paused_at');
    expect(mocks.pauseProvider).not.toHaveBeenCalled();
  });

  it('continues after one provider fails and never rejects the activity', async () => {
    const query = providerQuery([{ id: 'provider-bad' }, { id: 'provider-good' }]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn().mockReturnValue(query) });
    mocks.pauseProvider
      .mockRejectedValueOnce(new Error('Graph unavailable'))
      .mockResolvedValueOnce(true);

    await expect(suspendTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 2,
      completedCount: 1,
      errorCount: 1,
    });
    expect(mocks.pauseProvider).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when rerun after all providers are paused', async () => {
    const firstQuery = providerQuery([{ id: 'provider-1' }]);
    const secondQuery = providerQuery([]);
    const table = vi.fn()
      .mockReturnValueOnce(firstQuery)
      .mockReturnValueOnce(secondQuery);
    mocks.tenantDb.mockReturnValue({ table });
    mocks.pauseProvider.mockResolvedValue(true);

    await suspendTenantEmailIngestion(tenantId);
    await expect(suspendTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 0,
      completedCount: 0,
      errorCount: 0,
    });
    expect(mocks.pauseProvider).toHaveBeenCalledTimes(1);
  });

  it('resumes only cancellation-owned pauses and contains registration errors', async () => {
    const query = providerQuery([{ id: 'provider-cancelled' }, { id: 'provider-expired-token' }]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn().mockReturnValue(query) });
    mocks.resumeProvider
      .mockResolvedValueOnce({ resumed: true })
      .mockResolvedValueOnce({ resumed: true, error: 'OAuth token expired' });

    await expect(resumeTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 2,
      completedCount: 2,
      errorCount: 1,
    });

    expect(query.where).toHaveBeenCalledWith({
      inbound_pause_reason: 'tenant_cancelled',
    });
    expect(query.whereNotNull).toHaveBeenCalledWith('inbound_paused_at');
    expect(mocks.resumeProvider).toHaveBeenNthCalledWith(
      1,
      'provider-cancelled',
      tenantId,
    );
    expect(mocks.resumeProvider).toHaveBeenNthCalledWith(
      2,
      'provider-expired-token',
      tenantId,
    );
  });

  it('tears down every remaining provider and isolates missing remote subscriptions', async () => {
    const query = providerQuery([{ id: 'provider-gone' }, { id: 'provider-live' }]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn().mockReturnValue(query) });
    mocks.teardownProviderSubscriptions
      .mockRejectedValueOnce(new Error('subscription not found'))
      .mockResolvedValueOnce(undefined);

    await expect(teardownTenantEmailIngestion(tenantId)).resolves.toEqual({
      matchedCount: 2,
      completedCount: 1,
      errorCount: 1,
    });
    expect(mocks.teardownProviderSubscriptions).toHaveBeenCalledTimes(2);
  });
});
