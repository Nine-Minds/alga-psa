import { beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
const sendMock = vi.fn();
const resolveBaseMock = vi.fn();
const whereCalls: unknown[][] = [];
let userRows: Array<{ tenant: string; client_name: string | null }> = [];
let dbShouldThrow = false;

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ({ __db: true })),
}));

vi.mock('@alga-psa/db', () => {
  const makeQuery = () => {
    const query: any = {
      where: (...args: unknown[]) => (whereCalls.push(['where', ...args]), query),
      andWhere: (...args: unknown[]) => (whereCalls.push(['andWhere', ...args]), query),
      select: async () => {
        if (dbShouldThrow) throw new Error('db down');
        return userRows;
      },
    };
    return query;
  };
  return {
    tenantDb: () => ({ unscoped: () => makeQuery(), tenantJoin: vi.fn() }),
    getTenantSlugForTenant: async (tenantId: string) => `slug-${tenantId}`,
  };
});

vi.mock('../security/rateLimiting', () => ({
  checkPasswordResetLimit: (...args: unknown[]) => limitMock(...args),
}));

const {
  CLIENT_TENANT_DISCOVERY_PROFILE,
  INTERNAL_TENANT_DISCOVERY_PROFILE,
  TENANT_DISCOVERY_GENERIC_MESSAGE,
  buildTenantSignInLink,
  requestTenantSignInLinks,
} = await import('./index');

// The engine imports neither tenancy nor email: fakes are injected.
const deps = {
  resolveAppBase: (...args: unknown[]) => resolveBaseMock(...args),
  sendRecoveryEmail: (...args: unknown[]) => sendMock(...args),
} as unknown as import('./index').TenantDiscoveryDeps;

const GENERIC = { success: true, message: TENANT_DISCOVERY_GENERIC_MESSAGE };

