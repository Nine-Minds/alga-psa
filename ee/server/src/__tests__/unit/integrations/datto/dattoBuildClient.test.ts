import { beforeEach, describe, expect, it, vi } from 'vitest';

let integrationRow: Record<string, any> | null;
let secrets: Record<string, string | null>;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({
    table: () => {
      const q: any = {};
      q.where = vi.fn(() => q);
      q.first = vi.fn(async () => integrationRow ?? undefined);
      return q;
    },
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets[key] ?? null),
    setTenantSecret: vi.fn(async () => undefined),
  })),
}));

const row = (overrides: Record<string, any> = {}) => ({
  is_active: true,
  instance_url: 'https://merlot-api.centrastage.net/api',
  settings: { platform: 'merlot' },
  ...overrides,
});

describe('buildDattoClientForTenant', () => {
  beforeEach(() => {
    integrationRow = row();
    secrets = { datto_rmm_api_key: 'key', datto_rmm_api_secret: 'secret' };
  });

  it('builds a client for an allowlisted stored URL', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    expect(await buildDattoClientForTenant('tenant_1')).not.toBeNull();

    integrationRow = row({ instance_url: 'https://eu1.rmm.datto.com/api', settings: { platform: 'custom' } });
    expect(await buildDattoClientForTenant('tenant_1')).not.toBeNull();
  });

  it('refuses to build for a stored URL that is not a Datto host', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    for (const instance_url of [
      'https://attacker.example/api',
      'https://centrastage.net.attacker.example/api',
      'http://merlot-api.centrastage.net/api',
    ]) {
      // Not even a known platform in settings may rescue a bad stored URL.
      integrationRow = row({ instance_url, settings: { platform: 'merlot' } });
      expect(await buildDattoClientForTenant('tenant_1'), instance_url).toBeNull();
    }
  });

  it('refuses loopback outside NODE_ENV=test', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    integrationRow = row({ instance_url: 'http://localhost:9000/api', settings: { platform: 'custom' } });
    expect(await buildDattoClientForTenant('tenant_1')).not.toBeNull();

    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(await buildDattoClientForTenant('tenant_1')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('returns null without credentials or an active integration, as before', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    secrets = {};
    expect(await buildDattoClientForTenant('tenant_1')).toBeNull();
    secrets = { datto_rmm_api_key: 'key', datto_rmm_api_secret: 'secret' };
    integrationRow = row({ is_active: false });
    expect(await buildDattoClientForTenant('tenant_1')).toBeNull();
    expect(await buildDattoClientForTenant('tenant_1', { allowInactive: true })).not.toBeNull();
  });

  it('passes maxRetries and maxRetryAfterMs through to the client', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    const client: any = await buildDattoClientForTenant('tenant_1', { maxRetries: 1, maxRetryAfterMs: 5000 });
    expect(client.maxRetries).toBe(1);
    expect(client.opts.maxRetryAfterMs).toBe(5000);

    const defaults: any = await buildDattoClientForTenant('tenant_1');
    expect(defaults.maxRetries).toBe(5);
    expect(defaults.opts.maxRetryAfterMs).toBeUndefined();
  });

  it('throws a clear reconnect message for a flagged integration only when asked to respect it', async () => {
    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    const { DattoRmmReconnectRequiredError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    integrationRow = row({
      settings: {
        platform: 'merlot',
        tokenLifecycle: { status: 'reconnect_required', reconnectReason: 'Datto RMM rejected the API key and secret.' },
      },
    });

    const err = await buildDattoClientForTenant('tenant_1', { respectReconnectRequired: true }).catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmReconnectRequiredError);
    expect(err.message).toBe('Datto RMM needs to be reconnected: Datto RMM rejected the API key and secret.');

    // Save / test-connection / webhook paths do not opt in and can still re-authenticate.
    expect(await buildDattoClientForTenant('tenant_1')).not.toBeNull();
    expect(await buildDattoClientForTenant('tenant_1', { allowInactive: true })).not.toBeNull();

    integrationRow = row({ settings: { platform: 'merlot', tokenLifecycle: { status: 'healthy' } } });
    expect(await buildDattoClientForTenant('tenant_1', { respectReconnectRequired: true })).not.toBeNull();
  });
});
