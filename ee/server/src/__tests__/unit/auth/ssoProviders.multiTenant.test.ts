import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUsersByEmailAndTypeMock = vi.fn();
const findUserByEmailTenantAndTypeMock = vi.fn();

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => {
    const chain: Record<string, unknown> = {};
    for (const key of ['select', 'whereRaw', 'andWhereRaw', 'where']) chain[key] = () => chain;
    chain.first = async () => undefined;
    return () => chain;
  },
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUsersByEmailAndType: (...args: unknown[]) => findUsersByEmailAndTypeMock(...args),
    findUserByEmailTenantAndType: (...args: unknown[]) => findUserByEmailTenantAndTypeMock(...args),
  },
}));

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

const internalUser = (tenant: string, id: string, extra: Record<string, unknown> = {}) => ({
  user_id: id,
  email: 'multi@example.com',
  username: 'multi',
  first_name: 'Mu',
  last_name: 'Lti',
  user_type: 'internal',
  tenant,
  is_inactive: false,
  created_at: '2024-01-01T00:00:00Z',
  ...extra,
});

async function mapper() {
  return import('../../../lib/auth/ssoProviders');
}

describe('EE internal SSO resolution across organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tenant_required when the email is active in several tenants and no scope is trusted', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValueOnce([internalUser(tenantA, 'u-a'), internalUser(tenantB, 'u-b')]);
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'multi@example.com',
      profile: {},
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure).toMatchObject({ code: 'tenant_required', userType: 'internal' });
    expect(mapped.id).toBe('');
  });

  it('resolves inside the trusted scopeTenantId', async () => {
    findUserByEmailTenantAndTypeMock.mockResolvedValueOnce(internalUser(tenantB, 'u-b'));
    const { mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'multi@example.com',
      profile: {},
      scopeTenantId: tenantB,
    });

    expect(mapped).toMatchObject({ id: 'u-b', tenant: tenantB });
    expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith('multi@example.com', tenantB, 'internal');
    expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  it('never lets IdP claims (hd / tid / tenantHint) pick the tenant for an internal user', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValueOnce([internalUser(tenantA, 'u-a'), internalUser(tenantB, 'u-b')]);
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: 'multi@example.com',
      profile: { tid: tenantB, hd: tenantB },
      tenantHint: tenantB,
      vanityHostHint: tenantB,
    } as any);

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure?.code).toBe('tenant_required');
    expect(findUserByEmailTenantAndTypeMock).not.toHaveBeenCalled();
  });

  it('applyOAuthAccountHints does not apply a tenant hint to an internal user', async () => {
    const { applyOAuthAccountHints } = await mapper();
    const user: any = { id: 'u-a', user_type: 'internal', tenant: tenantA };
    const result: any = await applyOAuthAccountHints(user, {
      provider: 'microsoft',
      account: { provider: 'azure-ad' } as any,
      profile: { tid: tenantB },
      tenantIdFromHints: tenantB,
    } as any);
    expect((result ?? user).tenant).toBe(tenantA);
  });
});
