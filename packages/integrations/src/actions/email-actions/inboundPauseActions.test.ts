import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  createTenantKnex: vi.fn(),
  providerRow: { id: 'provider-1' } as { id: string } | null,
  pauseProvider: vi.fn(),
  resumeProvider: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: () => {
      const builder: any = {
        where: () => builder,
        first: async () => mocks.providerRow,
      };
      return builder;
    },
  }),
}));
vi.mock('../../services/email/EmailProviderService', () => ({
  EmailProviderService: vi.fn(function EmailProviderService() {
    return {
      pauseProvider: mocks.pauseProvider,
      resumeProvider: mocks.resumeProvider,
    };
  }),
}));

import { pauseEmailProvider, resumeEmailProvider } from './inboundPauseActions';

describe('inbound pause provider actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerRow = { id: 'provider-1' };
    mocks.createTenantKnex.mockResolvedValue({ knex: {} });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.pauseProvider.mockResolvedValue(true);
    mocks.resumeProvider.mockResolvedValue({ resumed: true, webhookRegistered: true });
  });

  it('T034: rejects unauthorized callers and authorized pause uses manual reason', async () => {
    mocks.hasPermission.mockResolvedValueOnce(false);
    await expect(pauseEmailProvider('provider-1')).resolves.toEqual({
      success: false,
      error: 'Permission denied',
    });
    expect(mocks.pauseProvider).not.toHaveBeenCalled();

    mocks.hasPermission.mockResolvedValueOnce(true);
    await expect(pauseEmailProvider('provider-1')).resolves.toEqual({ success: true });
    expect(mocks.pauseProvider).toHaveBeenCalledWith(
      'provider-1',
      'tenant-1',
      'manual'
    );
  });

  it('T035: rejects cross-tenant ids and resumes a tenant-scoped provider', async () => {
    mocks.providerRow = null;
    await expect(resumeEmailProvider('provider-other-tenant')).resolves.toEqual({
      success: false,
      error: 'Email provider not found',
    });
    expect(mocks.resumeProvider).not.toHaveBeenCalled();

    mocks.providerRow = { id: 'provider-1' };
    await expect(resumeEmailProvider('provider-1')).resolves.toMatchObject({
      success: true,
      resumed: true,
      webhookRegistered: true,
    });
    expect(mocks.resumeProvider).toHaveBeenCalledWith('provider-1', 'tenant-1');
  });
});
