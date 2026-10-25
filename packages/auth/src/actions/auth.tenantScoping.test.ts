import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUserByEmailTenantAndTypeMock = vi.fn();
const findUserByEmailAndTypeMock = vi.fn();
const findUsersByEmailAndTypeMock = vi.fn();
const findUserByEmailMock = vi.fn();
const getTenantIdBySlugMock = vi.fn();
const getPortalDomainByHostnameMock = vi.fn();
const verifyPasswordMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmailTenantAndType: (...args: unknown[]) => findUserByEmailTenantAndTypeMock(...args),
    findUserByEmailAndType: (...args: unknown[]) => findUserByEmailAndTypeMock(...args),
    findUsersByEmailAndType: (...args: unknown[]) => findUsersByEmailAndTypeMock(...args),
    findUserByEmail: (...args: unknown[]) => findUserByEmailMock(...args),
  },
}));

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlugMock(...args),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => ({}),
}));

vi.mock('../lib/PortalDomainModel', () => ({
  getPortalDomainByHostname: (...args: unknown[]) => getPortalDomainByHostnameMock(...args),
}));

vi.mock('@alga-psa/core/encryption', () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    system: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));

vi.mock('../lib/winback/enterpriseWinbackEntry', () => ({
  loadEnterpriseInactiveLoginWinbackHook: async () => null,
}));

import { authenticateUser } from './auth';

const NINE_MINDS_TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_MSP_TENANT = '22222222-2222-2222-2222-222222222222';
const NINE_MINDS_SLUG = '111111111111';

function clientUser(tenant: string, userId: string) {
  return {
    user_id: userId,
    email: 'tinus@example.com',
    first_name: 'Tinus',
    last_name: 'Client',
    username: 'tinus@example.com',
    hashed_password: `hash-${userId}`,
    tenant,
    user_type: 'client',
    is_inactive: false,
  };
}

