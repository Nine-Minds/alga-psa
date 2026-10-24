import { beforeEach, describe, expect, it, vi } from 'vitest';

// These are Next.js server actions, so we unit-test by mocking the wrappers and dependencies,
// then calling the underlying handler directly.

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;
const hasPermissionMock = vi.fn(async (..._args: any[]) => true);

// Tier gating is exercised by the shared helper's own tests; keep these edition-independent.
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex)),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any) => q,
  }),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// The sync engines are exercised by their own suites; these tests are about
// the settings actions.
vi.mock('@ee/lib/integrations/datto/siteSync', () => ({ runDattoRmmSiteSync: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/deviceSync', () => ({ runDattoRmmDeviceSync: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/syncSingleDevice', () => ({ syncDattoSingleDeviceForTenant: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/alertBackfill', () => ({ runDattoRmmAlertBackfill: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/softwareIngest', () => ({ runDattoRmmSoftwareIngest: vi.fn() }));

describe('Datto RMM settings secret masking', () => {
  beforeEach(() => {
    hasPermissionMock.mockClear();
    hasPermissionMock.mockResolvedValue(true);

    const secrets = new Map<string, string>([
      ['datto_rmm_api_key', 'KEY_abcdefghijklmnop'],
      ['datto_rmm_api_secret', 'SECRET_0123456789zyxwvu'],
      ['datto_rmm_access_token', 'tok_should_never_be_returned'],
    ]);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets.get(key) ?? null),
    };

    knexMock = vi.fn((_table: string) => ({
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({
        instance_url: 'https://merlot-api.centrastage.net/api',
        is_active: true,
        connected_at: '2026-10-19T00:00:00Z',
        last_sync_at: '2026-10-19T01:00:00Z',
        sync_error: null,
        settings: {
          platform: 'merlot',
          rebootComponentUid: 'comp-1',
          resolveAlertsOnTicketClose: true,
          deviceSync: { enabled: true, intervalMinutes: 60 },
        },
      })),
    }));
  });

  it('masks the API key with only the last 4 characters visible', async () => {
    const { getDattoRmmSettings } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );

    const res = await (getDattoRmmSettings as any)({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    // KEY_abcdefghijklmnop -> bullets + 'mnop'
    expect(res.credentials?.apiKeyMasked).toBe(`${'•'.repeat('KEY_abcdefghijklmnop'.length - 4)}mnop`);
    expect(res.credentials).toMatchObject({ hasApiKey: true, hasApiSecret: true });
  });

  it('never returns the API key, secret, or cached token values', async () => {
    const { getDattoRmmSettings } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );

    const res = await (getDattoRmmSettings as any)({} as any, { tenant: 'tenant_1' });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('KEY_abcdefghijklmnop');
    expect(serialized).not.toContain('SECRET_0123456789zyxwvu');
    expect(serialized).not.toContain('0123456789zyxwvu');
    expect(serialized).not.toContain('tok_should_never_be_returned');
  });

  it('returns the stored configuration with the option toggles', async () => {
    const { getDattoRmmSettings } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );

    const res = await (getDattoRmmSettings as any)({} as any, { tenant: 'tenant_1' });
    expect(res.config).toMatchObject({
      instanceUrl: 'https://merlot-api.centrastage.net/api',
      platform: 'merlot',
      isActive: true,
      rebootComponentUid: 'comp-1',
      resolveAlertsOnTicketClose: true,
      softwareIngestOnSync: false,
    });
  });

  it('reports no credentials when nothing is stored', async () => {
    secretProvider.getTenantSecret = vi.fn(async () => null);

    const { getDattoRmmSettings } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );

    const res = await (getDattoRmmSettings as any)({} as any, { tenant: 'tenant_1' });
    expect(res.credentials).toEqual({ hasApiKey: false, hasApiSecret: false, apiKeyMasked: undefined });
  });

  it('is gated on system_settings read', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { getDattoRmmSettings } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );

    const res = await (getDattoRmmSettings as any)({} as any, { tenant: 'tenant_1' });
    expect(res).toEqual({ success: false, error: 'Forbidden' });
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'system_settings', 'read');
    expect(knexMock).not.toHaveBeenCalled();
  });
});
