import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  lookup: vi.fn(),
  getTenantSecret: vi.fn(),
  update: vi.fn(),
}));

vi.mock('axios', () => ({ default: { post: mocks.post } }));
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => mocks.lookup(...args) },
  lookup: (...args: unknown[]) => mocks.lookup(...args),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: mocks.getTenantSecret }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({ where: () => ({ update: (...args: unknown[]) => mocks.update(...args) }) }),
  }),
}));

import { getImapOauthAuthorizationCredentials, refreshImapAccessToken } from '../imapOauthToken';

const provider = {
  id: 'imap-1',
  tenant: 'tenant-1',
  oauth_token_url: 'https://login.example.test/token',
  oauth_credentials_token_url: 'https://login.example.test/token',
  oauth_credentials_secret_version: 1,
  oauth_client_id: 'client-1',
  oauth_client_secret: null,
  refresh_token: null,
};

describe('shared IMAP OAuth refresh outbound policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mocks.getTenantSecret.mockResolvedValue('bound-refresh-token');
    mocks.post.mockResolvedValue({ data: { access_token: 'access-1', expires_in: 3600 } });
    mocks.update.mockResolvedValue(1);
  });

  it('rejects private token endpoints before reading fallback credentials or posting', async () => {
    await expect(refreshImapAccessToken({
      provider: { ...provider, oauth_token_url: 'https://127.0.0.1/token', oauth_credentials_token_url: 'https://127.0.0.1/token' },
      db: {} as any,
    })).rejects.toThrow(/blocked private address/);

    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('disables redirects when posting refresh credentials to a public token endpoint', async () => {
    mocks.post.mockRejectedValue(new Error('Request failed with status code 302'));

    await expect(refreshImapAccessToken({ provider, db: {} as any })).rejects.toThrow('302');

    expect(mocks.post).toHaveBeenCalledWith(
      provider.oauth_token_url,
      expect.any(URLSearchParams),
      expect.objectContaining({ maxRedirects: 0 })
    );
  });

  it('refuses to consult legacy secret names after the issuer binding is cleared', async () => {
    await expect(refreshImapAccessToken({
      provider: { ...provider, oauth_token_url: 'https://issuer-two.example.test/token', oauth_credentials_token_url: null },
      db: {} as any,
    })).rejects.toThrow(/reauthorized/);
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('uses only the configured application secret before mailbox authorization', async () => {
    const credentials = await getImapOauthAuthorizationCredentials({
      ...provider,
      oauth_credentials_token_url: null,
      oauth_client_secret: 'fresh-client-secret',
      refresh_token: 'unbound-refresh-must-not-be-used',
    });

    expect(credentials).toEqual({ clientSecret: 'fresh-client-secret', refreshToken: null });
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('keeps background refresh blocked while an application secret awaits mailbox authorization', async () => {
    await expect(refreshImapAccessToken({
      provider: { ...provider, oauth_credentials_token_url: null, oauth_client_secret: 'fresh-client-secret' },
      db: {} as any,
    })).rejects.toThrow(/reauthorized/);

    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('does not forward a DB client secret marked as belonging to a different issuer', async () => {
    await expect(getImapOauthAuthorizationCredentials({
      ...provider,
      oauth_credentials_token_url: 'https://old-issuer.example.test/token',
      oauth_client_secret: 'old-client-secret',
    })).resolves.toEqual({ clientSecret: null, refreshToken: null });

    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });
});
