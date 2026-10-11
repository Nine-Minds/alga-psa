import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    findUserByEmailAndType: (...args: unknown[]) => findUserByEmailAndTypeMock(...args),
    findUserByEmailTenantAndType: (...args: unknown[]) =>
      findUserByEmailTenantAndTypeMock(...args),
  },
}));

// Auth.js turns anything thrown from a provider's profile() callback into the
// opaque `error=Configuration` page, so these expected outcomes must come back
// as a sentinel result that callbacks.signIn can translate into a readable
// redirect.
describe('OAuth profile mapping reports expected failures instead of throwing', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mapper() {
    return import('../../../lib/auth/ssoProviders');
  }

  it('returns missing_email when the provider profile carries no email', async () => {
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: undefined,
      profile: { oid: 'provider-object-id' },
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure).toEqual({
      code: 'missing_email',
      providerEmail: undefined,
      userType: 'internal',
    });
    expect(mapped.id).toBe('');
    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  it('returns no_matching_user with the provider email when no AlgaPSA user matches', async () => {
    findUserByEmailAndTypeMock.mockResolvedValueOnce(undefined);
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: 'ND@computerbutlereurope.onmicrosoft.com',
      profile: {},
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure).toEqual({
      code: 'no_matching_user',
      providerEmail: 'nd@computerbutlereurope.onmicrosoft.com',
      userType: 'internal',
    });
    expect(mapped.id).toBe('');
  });

  it('returns inactive_user for a deactivated AlgaPSA user', async () => {
    findUserByEmailAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-inactive',
      email: 'inactive@example.com',
      username: 'inactive',
      user_type: 'internal',
      tenant: tenantId,
      is_inactive: true,
    });
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'inactive@example.com',
      profile: {},
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure?.code).toBe('inactive_user');
    expect(mapped.id).toBe('');
  });

  it('returns user_type_mismatch when the stored user type is not the requested one', async () => {
    findUserByEmailAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-client',
      email: 'client@example.com',
      username: 'client',
      user_type: 'client',
      tenant: tenantId,
      is_inactive: false,
    });
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'client@example.com',
      profile: {},
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure?.code).toBe('user_type_mismatch');
  });

  it('returns tenant_mismatch when a client portal user belongs to another tenant', async () => {
    findUserByEmailTenantAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-portal',
      email: 'portal@example.com',
      username: 'portal',
      user_type: 'client',
      tenant: otherTenantId,
      is_inactive: false,
      contact_id: 'contact-1',
    });
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'google',
      email: 'portal@example.com',
      profile: {},
      tenantHint: tenantId,
      userTypeHint: 'client',
    });

    expect(isOAuthMappingFailure(mapped)).toBe(true);
    expect(mapped.authFailure).toEqual({
      code: 'tenant_mismatch',
      providerEmail: 'portal@example.com',
      userType: 'client',
    });
  });

  it('leaves the success path untouched', async () => {
    findUserByEmailAndTypeMock.mockResolvedValueOnce({
      user_id: 'user-ok',
      email: 'ok@example.com',
      username: 'ok',
      first_name: 'Oliver',
      last_name: 'King',
      user_type: 'internal',
      tenant: tenantId,
      is_inactive: false,
    });
    const { isOAuthMappingFailure, mapOAuthProfileToExtendedUser } = await mapper();

    const mapped = await mapOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: 'ok@example.com',
      profile: {},
    });

    expect(isOAuthMappingFailure(mapped)).toBe(false);
    expect(mapped.authFailure).toBeUndefined();
    expect(mapped).toMatchObject({
      id: 'user-ok',
      email: 'ok@example.com',
      name: 'Oliver King',
      user_type: 'internal',
      tenant: tenantId,
    });
  });
});
