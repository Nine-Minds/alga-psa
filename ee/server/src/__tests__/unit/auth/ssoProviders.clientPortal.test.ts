import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUserByEmailMock = vi.fn();
const findUserByEmailAndTypeMock = vi.fn();
const findUserByEmailTenantAndTypeMock = vi.fn();

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => {
    const chain = {
      select: () => chain,
      whereRaw: () => chain,
      andWhereRaw: () => chain,
      where: () => chain,
      first: async () => undefined,
    };
    return () => chain;
  },
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmail: (...args: unknown[]) => findUserByEmailMock(...args),
    findUserByEmailAndType: (...args: unknown[]) => findUserByEmailAndTypeMock(...args),
    findUserByEmailTenantAndType: (...args: unknown[]) => findUserByEmailTenantAndTypeMock(...args),
  },
}));

describe('client portal OAuth profile mapping', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T005: authenticates only active tenant-scoped client users when user_type=client is requested', async () => {
    findUserByEmailTenantAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-1',
      email: 'client@example.com',
      username: 'client1',
      first_name: 'Client',
      last_name: 'User',
      user_type: 'client',
      tenant: tenantId,
      is_inactive: false,
      contact_id: 'contact-1',
      client_id: 'client-1',
    });

    const { mapOAuthProfileToExtendedUser } = await import('../../../lib/auth/ssoProviders');
    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'client@example.com',
      profile: {},
      tenantHint: tenantId,
      userTypeHint: 'client',
    });

    expect(mapped.user_type).toBe('client');
    expect(mapped.tenant).toBe(tenantId);
    expect(findUserByEmailMock).not.toHaveBeenCalled();
    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  it('T005: rejects internal users for client portal OAuth mode', async () => {
    findUserByEmailTenantAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-2',
      email: 'internal@example.com',
      username: 'internal',
      first_name: 'Internal',
      last_name: 'User',
      user_type: 'internal',
      tenant: tenantId,
      is_inactive: false,
    });

    const { mapOAuthProfileToExtendedUser } = await import('../../../lib/auth/ssoProviders');
    await expect(
      mapOAuthProfileToExtendedUser({
        provider: 'microsoft',
        email: 'internal@example.com',
        profile: {},
        tenantHint: tenantId,
        userTypeHint: 'client',
      })
    ).rejects.toThrow('User not found');
  });
});
