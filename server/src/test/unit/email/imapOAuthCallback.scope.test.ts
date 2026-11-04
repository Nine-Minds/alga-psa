import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentGeneration: 'generation-old',
  state: {
    tenant: 'tenant-1',
    userId: 'user-1',
    providerId: 'provider-1',
    redirectUri: 'https://app.example.test/callback',
    timestamp: Date.now(),
    nonce: 'nonce',
    credentialGeneration: 'generation-old' as string | null,
  },
  axiosPost: vi.fn(),
  setTenantSecret: vi.fn(),
  getTenantSecret: vi.fn(),
  updateWhere: null as Record<string, unknown> | null,
  providerUpdates: [] as any[],
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock('@/utils/email/oauthHelpers', () => ({
  decodeState: () => mocks.state,
  validateState: () => true,
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: vi.fn(async () => undefined),
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'NOW' }, raw: vi.fn() }, tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: mocks.getTenantSecret,
    setTenantSecret: mocks.setTenantSecret,
    deleteTenantSecret: vi.fn(),
  }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => ({
      where: (filter: Record<string, unknown>) => ({
        first: async () => name === 'email_providers'
          ? { id: 'provider-1', provider_type: 'imap', inbound_paused_at: null }
          : {
              email_provider_id: 'provider-1',
              host: 'imap.example.test',
              port: 993,
              secure: true,
              allow_starttls: false,
              auth_type: 'oauth2',
              username: 'mailbox@example.test',
              oauth_token_url: 'https://idp.example.test/token',
              oauth_client_id: 'client-id',
              credential_generation: mocks.currentGeneration,
            },
        update: async (values: any) => {
          if (name === 'imap_email_provider_config') mocks.updateWhere = filter;
          else mocks.providerUpdates.push(values);
          return name === 'imap_email_provider_config' &&
            filter.credential_generation !== mocks.currentGeneration ? 0 : 1;
        },
      }),
    }),
  }),
}));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) } }));

import { GET } from '@/app/api/email/oauth/imap/callback/route';

function callbackRequest() {
  return {
    nextUrl: new URL('https://app.example.test/api/email/oauth/imap/callback?code=auth-code&state=encoded-state'),
  } as any;
}

describe('IMAP OAuth callback credential generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentGeneration = 'generation-old';
    mocks.state.credentialGeneration = 'generation-old';
    mocks.axiosPost.mockResolvedValue({ data: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 } });
    mocks.getTenantSecret.mockResolvedValue('old-client-secret');
    mocks.setTenantSecret.mockResolvedValue(undefined);
    mocks.updateWhere = null;
    mocks.providerUpdates.length = 0;
  });

  it('refuses an OAuth state created for a previous generation before sending credentials', async () => {
    mocks.currentGeneration = 'generation-new';
    const response: any = await GET(callbackRequest());
    expect(response.status).toBe(409);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('does not persist a token response when the generation changes in flight', async () => {
    let resolveToken!: (value: any) => void;
    mocks.axiosPost.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    const callback = GET(callbackRequest());
    await vi.waitFor(() => expect(mocks.axiosPost).toHaveBeenCalledTimes(1));

    mocks.currentGeneration = 'generation-new';
    resolveToken({ data: { access_token: 'stale-access-token', refresh_token: 'stale-refresh-token', expires_in: 3600 } });

    const response: any = await callback;
    expect(response.status).toBe(409);
    expect(mocks.updateWhere).toMatchObject({ credential_generation: 'generation-old' });
    expect(mocks.setTenantSecret).not.toHaveBeenCalled();
    expect(mocks.providerUpdates).toEqual([]);
  });
});