describe('authenticateUser tenant scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPasswordMock.mockResolvedValue(true);
  });

  it('scopes a vanity-derived tenant slug to that tenant even when the email exists in two tenants', async () => {
    getTenantIdBySlugMock.mockResolvedValue(NINE_MINDS_TENANT);
    findUserByEmailTenantAndTypeMock.mockResolvedValue(clientUser(NINE_MINDS_TENANT, 'u-nine'));

    const user = await authenticateUser('Tinus@example.com', 'correct-horse', 'client', {
      tenantSlug: NINE_MINDS_SLUG,
      requireTenantMatch: true,
    });

    expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith(
      'tinus@example.com',
      NINE_MINDS_TENANT,
      'client',
    );
    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
    expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
    expect(user?.tenant).toBe(NINE_MINDS_TENANT);
  });

  it('refuses an unscoped client login whose email spans tenants with TENANT_REQUIRED', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      clientUser(OTHER_MSP_TENANT, 'u-other'),
      clientUser(NINE_MINDS_TENANT, 'u-nine'),
    ]);

    await expect(
      authenticateUser('tinus@example.com', 'correct-horse', 'client'),
    ).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });

    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  it('reports invalid credentials rather than the tenant ambiguity when the password is wrong', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      clientUser(OTHER_MSP_TENANT, 'u-other'),
      clientUser(NINE_MINDS_TENANT, 'u-nine'),
    ]);
    verifyPasswordMock.mockResolvedValue(false);

    await expect(authenticateUser('tinus@example.com', 'guess', 'client')).resolves.toBeNull();
  });

  it('keeps signing in a single-tenant client user without a tenant hint', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([clientUser(NINE_MINDS_TENANT, 'u-nine')]);

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');

    expect(user?.user_id).toBe('u-nine');
    expect(user?.tenant).toBe(NINE_MINDS_TENANT);
  });

  it('signs in duplicate client users that live in the same tenant', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      clientUser(NINE_MINDS_TENANT, 'u-nine'),
      clientUser(NINE_MINDS_TENANT, 'u-nine-dup'),
    ]);

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');

    expect(user?.tenant).toBe(NINE_MINDS_TENANT);
  });

  it('resolves the tenant from an active portal domain and scopes the lookup to it', async () => {
    getPortalDomainByHostnameMock.mockResolvedValue({
      tenant: NINE_MINDS_TENANT,
      domain: 'portal.nineminds.com',
      status: 'active',
    });
    findUserByEmailTenantAndTypeMock.mockResolvedValue(clientUser(NINE_MINDS_TENANT, 'u-nine'));

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client', {
      portalDomain: 'Portal.NineMinds.com',
    });

    expect(getPortalDomainByHostnameMock).toHaveBeenCalledWith({}, 'portal.nineminds.com');
    expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith(
      'tinus@example.com',
      NINE_MINDS_TENANT,
      'client',
    );
    expect(user?.tenant).toBe(NINE_MINDS_TENANT);
  });

  it('ignores a portal domain whose row is not active and stays ambiguity-safe', async () => {
    getPortalDomainByHostnameMock.mockResolvedValue({
      tenant: NINE_MINDS_TENANT,
      domain: 'portal.nineminds.com',
      status: 'pending_dns',
    });
    findUsersByEmailAndTypeMock.mockResolvedValue([
      clientUser(OTHER_MSP_TENANT, 'u-other'),
      clientUser(NINE_MINDS_TENANT, 'u-nine'),
    ]);

    await expect(
      authenticateUser('tinus@example.com', 'correct-horse', 'client', {
        portalDomain: 'portal.nineminds.com',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });

    expect(findUserByEmailTenantAndTypeMock).not.toHaveBeenCalled();
  });

  it('signs in a single internal user through the ambiguity-safe discovery path', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([{
      ...clientUser(NINE_MINDS_TENANT, 'u-msp'),
      user_type: 'internal',
    }]);

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'internal');

    expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith('tinus@example.com', 'internal');
    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
    expect(user?.user_type).toBe('internal');
  });

  it('keeps an inactive restored internal identity from shadowing the live customer administrator', async () => {
    const live = { ...clientUser(NINE_MINDS_TENANT, 'u-live'), user_type: 'internal' };
    const restored = { ...clientUser(OTHER_MSP_TENANT, 'u-restored'), user_type: 'internal', is_inactive: true };
    findUsersByEmailAndTypeMock.mockResolvedValue([restored, live]);

    expect(await authenticateUser('tinus@example.com', 'correct-horse', 'internal')).toEqual(live);
    expect(verifyPasswordMock).not.toHaveBeenCalledWith('correct-horse', restored.hashed_password);
    expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
  });

  it('refuses equally valid internal credentials in different live tenants', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      { ...clientUser(NINE_MINDS_TENANT, 'u-one'), user_type: 'internal' },
      { ...clientUser(OTHER_MSP_TENANT, 'u-two'), user_type: 'internal' },
    ]);

    await expect(authenticateUser('tinus@example.com', 'correct-horse', 'internal'))
      .rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });

  it('does not reveal internal tenant ambiguity for an incorrect password', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      { ...clientUser(NINE_MINDS_TENANT, 'u-one'), user_type: 'internal' },
      { ...clientUser(OTHER_MSP_TENANT, 'u-two'), user_type: 'internal' },
    ]);
    verifyPasswordMock.mockResolvedValue(false);

    await expect(authenticateUser('tinus@example.com', 'guess', 'internal')).resolves.toBeNull();
  });

  it('does not authenticate when all restored internal identities are inactive', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      { ...clientUser(NINE_MINDS_TENANT, 'u-one'), user_type: 'internal', is_inactive: true },
      { ...clientUser(OTHER_MSP_TENANT, 'u-two'), user_type: 'internal', is_inactive: true },
    ]);

    await expect(authenticateUser('tinus@example.com', 'correct-horse', 'internal')).resolves.toBeNull();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('keeps an explicit internal tenant hint scoped, including an inactive restored account', async () => {
    findUserByEmailTenantAndTypeMock.mockResolvedValue({
      ...clientUser(OTHER_MSP_TENANT, 'u-restored'), user_type: 'internal', is_inactive: true,
    });

    await expect(authenticateUser('tinus@example.com', 'correct-horse', 'internal', {
      tenantId: OTHER_MSP_TENANT, requireTenantMatch: true,
    })).resolves.toBeNull();
    expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
    expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith('tinus@example.com', OTHER_MSP_TENANT, 'internal');
  });
});
