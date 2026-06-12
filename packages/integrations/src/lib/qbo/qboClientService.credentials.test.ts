import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// ── Secret provider mocks ──────────────────────────────────────────────────
const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const getAppSecretMock = vi.fn(async (key: string) => appSecrets.get(key) ?? null);
const setTenantSecretMock = vi.fn(async (_tenant: string, _key: string, _value: string) => {});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    getAppSecret: getAppSecretMock,
    setTenantSecret: setTenantSecretMock,
  }),
}));

// ── axios mock (for token refresh tests) ──────────────────────────────────
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
      request: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

import axios from 'axios';
import {
  resolveQboOAuthCredentials,
  getQboEnvironment,
  getDefaultQboRealmId,
  QboClientService,
  getQboRedirectUri,
  getQboOAuthScopes,
} from './qboClientService';
import type { QboTenantCredentials } from './types';

const TENANT_ID = 'tenant-unit-test-1';

// ── helpers ────────────────────────────────────────────────────────────────

function setTenantSecret(key: string, value: string) {
  tenantSecrets.set(`${TENANT_ID}:${key}`, value);
}

function setAppSecret(key: string, value: string) {
  appSecrets.set(key, value);
}

/** Build a QboTenantCredentials with a non-expired access token by default */
function makeCreds(overrides?: Partial<QboTenantCredentials>): QboTenantCredentials {
  const far = new Date(Date.now() + 3600 * 1000).toISOString();
  return {
    accessToken: 'at-token',
    refreshToken: 'rt-token',
    realmId: 'realm-123',
    accessTokenExpiresAt: far,
    refreshTokenExpiresAt: new Date(Date.now() + 8640000 * 1000).toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveQboOAuthCredentials', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
  });

  it('tenant-first: both tenant secrets set → source "tenant"', async () => {
    setTenantSecret('qbo_client_id', 'tenant-cid');
    setTenantSecret('qbo_client_secret', 'tenant-csec');
    setAppSecret('qbo_client_id', 'app-cid');
    setAppSecret('qbo_client_secret', 'app-csec');

    await expect(resolveQboOAuthCredentials(TENANT_ID)).resolves.toEqual({
      clientId: 'tenant-cid',
      clientSecret: 'tenant-csec',
      source: 'tenant',
    });
  });

  it('app fallback: no tenant secrets, app secrets set → source "app"', async () => {
    setAppSecret('qbo_client_id', 'app-cid');
    setAppSecret('qbo_client_secret', 'app-csec');

    await expect(resolveQboOAuthCredentials(TENANT_ID)).resolves.toEqual({
      clientId: 'app-cid',
      clientSecret: 'app-csec',
      source: 'app',
    });
  });

  it('partial tenant config (only client id) → throws QBO_CONFIG_MISSING', async () => {
    setTenantSecret('qbo_client_id', 'tenant-cid');
    // no tenant secret for qbo_client_secret

    const err = await resolveQboOAuthCredentials(TENANT_ID).catch((e) => e);
    expect(err).toBeDefined();
    expect(err.code).toBe('QBO_CONFIG_MISSING');
    expect(err.message).toMatch(/must both be configured/i);
  });

  it('partial tenant config (only client secret) → throws QBO_CONFIG_MISSING', async () => {
    setTenantSecret('qbo_client_secret', 'tenant-csec');

    const err = await resolveQboOAuthCredentials(TENANT_ID).catch((e) => e);
    expect(err).toBeDefined();
    expect(err.code).toBe('QBO_CONFIG_MISSING');
  });

  it('nothing configured at all → throws QBO_CONFIG_MISSING', async () => {
    const err = await resolveQboOAuthCredentials(TENANT_ID).catch((e) => e);
    expect(err).toBeDefined();
    expect(err.code).toBe('QBO_CONFIG_MISSING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getQboEnvironment', () => {
  beforeEach(() => {
    vi.stubEnv('QBO_ENVIRONMENT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('QBO_ENVIRONMENT=production → "production"', () => {
    vi.stubEnv('QBO_ENVIRONMENT', 'production');
    expect(getQboEnvironment()).toBe('production');
  });

  it('QBO_ENVIRONMENT=SANDBOX (uppercase) → "sandbox"', () => {
    vi.stubEnv('QBO_ENVIRONMENT', 'SANDBOX');
    expect(getQboEnvironment()).toBe('sandbox');
  });

  it('invalid QBO_ENVIRONMENT + NODE_ENV != production → "sandbox"', () => {
    vi.stubEnv('QBO_ENVIRONMENT', 'foobar');
    vi.stubEnv('NODE_ENV', 'test');
    expect(getQboEnvironment()).toBe('sandbox');
  });

  it('no QBO_ENVIRONMENT + NODE_ENV=production → "production"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getQboEnvironment()).toBe('production');
  });

  it('no QBO_ENVIRONMENT + NODE_ENV=development → "sandbox"', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(getQboEnvironment()).toBe('sandbox');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getDefaultQboRealmId', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
  });

  it('returns the first realm key from stored qbo_credentials JSON', async () => {
    const creds = {
      'realm-first': makeCreds({ realmId: 'realm-first' }),
      'realm-second': makeCreds({ realmId: 'realm-second' }),
    };
    setTenantSecret('qbo_credentials', JSON.stringify(creds));

    const realmId = await getDefaultQboRealmId(TENANT_ID);
    expect(realmId).toBe('realm-first');
  });

  it('returns null when qbo_credentials secret is missing', async () => {
    const realmId = await getDefaultQboRealmId(TENANT_ID);
    expect(realmId).toBeNull();
  });

  it('returns null when qbo_credentials secret is empty object', async () => {
    setTenantSecret('qbo_credentials', JSON.stringify({}));
    const realmId = await getDefaultQboRealmId(TENANT_ID);
    expect(realmId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('QboClientService.create', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
    delete process.env.QBO_ENVIRONMENT;
  });

  function storeCreds(realmId: string, overrides?: Partial<QboTenantCredentials>) {
    const creds = makeCreds({ realmId, ...overrides });
    const map = { [realmId]: creds };
    setTenantSecret('qbo_credentials', JSON.stringify(map));
    return creds;
  }

  it('picks the first stored realm when no realmId is passed', async () => {
    storeCreds('realm-auto');
    // Supply app client creds so resolveQboOAuthCredentials inside initialize() passes
    setAppSecret('qbo_client_id', 'cid');
    setAppSecret('qbo_client_secret', 'csec');

    // Should resolve without throwing
    await expect(QboClientService.create(TENANT_ID)).resolves.toBeDefined();
  });

  it('uses the explicitly-provided realmId', async () => {
    storeCreds('realm-explicit');
    setAppSecret('qbo_client_id', 'cid');
    setAppSecret('qbo_client_secret', 'csec');

    await expect(QboClientService.create(TENANT_ID, 'realm-explicit')).resolves.toBeDefined();
  });

  it('throws QBO_SETUP_INCOMPLETE when qbo_credentials is missing', async () => {
    setAppSecret('qbo_client_id', 'cid');
    setAppSecret('qbo_client_secret', 'csec');

    const err = await QboClientService.create(TENANT_ID).catch((e) => e);
    expect(err.code).toBe('QBO_SETUP_INCOMPLETE');
  });

  it('throws QBO_SETUP_INCOMPLETE when qbo_credentials is empty object', async () => {
    setTenantSecret('qbo_credentials', JSON.stringify({}));
    setAppSecret('qbo_client_id', 'cid');
    setAppSecret('qbo_client_secret', 'csec');

    const err = await QboClientService.create(TENANT_ID).catch((e) => e);
    expect(err.code).toBe('QBO_SETUP_INCOMPLETE');
  });

  it('throws QBO_SETUP_INCOMPLETE when specified realmId has no stored credentials', async () => {
    storeCreds('realm-other');
    setAppSecret('qbo_client_id', 'cid');
    setAppSecret('qbo_client_secret', 'csec');

    const err = await QboClientService.create(TENANT_ID, 'realm-nonexistent').catch((e) => e);
    expect(err.code).toBe('QBO_SETUP_INCOMPLETE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('QboClientService token refresh uses resolved tenant credentials', () => {
  const REALM_ID = 'realm-refresh-test';
  const TENANT_CLIENT_ID = 'tenant-cid-for-refresh';
  const TENANT_CLIENT_SECRET = 'tenant-csec-for-refresh';

  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
    delete process.env.QBO_ENVIRONMENT;
  });

  it('calls axios.post with Basic auth from tenant credentials and persists refreshed tokens', async () => {
    // Expired access token forces a refresh
    const expiredCreds = makeCreds({
      realmId: REALM_ID,
      accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 8640000 * 1000).toISOString(),
      accessToken: 'old-at',
      refreshToken: 'old-rt',
    });
    setTenantSecret('qbo_credentials', JSON.stringify({ [REALM_ID]: expiredCreds }));

    // Tenant-owned client credentials
    setTenantSecret('qbo_client_id', TENANT_CLIENT_ID);
    setTenantSecret('qbo_client_secret', TENANT_CLIENT_SECRET);

    // Mock axios.post to return a successful token response
    const axiosPostMock = vi.mocked(axios.post);
    axiosPostMock.mockResolvedValueOnce({
      data: {
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
    });

    await QboClientService.create(TENANT_ID, REALM_ID);

    // axios.post should have been called once for the token refresh
    expect(axiosPostMock).toHaveBeenCalledTimes(1);

    // The Authorization header must use the tenant credentials
    const expectedBasic = 'Basic ' + Buffer.from(`${TENANT_CLIENT_ID}:${TENANT_CLIENT_SECRET}`).toString('base64');
    const [_url, _body, config] = axiosPostMock.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers.Authorization).toBe(expectedBasic);

    // setTenantSecret should have been called to persist the refreshed credentials
    expect(setTenantSecretMock).toHaveBeenCalledWith(
      TENANT_ID,
      'qbo_credentials',
      expect.stringContaining('new-at'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getQboRedirectUri', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
    savedEnv = {
      QBO_REDIRECT_URI: process.env.QBO_REDIRECT_URI,
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    };
    delete process.env.QBO_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('QBO_REDIRECT_URI env set → returned verbatim', async () => {
    process.env.QBO_REDIRECT_URI = 'https://custom.example.com/qbo/cb';
    const uri = await getQboRedirectUri();
    expect(uri).toBe('https://custom.example.com/qbo/cb');
  });

  it('QBO_REDIRECT_URI not set → derived from NEXT_PUBLIC_BASE_URL', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.com';
    const uri = await getQboRedirectUri();
    expect(uri).toBe('https://app.example.com/api/integrations/qbo/callback');
  });

  it('QBO_REDIRECT_URI not set → derived from NEXTAUTH_URL as fallback', async () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com';
    const uri = await getQboRedirectUri();
    expect(uri).toBe('https://auth.example.com/api/integrations/qbo/callback');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getQboOAuthScopes', () => {
  let savedScopes: string | undefined;

  beforeEach(() => {
    savedScopes = process.env.QBO_OAUTH_SCOPES;
    delete process.env.QBO_OAUTH_SCOPES;
  });

  afterEach(() => {
    if (savedScopes === undefined) {
      delete process.env.QBO_OAUTH_SCOPES;
    } else {
      process.env.QBO_OAUTH_SCOPES = savedScopes;
    }
  });

  it('default: returns ["com.intuit.quickbooks.accounting"]', () => {
    expect(getQboOAuthScopes()).toEqual(['com.intuit.quickbooks.accounting']);
  });

  it('QBO_OAUTH_SCOPES env override (space-separated) → parsed as array', () => {
    process.env.QBO_OAUTH_SCOPES = 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment';
    expect(getQboOAuthScopes()).toEqual([
      'com.intuit.quickbooks.accounting',
      'com.intuit.quickbooks.payment',
    ]);
  });

  it('QBO_OAUTH_SCOPES with extra whitespace is trimmed correctly', () => {
    process.env.QBO_OAUTH_SCOPES = '  com.intuit.quickbooks.accounting  ';
    expect(getQboOAuthScopes()).toEqual(['com.intuit.quickbooks.accounting']);
  });
});
