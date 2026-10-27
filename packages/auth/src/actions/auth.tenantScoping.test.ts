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

  it('resolves same-tenant duplicates to the oldest account whatever order the database returns', async () => {
    const older = { ...clientUser(NINE_MINDS_TENANT, 'u-b-older'), created_at: '2024-01-01T00:00:00Z' };
    const newer = { ...clientUser(NINE_MINDS_TENANT, 'u-a-newer'), created_at: '2025-06-01T00:00:00Z' };

    for (const rows of [[older, newer], [newer, older]]) {
      findUsersByEmailAndTypeMock.mockResolvedValue(rows);
      const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');
      expect(user?.user_id).toBe('u-b-older');
    }
  });

  it('breaks a created_at tie on user_id', async () => {
    const createdAt = '2024-01-01T00:00:00Z';
    const first = { ...clientUser(NINE_MINDS_TENANT, 'u-1'), created_at: createdAt };
    const second = { ...clientUser(NINE_MINDS_TENANT, 'u-2'), created_at: createdAt };

    for (const rows of [[first, second], [second, first]]) {
      findUsersByEmailAndTypeMock.mockResolvedValue(rows);
      const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');
      expect(user?.user_id).toBe('u-1');
    }
  });

  it('checks each duplicate password once and does not re-check the winner', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      clientUser(NINE_MINDS_TENANT, 'u-nine'),
      clientUser(NINE_MINDS_TENANT, 'u-nine-dup'),
    ]);

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');

    expect(user).not.toBeNull();
    expect(verifyPasswordMock).toHaveBeenCalledTimes(2);
    expect(verifyPasswordMock).toHaveBeenCalledWith('correct-horse', 'hash-u-nine');
    expect(verifyPasswordMock).toHaveBeenCalledWith('correct-horse', 'hash-u-nine-dup');
  });

  it('only signs in the duplicate whose password matches', async () => {
    findUsersByEmailAndTypeMock.mockResolvedValue([
      { ...clientUser(NINE_MINDS_TENANT, 'u-old'), created_at: '2024-01-01T00:00:00Z' },
      { ...clientUser(NINE_MINDS_TENANT, 'u-new'), created_at: '2025-01-01T00:00:00Z' },
    ]);
    verifyPasswordMock.mockImplementation(async (_password: string, hash: string) => hash === 'hash-u-new');

    const user = await authenticateUser('tinus@example.com', 'correct-horse', 'client');

    expect(user?.user_id).toBe('u-new');
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

  // Writers store trimmed, lowercased email; the lookup must ask for exactly
  // that string, or a pasted address with padding misses a valid account.
  describe('padded identifiers', () => {
    const PADDED = '  Tinus@Example.com \t';
    const STORED = 'tinus@example.com';

    it('looks up the stored form on the unscoped path', async () => {
      findUsersByEmailAndTypeMock.mockImplementation(async (email: string) =>
        email === STORED ? [clientUser(NINE_MINDS_TENANT, 'u-nine')] : [],
      );

      const user = await authenticateUser(PADDED, 'correct-horse', 'client');

      expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith(STORED, 'client');
      expect(user?.user_id).toBe('u-nine');
    });

    it('looks up the stored form on the tenant-scoped path', async () => {
      getTenantIdBySlugMock.mockResolvedValue(NINE_MINDS_TENANT);
      findUserByEmailTenantAndTypeMock.mockImplementation(async (email: string) =>
        email === STORED ? clientUser(NINE_MINDS_TENANT, 'u-nine') : undefined,
      );

      const user = await authenticateUser(PADDED, 'correct-horse', 'client', {
        tenantSlug: NINE_MINDS_SLUG,
        requireTenantMatch: true,
      });

      expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith(STORED, NINE_MINDS_TENANT, 'client');
      expect(user?.user_id).toBe('u-nine');
    });

    it('treats a whitespace-only email as missing', async () => {
      await expect(authenticateUser('   ', 'correct-horse', 'client')).resolves.toBeNull();
      expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
    });
  });

  describe('internal (MSP) logins', () => {
    function internalUser(tenant: string, userId: string, overrides: Record<string, unknown> = {}) {
      return { ...clientUser(tenant, userId), user_type: 'internal', ...overrides };
    }

    it('signs in a single internal match through the discovery path, never the .first() lookup', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([internalUser(NINE_MINDS_TENANT, 'u-msp')]);

      const user = await authenticateUser('tinus@example.com', 'correct-horse', 'internal');

      expect(findUsersByEmailAndTypeMock).toHaveBeenCalledWith('tinus@example.com', 'internal');
      expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
      expect(user?.user_id).toBe('u-msp');
    });

    it('does not let an inactive restored duplicate shadow the live user', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([
        internalUser(OTHER_MSP_TENANT, 'u-restored', { is_inactive: true }),
        internalUser(NINE_MINDS_TENANT, 'u-live'),
      ]);

      const user = await authenticateUser('tinus@example.com', 'correct-horse', 'internal');

      expect(user?.user_id).toBe('u-live');
      // The inactive identity is never password-checked.
      expect(verifyPasswordMock).not.toHaveBeenCalledWith('correct-horse', 'hash-u-restored');
      expect(verifyPasswordMock).toHaveBeenCalledWith('correct-horse', 'hash-u-live');
    });

    it('refuses equal live credentials in two tenants with TENANT_REQUIRED', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([
        internalUser(OTHER_MSP_TENANT, 'u-other'),
        internalUser(NINE_MINDS_TENANT, 'u-nine'),
      ]);

      await expect(
        authenticateUser('tinus@example.com', 'correct-horse', 'internal'),
      ).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      expect(findUserByEmailAndTypeMock).not.toHaveBeenCalled();
    });

    it('returns null for a wrong password without disclosing the ambiguity', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([
        internalUser(OTHER_MSP_TENANT, 'u-other'),
        internalUser(NINE_MINDS_TENANT, 'u-nine'),
      ]);
      verifyPasswordMock.mockResolvedValue(false);

      await expect(authenticateUser('tinus@example.com', 'guess', 'internal')).resolves.toBeNull();
    });

    it('returns null when every match is inactive', async () => {
      findUsersByEmailAndTypeMock.mockResolvedValue([
        internalUser(OTHER_MSP_TENANT, 'u-other', { is_inactive: true }),
        internalUser(NINE_MINDS_TENANT, 'u-nine', { is_inactive: true }),
      ]);

      await expect(
        authenticateUser('tinus@example.com', 'correct-horse', 'internal'),
      ).resolves.toBeNull();
    });

    it('keeps an explicit tenant hint scoped to that tenant', async () => {
      findUserByEmailTenantAndTypeMock.mockResolvedValue(internalUser(NINE_MINDS_TENANT, 'u-nine'));

      const user = await authenticateUser('tinus@example.com', 'correct-horse', 'internal', {
        tenantId: NINE_MINDS_TENANT,
        requireTenantMatch: true,
      });

      expect(findUserByEmailTenantAndTypeMock).toHaveBeenCalledWith(
        'tinus@example.com',
        NINE_MINDS_TENANT,
        'internal',
      );
      expect(findUsersByEmailAndTypeMock).not.toHaveBeenCalled();
      expect(user?.tenant).toBe(NINE_MINDS_TENANT);
    });
  });
});
