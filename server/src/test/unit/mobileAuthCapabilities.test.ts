import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({ ApiKeyService: {} }));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: vi.fn() }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: vi.fn() }));
vi.mock('server/src/lib/logging/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('server/src/lib/security/mobileAuthRateLimiting', () => ({
  enforceMobileOttExchangeLimit: vi.fn(),
  enforceMobileRefreshLimit: vi.fn(),
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  TierAccessError: class TierAccessError extends Error {},
  assertTenantTierAccess: vi.fn(),
}));
vi.mock('server/src/lib/api/middleware/apiMiddleware', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const getAppSecretMock = vi.hoisted(() => vi.fn<(key: string) => Promise<string | null>>());
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: getAppSecretMock }),
}));

import { getCapabilitiesResponse } from 'server/src/lib/mobileAuth/mobileAuthService';

const ENV_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'MICROSOFT_OAUTH_CLIENT_ID',
  'MICROSOFT_OAUTH_CLIENT_SECRET',
  'ALGA_MOBILE_HOST_ALLOWLIST',
  'EDITION',
  'NEXT_PUBLIC_EDITION',
] as const;

const savedEnv: Record<string, string | undefined> = {};

describe('getCapabilitiesResponse', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    getAppSecretMock.mockReset();
    getAppSecretMock.mockResolvedValue(null);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('reports enabled=false on CE and enabled=true on EE', async () => {
    expect((await getCapabilitiesResponse()).enabled).toBe(false);

    process.env.EDITION = 'ee';
    expect((await getCapabilitiesResponse()).enabled).toBe(true);
  });

  it('reports no providers when no OAuth credentials are configured', async () => {
    const result = await getCapabilitiesResponse();
    expect(result.providers).toEqual({ microsoft: false, google: false });
  });

  it('reports google when its credentials resolve from the secret provider', async () => {
    getAppSecretMock.mockImplementation(async (key) =>
      key === 'GOOGLE_OAUTH_CLIENT_ID' ? 'gid' : key === 'GOOGLE_OAUTH_CLIENT_SECRET' ? 'gsecret' : null,
    );
    const result = await getCapabilitiesResponse();
    expect(result.providers).toEqual({ microsoft: false, google: true });
  });

  it('reports microsoft when its credentials resolve from env fallback', async () => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'mid';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'msecret';
    const result = await getCapabilitiesResponse();
    expect(result.providers).toEqual({ microsoft: true, google: false });
  });

  it('requires both client id and secret', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
    const result = await getCapabilitiesResponse();
    expect(result.providers.google).toBe(false);
  });

  it('fails open when the secret provider throws', async () => {
    getAppSecretMock.mockRejectedValue(new Error('secrets unavailable'));
    const result = await getCapabilitiesResponse();
    expect(result.providers).toEqual({ microsoft: true, google: true });
  });

  it('omits the allowlist when unset and parses it when set', async () => {
    expect((await getCapabilitiesResponse()).hostedDomainAllowlist).toBeUndefined();

    process.env.ALGA_MOBILE_HOST_ALLOWLIST = 'helpdesk.acme.com, other.example.com';
    expect((await getCapabilitiesResponse()).hostedDomainAllowlist).toEqual([
      'helpdesk.acme.com',
      'other.example.com',
    ]);
  });
});
