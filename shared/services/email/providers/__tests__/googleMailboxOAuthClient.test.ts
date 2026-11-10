import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets: Record<string, string | null> = {};
const getTenantSecret = vi.fn(async (_tenant: string, key: string) => tenantSecrets[key] ?? null);
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret }),
}));

const oauthCtor = vi.fn();
const refreshAccessToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(...args: unknown[]) {
      oauthCtor(...args);
    }
    setCredentials() {}
    refreshAccessToken = refreshAccessToken;
  },
}));
vi.mock('googleapis', () => ({ google: { gmail: vi.fn(() => ({})) } }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => {
    throw new Error('db not available in unit test');
  },
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

import {
  GOOGLE_INVALID_GRANT_MESSAGE,
  GOOGLE_OAUTH_CLIENT_CHANGED_MESSAGE,
  GOOGLE_UNAUTHORIZED_CLIENT_MESSAGE,
  resolveGoogleMailboxOAuthClient,
  toActionableGoogleRefreshError,
} from '../googleMailboxOAuthClient';
import { GmailAdapter } from '../GmailAdapter';
import { classifyInboundAuthFailure } from '../../InboundEmailAuthFailurePolicy';

function adapterWith(providerConfig: Record<string, unknown>) {
  const adapter = new GmailAdapter({
    id: 'p1',
    tenant: 'tenant-1',
    name: 'Support',
    provider_type: 'google',
    mailbox: 'support@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: 'https://example.test/hook',
    connection_status: 'connected',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_config: {
      access_token: 'old',
      refresh_token: 'rt',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      ...providerConfig,
    },
  } as any);
  (adapter as any).refreshToken = 'rt';
  return adapter;
}

describe('Google mailbox OAuth client', () => {
  beforeEach(() => {
    for (const k of Object.keys(tenantSecrets)) delete tenantSecrets[k];
    getTenantSecret.mockClear();
    oauthCtor.mockClear();
    refreshAccessToken.mockReset();
    process.env.GOOGLE_CLIENT_ID = 'alga-env-client';
    process.env.GOOGLE_CLIENT_SECRET = 'alga-env-secret';
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('T001: refresh uses the tenant client, never the env client (Pereceptive regression)', async () => {
    tenantSecrets.google_client_id = 'tenant-client';
    tenantSecrets.google_client_secret = 'tenant-secret';
    refreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'new', expiry_date: Date.now() + 3_600_000 },
    });

    const adapter = adapterWith({ client_id: null });
    await (adapter as any).refreshAccessToken();

    expect(oauthCtor).toHaveBeenCalledWith('tenant-client', 'tenant-secret');
    expect(oauthCtor).not.toHaveBeenCalledWith('alga-env-client', expect.anything());
    expect(JSON.stringify(oauthCtor.mock.calls)).not.toContain('alga-env');
  });

  describe('T002: resolver never mixes sources', () => {
    it('uses the row pair when client_id and client_secret are both present', async () => {
      tenantSecrets.google_client_id = 'tenant-client';
      tenantSecrets.google_client_secret = 'tenant-secret';
      await expect(
        resolveGoogleMailboxOAuthClient({
          tenant: 't',
          vendorConfig: { client_id: 'row-client', client_secret: 'row-secret' },
        })
      ).resolves.toEqual({ clientId: 'row-client', clientSecret: 'row-secret', source: 'row' });
    });

    it('uses the tenant pair when the row client_id matches and the secret is absent', async () => {
      tenantSecrets.google_client_id = 'same-client';
      tenantSecrets.google_client_secret = 'tenant-secret';
      await expect(
        resolveGoogleMailboxOAuthClient({ tenant: 't', vendorConfig: { client_id: 'same-client' } })
      ).resolves.toEqual({ clientId: 'same-client', clientSecret: 'tenant-secret', source: 'tenant' });
    });

    it('fails with a reconnect error and no Google call when the row client_id differs', async () => {
      tenantSecrets.google_client_id = 'new-client';
      tenantSecrets.google_client_secret = 'new-secret';
      await expect(
        resolveGoogleMailboxOAuthClient({ tenant: 't', vendorConfig: { client_id: 'old-client' } })
      ).rejects.toThrow(GOOGLE_OAUTH_CLIENT_CHANGED_MESSAGE);

      const adapter = adapterWith({ client_id: 'old-client' });
      await expect((adapter as any).refreshAccessToken()).rejects.toThrow(/client changed/);
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('fails when tenant secrets are missing, ignoring env', async () => {
      await expect(
        resolveGoogleMailboxOAuthClient({ tenant: 't', vendorConfig: { client_id: null } })
      ).rejects.toThrow('Google OAuth credentials not configured');
      tenantSecrets.google_client_id = 'only-id';
      await expect(resolveGoogleMailboxOAuthClient({ tenant: 't' })).rejects.toThrow(
        'Google OAuth credentials not configured'
      );
    });
  });

  describe('T004: refresh errors are actionable and classified correctly', () => {
    function gaxiosError(error: string, status: number) {
      const e: any = new Error(error);
      e.response = { status, data: { error, error_description: 'Google detail' } };
      return e;
    }

    async function refreshFailing(error: string, status: number) {
      tenantSecrets.google_client_id = 'tenant-client';
      tenantSecrets.google_client_secret = 'tenant-secret';
      refreshAccessToken.mockRejectedValue(gaxiosError(error, status));
      const adapter = adapterWith({ client_id: null });
      return (adapter as any).refreshAccessToken().then(
        () => {
          throw new Error('expected refresh to fail');
        },
        (e: any) => e
      );
    }

    it('unauthorized_client → client-mismatch message, not counted toward auto-pause', async () => {
      const err = await refreshFailing('unauthorized_client', 401);
      expect(err.message).toContain(GOOGLE_UNAUTHORIZED_CLIENT_MESSAGE);
      expect(err.message).toContain('Google detail');
      expect(classifyInboundAuthFailure({ providerType: 'google', error: err })).toEqual({
        kind: 'not_unrecoverable',
      });
    });

    it('invalid_grant → expired/revoked message with the External/Testing hint, still counted', async () => {
      const err = await refreshFailing('invalid_grant', 400);
      expect(err.message).toContain(GOOGLE_INVALID_GRANT_MESSAGE);
      expect(err.message).toMatch(/External/);
      expect(err.message).toMatch(/Testing/);
      expect(err.message).toMatch(/7 days/);
      expect(classifyInboundAuthFailure({ providerType: 'google', error: err })).toEqual({
        kind: 'unrecoverable_auth',
        code: 'google:invalid_grant',
      });
    });

    it('leaves unrelated errors alone', () => {
      expect(toActionableGoogleRefreshError(gaxiosError('server_error', 500))).toBeNull();
    });
  });
});
