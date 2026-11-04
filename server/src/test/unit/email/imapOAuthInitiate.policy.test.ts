import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertSafeOutboundUrl: vi.fn(),
  storeNonce: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: async () => ({ user_id: 'user-1', tenant: 'tenant-1' }),
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: vi.fn(async () => undefined),
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => ({
      where: () => ({
        first: async () => name === 'email_providers'
          ? { id: 'provider-1', provider_type: 'imap' }
          : {
              oauth_authorize_url: 'https://idp.example.test/authorize',
              oauth_client_id: 'client-1',
              oauth_scopes: 'mail.read',
              credential_generation: 'generation-1',
            },
      }),
    }),
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => null }),
}));
vi.mock('@/utils/email/imapOAuthState', () => ({
  createImapOAuthStateToken: () => ({ token: 'signed-state', payload: { nonce: 'nonce-1' } }),
  getImapOAuthStateSigningSecret: async () => 'signing-secret',
  IMAP_OAUTH_STATE_TTL_SECONDS: 600,
  storeImapOAuthStateNonce: mocks.storeNonce,
}));
vi.mock('@alga-psa/shared/services/net/outboundAddressPolicy', () => ({
  assertSafeOutboundUrl: mocks.assertSafeOutboundUrl,
}));

import { POST } from '@/app/api/email/oauth/imap/initiate/route';

function request() {
  return { json: async () => ({ providerId: 'provider-1' }) } as any;
}

describe('IMAP OAuth initiation outbound policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertSafeOutboundUrl.mockResolvedValue(undefined);
    mocks.storeNonce.mockResolvedValue(undefined);
  });

  it('rejects a persisted unsafe authorization destination before creating reconnect state', async () => {
    mocks.assertSafeOutboundUrl.mockRejectedValue(new Error('host resolves to a non-public address'));

    const response: any = await POST(request());

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/authorization URL is not allowed/i);
    expect(mocks.assertSafeOutboundUrl).toHaveBeenCalledWith('https://idp.example.test/authorize');
    expect(mocks.storeNonce).not.toHaveBeenCalled();
  });

  it('checks the authorization destination before returning the browser redirect URL', async () => {
    const response: any = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.assertSafeOutboundUrl).toHaveBeenCalledWith('https://idp.example.test/authorize');
    expect(response.body.authUrl).toContain('https://idp.example.test/authorize?');
    expect(mocks.storeNonce).toHaveBeenCalledTimes(1);
  });
});
