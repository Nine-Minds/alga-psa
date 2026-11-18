import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUsersByEmailAndTypeMock = vi.fn();
const findUserByEmailTenantAndTypeMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUsersByEmailAndType: (...args: unknown[]) => findUsersByEmailAndTypeMock(...args),
    findUserByEmailTenantAndType: (...args: unknown[]) => findUserByEmailTenantAndTypeMock(...args),
  },
}));

const baseUser = (overrides: Record<string, unknown>) => ({
  hashed_password: 'hashed',
  user_type: 'internal',
  is_inactive: false,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

import { mapCeOAuthProfileToExtendedUser } from './ceOAuthProfileMapper';

describe('CE OAuth profile mapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T053: resolves internal user by normalized email for Microsoft profile', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([baseUser({
      user_id: 'u-1',
      email: 'admin@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      hashed_password: 'hashed',
      tenant: 'tenant-1',
      user_type: 'internal',
      is_inactive: false,
    })]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: '  ADMIN@example.com ',
      profile: { tid: 'tenant' },
      image: 'https://example.com/a.png',
    } as any);

    expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith('admin@example.com', 'internal');
    expect(result).toMatchObject({
      id: 'u-1',
      email: 'admin@example.com',
      name: 'Ada Lovelace',
      user_type: 'internal',
      tenant: 'tenant-1',
    });
  });

  it('T054: resolves internal user by normalized email for Google profile', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([baseUser({
      user_id: 'u-2',
      email: 'google-user@example.com',
      username: 'googler',
      hashed_password: 'hashed',
      tenant: 'tenant-2',
      user_type: 'internal',
      is_inactive: false,
    })]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'google',
      email: ' GOOGLE-USER@example.com ',
      profile: { sub: 'google-sub' },
    } as any);

    expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith('google-user@example.com', 'internal');
    expect(result).toMatchObject({
      id: 'u-2',
      email: 'google-user@example.com',
      username: 'googler',
      user_type: 'internal',
      tenant: 'tenant-2',
    });
  });

  it('resolves internal user by email for a Keycloak profile and ignores non-standard realm claims', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([baseUser({
      user_id: 'u-kc',
      email: 'kc-user@example.com',
      username: 'kc',
      hashed_password: 'hashed',
      tenant: 'tenant-kc',
      user_type: 'internal',
      is_inactive: false,
    })]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'keycloak',
      email: 'KC-User@example.com',
      profile: { sub: 'keycloak-uuid', preferred_username: 'kc', tenant: undefined, user_type: undefined },
    } as any);

    expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith('kc-user@example.com', 'internal');
    expect(result).toMatchObject({
      id: 'u-kc',
      tenant: 'tenant-kc',
      user_type: 'internal',
    });
    expect(result.id).not.toBe('keycloak-uuid');
  });

  it('T055: rejects inactive user accounts', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([baseUser({
      user_id: 'u-3',
      email: 'inactive@example.com',
      username: 'inactive',
      tenant: 'tenant-3',
      user_type: 'internal',
      is_inactive: true,
    })]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'inactive@example.com',
      profile: {},
    } as any);

    expect(result.authFailure).toEqual({
      code: 'inactive_user',
      providerEmail: 'inactive@example.com',
      userType: 'internal',
    });
    expect(result.id).toBe('');
  });

  it('T056: rejects non-internal user types for MSP OAuth flow', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([baseUser({
      user_id: 'u-4',
      email: 'client@example.com',
      username: 'client-user',
      tenant: 'tenant-4',
      user_type: 'client',
      is_inactive: false,
    })]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: 'client@example.com',
      profile: {},
    } as any);

    expect(result.authFailure).toEqual({
      code: 'user_type_mismatch',
      providerEmail: 'client@example.com',
      userType: 'internal',
    });
    expect(result.id).toBe('');
  });

  it('T045: unknown OAuth users report a no_matching_user sentinel instead of throwing', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValueOnce([]);

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'ghost@example.com',
      profile: {},
    } as any);

    expect(result.authFailure).toEqual({
      code: 'no_matching_user',
      providerEmail: 'ghost@example.com',
      userType: 'internal',
    });
    expect(result.id).toBe('');
  });

  it('reports missing_email when the provider profile carries no email address', async () => {
    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: '   ',
      profile: {},
    } as any);

    expect(result.authFailure).toEqual({
      code: 'missing_email',
      providerEmail: undefined,
      userType: 'internal',
    });
    expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  describe('multi-tenant emails', () => {
    const inTenant = (tenant: string, id: string) =>
      baseUser({ user_id: id, email: 'dual@example.com', username: id, tenant });

    it('reports tenant_required when the email is a live internal user in several tenants and no scope is trusted', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([inTenant('t-a', 'u-a'), inTenant('t-b', 'u-b')]);

      const result = await mapCeOAuthProfileToExtendedUser({
        provider: 'google',
        email: 'dual@example.com',
        // IdP claims must not pick a tenant for an internal user.
        tenantHint: 't-b',
        profile: { hd: 't-b', tid: 't-b' },
      } as any);

      expect(result.authFailure).toEqual({
        code: 'tenant_required',
        providerEmail: 'dual@example.com',
        userType: 'internal',
      });
      expect(findUserByEmailTenantAndTypeMock).not.toHaveBeenCalled();
    });

    it('resolves inside the trusted scope when one is supplied', async () => {
      findUserByEmailTenantAndTypeMock.mockResolvedValue(inTenant('t-b', 'u-b'));

      const result = await mapCeOAuthProfileToExtendedUser({
        provider: 'google',
        email: 'dual@example.com',
        scopeTenantId: 't-b',
        profile: {},
      } as any);

      expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith('dual@example.com', 't-b', 'internal');
      expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'u-b', tenant: 't-b' });
    });

    it('reports no_matching_user when the scoped tenant has no such user, even if another tenant does', async () => {
      findUserByEmailTenantAndTypeMock.mockResolvedValue(undefined);

      const result = await mapCeOAuthProfileToExtendedUser({
        provider: 'microsoft',
        email: 'dual@example.com',
        scopeTenantId: 't-c',
        profile: {},
      } as any);

      expect(result.authFailure?.code).toBe('no_matching_user');
    });
  });
});
