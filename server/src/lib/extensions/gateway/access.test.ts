import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  assertAccess,
  ExtensionGatewayAccessError,
  type AuthorizedExtensionAccess,
} from './access';

const mocks = vi.hoisted(() => {
  const getCurrentUser = vi.fn();
  const getAdminConnection = vi.fn();
  const tenantDb = vi.fn();
  const hasPermission = vi.fn();
  const tryConsumeAtomic = vi.fn();
  return {
    getCurrentUser,
    getAdminConnection,
    tenantDb,
    hasPermission,
    tryConsumeAtomic,
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@alga-psa/db');
  return {
    ...actual,
    tenantDb: mocks.tenantDb,
  };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({ tryConsumeAtomic: mocks.tryConsumeAtomic }),
  },
}));

interface InstallFixture {
  install_id?: string;
  registry_id?: string;
  version_id?: string;
  is_enabled?: boolean;
  status?: string;
  api_endpoints?: unknown;
  ui?: unknown;
}

function buildInstall(fixture: InstallFixture): Record<string, unknown> {
  return {
    install_id: 'install-1',
    registry_id: 'registry-1',
    version_id: 'version-1',
    is_enabled: true,
    status: 'enabled',
    api_endpoints: [
      { method: 'GET', path: '/agreements', handler: 'handlers.list' },
      { method: 'GET', path: '/agreements/:id', handler: 'handlers.get' },
      { method: 'POST', path: '/agreements', handler: 'handlers.create' },
      { method: 'DELETE', path: '/agreements/:id', handler: 'handlers.delete' },
    ],
    ui: {
      hooks: {
        clientPortalMenu: { label: 'Agreements' },
      },
    },
    ...fixture,
  };
}

function builder(firstResult: unknown): any {
  const b: any = () => b;
  b.leftJoin = () => b;
  b.join = () => b;
  b.where = () => b;
  b.whereRaw = () => b;
  b.andWhere = (callback: (inner: any) => void) => {
    callback(b);
    return b;
  };
  b.orWhere = () => b;
  b.orWhereRaw = () => b;
  b.select = () => b;
  b.orderBy = () => b;
  b.limit = () => b;
  b.offset = () => b;
  b.first = async () => firstResult;
  return b;
}

function stubDb(opts: {
  install: unknown;
  clientRow?: { client_id: string } | null;
}) {
  return {
    tenant: 'tenant-a',
    table: (name: string) => {
      if (name.startsWith('tenant_extension_install')) {
        return builder(opts.install);
      }
      return builder(undefined);
    },
    tenantJoin: (query: any) => {
      const joined = { ...query };
      joined.first = async () => opts.clientRow ?? undefined;
      return joined;
    },
    unscoped: (_name: string, _reason: string) => builder(undefined),
  };
}

function input(overrides: Partial<{ tenantId: string; extensionId: string; method: string; path: string }> = {}) {
  return {
    tenantId: 'tenant-a',
    extensionId: 'registry-1',
    method: 'GET',
    path: '/agreements',
    ...overrides,
  };
}