describe('tenant discovery engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereCalls.length = 0;
    dbShouldThrow = false;
    userRows = [
      { tenant: 't-a', client_name: 'Acme MSP' },
      { tenant: 't-b', client_name: 'Beta MSP' },
    ];
    limitMock.mockResolvedValue({ success: true, msBeforeNext: 0 });
    resolveBaseMock.mockResolvedValue({ baseUrl: 'https://app.example.com', source: 'canonical' });
    sendMock.mockResolvedValue(undefined);
  });

  describe('profiles', () => {
    it('the internal profile targets the MSP sign-in with its own template and always scopes vanity links', () => {
      expect(INTERNAL_TENANT_DISCOVERY_PROFILE).toMatchObject({
        userType: 'internal',
        surface: 'msp',
        signInPath: '/auth/msp/signin',
        templateName: 'msp-tenant-recovery',
        vanityScopesTenant: true,
      });
      expect(INTERNAL_TENANT_DISCOVERY_PROFILE.precondition).toBeUndefined();
    });

    it('the client profile keeps vanity links bare and gates on contact email', () => {
      expect(CLIENT_TENANT_DISCOVERY_PROFILE).toMatchObject({
        userType: 'client',
        surface: 'client_portal',
        signInPath: '/auth/client-portal/signin',
        templateName: 'tenant-recovery',
        vanityScopesTenant: false,
      });
      expect(typeof CLIENT_TENANT_DISCOVERY_PROFILE.precondition).toBe('function');
    });
  });

  describe('links', () => {
    it('MSP canonical links carry ?tenant= and a relative callbackUrl', async () => {
      const { url, source } = await buildTenantSignInLink(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 't-a', '/msp/tickets');
      const parsed = new URL(url);
      expect(source).toBe('canonical');
      expect(parsed.origin + parsed.pathname).toBe('https://app.example.com/auth/msp/signin');
      expect(parsed.searchParams.get('tenant')).toBe('slug-t-a');
      expect(parsed.searchParams.get('callbackUrl')).toBe('/msp/tickets');
    });

    it('MSP vanity links still carry ?tenant=', async () => {
      resolveBaseMock.mockResolvedValue({ baseUrl: 'https://psa.acme.test', source: 'vanity' });
      const { url, source } = await buildTenantSignInLink(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 't-a');
      expect(source).toBe('vanity');
      expect(new URL(url).searchParams.get('tenant')).toBe('slug-t-a');
    });

    it('client vanity links stay bare, client canonical links carry the slug', async () => {
      resolveBaseMock.mockResolvedValue({ baseUrl: 'https://portal.acme.test', source: 'vanity' });
      const vanity = await buildTenantSignInLink(CLIENT_TENANT_DISCOVERY_PROFILE, deps, 't-a');
      expect(new URL(vanity.url).searchParams.has('tenant')).toBe(false);

      resolveBaseMock.mockResolvedValue({ baseUrl: 'https://app.example.com', source: 'canonical' });
      const canonical = await buildTenantSignInLink(CLIENT_TENANT_DISCOVERY_PROFILE, deps, 't-a');
      expect(new URL(canonical.url).searchParams.get('tenant')).toBe('slug-t-a');
    });

    it('asks the base resolver for the profile surface', async () => {
      await buildTenantSignInLink(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 't-a');
      expect(resolveBaseMock).toHaveBeenCalledWith('t-a', 'msp', expect.anything());
    });
  });

  describe('requestTenantSignInLinks', () => {
    it('emails one link per tenant using the profile template and queries only live users of the type', async () => {
      const response = await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, '  Dual@Example.com ', '/msp/tickets');

      expect(response).toEqual(GENERIC);
      expect(limitMock).toHaveBeenCalledWith('dual@example.com');
      expect(sendMock).toHaveBeenCalledTimes(1);
      const [to, infos, options] = sendMock.mock.calls[0];
      expect(to).toBe('dual@example.com');
      expect(options).toEqual({ templateName: 'msp-tenant-recovery' });
      expect(infos.map((i: any) => i.tenantName)).toEqual(['Acme MSP', 'Beta MSP']);
      expect(new URL(infos[0].loginUrl).searchParams.get('tenant')).toBe('slug-t-a');
      expect(whereCalls).toEqual(
        expect.arrayContaining([
          ['where', 'users.email', 'dual@example.com'],
          ['andWhere', 'users.user_type', 'internal'],
          ['andWhere', 'users.is_inactive', false],
        ])
      );
    });

    it('sends one link per tenant even when a tenant has duplicate rows', async () => {
      userRows = [
        { tenant: 't-a', client_name: 'Acme MSP' },
        { tenant: 't-a', client_name: 'Acme MSP' },
      ];
      await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com');
      expect(sendMock.mock.calls[0][1]).toHaveLength(1);
    });

    it('drops an absolute or protocol-relative callbackUrl from the links', async () => {
      await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com', 'https://evil.example/x');
      expect(new URL(sendMock.mock.calls[0][1][0].loginUrl).searchParams.has('callbackUrl')).toBe(false);

      sendMock.mockClear();
      await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com', '//evil.example/x');
      expect(new URL(sendMock.mock.calls[0][1][0].loginUrl).searchParams.has('callbackUrl')).toBe(false);
    });

    describe('one generic response for every outcome', () => {
      it('rate limited', async () => {
        limitMock.mockResolvedValue({ success: false, msBeforeNext: 1000 });
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com')).toEqual(GENERIC);
        expect(sendMock).not.toHaveBeenCalled();
      });

      it('precondition fails (client contact gate)', async () => {
        const gated = { ...CLIENT_TENANT_DISCOVERY_PROFILE, precondition: async () => false };
        expect(await requestTenantSignInLinks(gated, deps, 'dual@example.com')).toEqual(GENERIC);
        expect(sendMock).not.toHaveBeenCalled();
      });

      it('no user', async () => {
        userRows = [];
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'nobody@example.com')).toEqual(GENERIC);
        expect(sendMock).not.toHaveBeenCalled();
      });

      it('sent', async () => {
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com')).toEqual(GENERIC);
        expect(sendMock).toHaveBeenCalled();
      });

      it('database error', async () => {
        dbShouldThrow = true;
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com')).toEqual(GENERIC);
      });

      it('email send error', async () => {
        sendMock.mockRejectedValue(new Error('smtp down'));
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com')).toEqual(GENERIC);
      });

      it('rate limiter error', async () => {
        limitMock.mockRejectedValue(new Error('limiter'));
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, 'dual@example.com')).toEqual(GENERIC);
      });

      it('empty email', async () => {
        expect(await requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, deps, '   ')).toEqual(GENERIC);
      });
    });
  });
});
