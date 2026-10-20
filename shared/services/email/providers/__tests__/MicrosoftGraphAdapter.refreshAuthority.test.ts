import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosPost = vi.hoisted(() => vi.fn());
const secrets = vi.hoisted(() => ({
  tenant: new Map<string, string>(),
  app: new Map<string, string>(),
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: axiosPost, create: actual.default.create } };
});

vi.mock('../../../../core/secretProvider', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async (key: string) => secrets.app.get(key) ?? null,
    getTenantSecret: async (tenant: string, key: string) => secrets.tenant.get(`${tenant}:${key}`) ?? null,
  }),
}));

import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

const ENV_TENANT = '11111111-1111-4111-8111-111111111111';
const PROFILE_TENANT = '22222222-2222-4222-8222-222222222222';

function makeAdapter(providerConfig: Record<string, unknown>) {
  const adapter = new MicrosoftGraphAdapter({
    id: 'provider-1',
    tenant: 'tenant-1',
    name: 'Support',
    provider_type: 'microsoft',
    mailbox: 'support@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: '',
    connection_status: 'connected',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    provider_config: {
      access_token: 'opaque-not-a-jwt',
      refresh_token: 'refresh-token',
      resolved_client_id: 'app-id',
      resolved_client_secret: 'app-secret',
      ...providerConfig,
    },
  } as any);
  (adapter as any).persistRefreshedCredentials = false;
  (adapter as any).accessToken = 'opaque-not-a-jwt';
  (adapter as any).refreshToken = 'refresh-token';
  return adapter;
}

async function refreshedTokenUrl(providerConfig: Record<string, unknown>): Promise<string> {
  const adapter = makeAdapter(providerConfig);
  await (adapter as any).refreshAccessToken();
  return String(axiosPost.mock.calls[0][0]);
}

describe('MicrosoftGraphAdapter refresh authority', () => {
  const originalEnvTenant = process.env.MICROSOFT_TENANT_ID;

  beforeEach(() => {
    axiosPost.mockReset();
    axiosPost.mockResolvedValue({ data: { access_token: 'new-access', expires_in: 3600 } });
    secrets.tenant.clear();
    secrets.app.clear();
    process.env.MICROSOFT_TENANT_ID = ENV_TENANT;
    secrets.app.set('MICROSOFT_TENANT_ID', ENV_TENANT);
  });

  afterEach(() => {
    if (originalEnvTenant === undefined) delete process.env.MICROSOFT_TENANT_ID;
    else process.env.MICROSOFT_TENANT_ID = originalEnvTenant;
  });

  it('refreshes a tenant-owned mailbox with no tenant id against /common, not the deployment tenant', async () => {
    const url = await refreshedTokenUrl({ resolved_issuer_kind: 'tenant-owned' });
    expect(url).toContain('/common/oauth2/v2.0/token');
    expect(url).not.toContain(ENV_TENANT);
  });

  it('refreshes a tenant-owned mailbox against its own profile tenant when it has one', async () => {
    const url = await refreshedTokenUrl({ resolved_issuer_kind: 'tenant-owned', resolved_tenant_id: PROFILE_TENANT });
    expect(url).toContain(`/${PROFILE_TENANT}/oauth2/v2.0/token`);
  });

  it('uses the per-tenant microsoft_tenant_id secret when the row has no tenant id', async () => {
    secrets.tenant.set('tenant-1:microsoft_tenant_id', PROFILE_TENANT);
    const url = await refreshedTokenUrl({ resolved_issuer_kind: 'tenant-owned' });
    expect(url).toContain(`/${PROFILE_TENANT}/oauth2/v2.0/token`);
  });

  it('refreshes a platform-managed mailbox against /common even when a tenant GUID is resolved', async () => {
    const url = await refreshedTokenUrl({
      resolved_issuer_kind: 'platform-managed',
      resolved_tenant_id: PROFILE_TENANT,
    });
    expect(url).toContain('/common/oauth2/v2.0/token');
    expect(url).not.toContain(PROFILE_TENANT);
  });
});