describe('extension gateway canonical access resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue({ admin: true });
    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({}) })
    );
    mocks.hasPermission.mockResolvedValue(true);
    mocks.tryConsumeAtomic.mockResolvedValue({ allowed: true, remaining: 10 });
  });

  it('1. MSP GET on an active tenant-owned install and declared literal endpoint requires extension:read and returns canonical IDs', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);

    const access: AuthorizedExtensionAccess = await assertAccess(input());

    expect(access.installId).toBe('install-1');
    expect(access.registryId).toBe('registry-1');
    expect(access.versionId).toBe('version-1');
    expect(access.tenantId).toBe('tenant-a');
    expect(access.endpoint).toEqual({
      method: 'GET',
      path: '/agreements',
      handler: 'handlers.list',
    });
    expect(access.principal).toEqual({ kind: 'msp', userId: 'user-1' });
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'extension',
      'read',
      expect.anything(),
    );
    expect(mocks.tryConsumeAtomic).toHaveBeenCalledWith('extension-gateway', 'tenant-a', 'registry-1');
  });

  it('2. MSP POST/DELETE requires extension:write; a read-only user is denied', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      assertAccess(input({ method: 'POST', path: '/agreements' }))
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.anything(),
      'extension',
      'write',
      expect.anything(),
    );

    mocks.hasPermission.mockResolvedValue(true);
    await expect(
      assertAccess(input({ method: 'DELETE', path: '/agreements/abc' }))
    ).resolves.toMatchObject({
      endpoint: { method: 'DELETE', path: '/agreements/:id', handler: 'handlers.delete' },
      principal: { kind: 'msp', userId: 'user-1' },
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.anything(),
      'extension',
      'write',
      expect.anything(),
    );
  });

  it('3. No session user is denied even when header/dev tenant variables resolve a tenant', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    process.env.DEV_TENANT_ID = 'tenant-a';

    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tryConsumeAtomic).not.toHaveBeenCalled();
    delete process.env.DEV_TENANT_ID;
  });

  it('4. A session user whose tenant differs from the requested tenant is denied', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-b',
      user_type: 'internal',
    } as any);

    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'tenant_mismatch',
      status: 403,
    });
  });

  it('5. Missing install is denied without consuming rate limit or calling RBAC', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);
    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: null })
    );

    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'extension_not_available',
      status: 404,
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tryConsumeAtomic).not.toHaveBeenCalled();
  });

  it('6. Declared :param endpoint matches, while wrong method/segment/malformed/undeclared paths return endpoint_not_found', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);

    await expect(
      assertAccess(input({ method: 'GET', path: '/agreements/abc-123' }))
    ).resolves.toMatchObject({
      endpoint: { method: 'GET', path: '/agreements/:id', handler: 'handlers.get' },
    });

    for (const bad of [
      { method: 'POST', path: '/agreements/abc-123' },
      { method: 'GET', path: '/agreements/a/b' },
      { method: 'GET', path: '/undeclared' },
    ]) {
      await expect(assertAccess(input(bad))).rejects.toMatchObject({
        code: 'endpoint_not_found',
        status: 404,
      });
    }

    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({ api_endpoints: [] }) })
    );
    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'endpoint_not_found',
      status: 404,
    });

    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({ api_endpoints: 'not-json{{' }) })
    );
    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'endpoint_not_found',
      status: 404,
    });

    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({ api_endpoints: [{ method: 'GET', path: '/x' }] }) })
    );
    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'endpoint_not_found',
      status: 404,
    });
  });

  it('7. Client user succeeds only with a non-empty clientPortalMenu hook and a resolvable client association', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'client-user',
      tenant: 'tenant-a',
      user_type: 'client',
    } as any);
    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({}), clientRow: { client_id: 'client-1' } })
    );

    const access = await assertAccess(input());
    expect(access.principal).toEqual({ kind: 'client', userId: 'client-user', clientId: 'client-1' });
    expect(mocks.hasPermission).not.toHaveBeenCalled();

    // Missing hook is denied and must not reveal whether the extension opted in.
    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({ ui: { hooks: {} } }), clientRow: { client_id: 'client-1' } })
    );
    await expect(assertAccess(input())).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    // Missing client association is denied.
    mocks.tenantDb.mockImplementation((_conn: unknown, _tenant: string) =>
      stubDb({ install: buildInstall({}), clientRow: null })
    );
    await expect(assertAccess(input())).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('8. Exhausted limiter returns 429 with retry-after; fail-open sentinel returns 503', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);

    mocks.tryConsumeAtomic.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 2500 });
    const limited = await assertAccess(input()).catch((error) => error);
    expect(limited).toBeInstanceOf(ExtensionGatewayAccessError);
    expect(limited).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(limited.retryAfterSeconds).toBe(3);

    mocks.tryConsumeAtomic.mockResolvedValue({ allowed: true, remaining: -1 });
    await expect(assertAccess(input())).rejects.toMatchObject({
      code: 'access_policy_unavailable',
      status: 503,
    });
  });

  it('10. HEAD authorizes as extension:read: a read-only MSP user passes and a write-only user is denied', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);

    // Read-only principal: the policy must succeed for HEAD using only the
    // 'read' action, resolving the request against the GET-declared endpoint.
    mocks.hasPermission.mockImplementation(
      async (_user: unknown, _resource: string, action: string) => action === 'read',
    );

    const access = await assertAccess(input({ method: 'HEAD', path: '/agreements' }));
    expect(access.principal).toEqual({ kind: 'msp', userId: 'user-1' });
    expect(access.endpoint).toEqual({
      method: 'GET',
      path: '/agreements',
      handler: 'handlers.list',
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'extension',
      'read',
      expect.anything(),
    );

    // Write-only principal: HEAD must never satisfy on extension:write, which
    // pins the mapping rather than merely proving some permission suffices.
    mocks.hasPermission.mockImplementation(
      async (_user: unknown, _resource: string, action: string) => action === 'write',
    );

    await expect(assertAccess(input({ method: 'HEAD', path: '/agreements' }))).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    expect(mocks.hasPermission).toHaveBeenLastCalledWith(
      expect.anything(),
      'extension',
      'read',
      expect.anything(),
    );
  });

  it('9. DB and RBAC dependency failures never resolve access', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-a',
      user_type: 'internal',
    } as any);

    mocks.getAdminConnection.mockRejectedValueOnce(new Error('db down'));
    await expect(assertAccess(input())).rejects.toThrow('db down');

    mocks.hasPermission.mockRejectedValueOnce(new Error('rbac down'));
    await expect(assertAccess(input())).rejects.toThrow('rbac down');
    expect(mocks.tryConsumeAtomic).not.toHaveBeenCalled();
  });
});
