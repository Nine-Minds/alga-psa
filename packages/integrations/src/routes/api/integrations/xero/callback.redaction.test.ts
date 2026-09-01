import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const SENTINELS = {
  accessToken: 'SENTINEL-ACCESS-TOKEN-9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd',
  refreshToken: 'SENTINEL-REFRESH-TOKEN-0a1b2c3d4e5f60718293a4b5c6d7e8f9deadbeef',
  clientSecret: 'SENTINEL-CLIENT-SECRET-abcdef0123456789abcdef0123456789cafebabe',
  authHeader: 'Bearer SENTINEL-AUTH-HEADER-fedcba9876543210fedcba9876543210feedface',
  customerName: 'SENTINEL Customer Acme Ltd'
};

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const logCalls: unknown[][] = [];

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: (...args: unknown[]) => logCalls.push(args),
    warn: (...args: unknown[]) => logCalls.push(args),
    info: (...args: unknown[]) => logCalls.push(args),
    debug: (...args: unknown[]) => logCalls.push(args)
  }
}));

const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...args: unknown[]) => axiosPost(...args), get: vi.fn() }
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({}))
}));

const REDIRECT_URI = 'http://localhost:3000/api/integrations/xero/callback';
const USER_ID = 'user-1';

vi.mock('../../../../lib/xero/xeroClientService', () => ({
  getXeroRedirectUri: vi.fn(async () => REDIRECT_URI),
  resolveXeroOAuthCredentials: vi.fn(async () => ({
    clientId: 'client-id',
    clientSecret: SENTINELS.clientSecret,
    source: 'app'
  })),
  upsertStoredXeroConnections: vi.fn(async () => ({})),
  XeroConnectionsStore: {},
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token'
}));

// New opaque-nonce + server-side attempt-record model (main). The callback
// atomically consumes an attempt keyed by the opaque state nonce, then binds
// it to the live session before the token exchange.
vi.mock('../../../../lib/xero/xeroOAuthConnectAttemptStore', () => ({
  consumeXeroConnectAttempt: vi.fn(async () => ({
    verifier: 'enc:verifier-ciphertext',
    tenantId: TENANT_ID,
    userId: USER_ID,
    provider: 'xero',
    redirectUri: REDIRECT_URI,
    csrf: 'csrf-token',
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000
  }))
}));

vi.mock('../../../../lib/xero/xeroOAuthVerifierCipher', () => ({
  decryptXeroVerifier: vi.fn(async () => 'verifier-123')
}));

vi.mock('../../../../lib/accountingConnectionAuth', () => ({
  getAccountingConnectionSessionUser: vi.fn(async () => ({
    tenant: TENANT_ID,
    user_id: USER_ID
  })),
  canManageAccountingConnections: vi.fn(async () => true),
  reauthorizeAccountingOAuthCallback: vi.fn(async () => ({ ok: true })),
  revokeAccountingOAuthGrant: vi.fn(async () => undefined)
}));

vi.mock('../../../../lib/oauth/oauthCsrf', () => ({
  oauthCsrfTokensMatch: () => true,
  buildOauthCsrfCookieOptions: () => ({ path: '/' })
}));

function buildRequest(): NextRequest {
  // State is now an opaque nonce; the attempt record (mocked above) carries the
  // binding data the callback checks.
  const state = 'opaque-state-nonce';
  const url = `http://localhost:3000/api/integrations/xero/callback?code=auth-code-1&state=${state}`;
  return new NextRequest(url, {
    headers: { cookie: 'alga_xero_oauth_csrf=csrf-token' }
  });
}

function collectedLogOutput(): string {
  return JSON.stringify(logCalls);
}

describe('Xero OAuth callback redaction', () => {
  beforeEach(() => {
    logCalls.length = 0;
    axiosPost.mockReset();
    process.env.EDITION = 'ee';
  });

  afterEach(() => {
    delete process.env.EDITION;
  });

  it('never logs the token payload when expected token fields are absent', async () => {
    // Malformed token-exchange response: 200 OK but missing refresh_token,
    // with sentinel material riding along in the body.
    axiosPost.mockResolvedValue({
      data: {
        access_token: SENTINELS.accessToken,
        unexpected_field: SENTINELS.customerName
      }
    });

    const { GET } = await import('./callback');
    const response = await GET(buildRequest());

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get('location')).toContain('xero_error=token_exchange_failed');

    const output = collectedLogOutput();
    for (const sentinel of Object.values(SENTINELS)) {
      expect(output).not.toContain(sentinel);
    }
    // The diagnostic that matters is retained: which fields were missing.
    expect(output).toContain('refresh_token');
    expect(output).toContain('missingFields');
  });

  it('logs only allowlisted fields when the token exchange itself fails', async () => {
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      config: {
        headers: { Authorization: SENTINELS.authHeader },
        data: `client_secret=${SENTINELS.clientSecret}&code=auth-code-1`
      },
      response: {
        status: 400,
        headers: { 'xero-correlation-id': 'xero-corr-cb' },
        data: {
          error: 'invalid_grant',
          error_description: 'Authorization code expired',
          leaked_refresh_token: SENTINELS.refreshToken
        }
      }
    };
    axiosPost.mockRejectedValue(axiosError);

    const { GET } = await import('./callback');
    const response = await GET(buildRequest());

    expect(response.headers.get('location')).toContain('xero_error=oauth_failed');

    const output = collectedLogOutput();
    for (const sentinel of Object.values(SENTINELS)) {
      expect(output).not.toContain(sentinel);
    }
    expect(output).toContain('invalid_grant');
    expect(output).toContain('xero-corr-cb');
    expect(output).toContain('400');
  });
});
