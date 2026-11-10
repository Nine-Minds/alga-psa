import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  lookup: vi.fn(),
  post: vi.fn(),
  connect: vi.fn(),
  logout: vi.fn(),
  getTenantSecret: vi.fn(),
  setTenantSecret: vi.fn(),
  deleteTenantSecret: vi.fn(),
  imapOptions: [] as Array<Record<string, any>>,
  provider: { id: 'provider-1', tenant: 'tenant-1', provider_type: 'imap', mailbox: 'a@example.test', is_active: true, status: 'disconnected' },
  config: {} as Record<string, any>,
  tableCalls: [] as string[],
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => mocks.lookup(...args) },
  lookup: (...args: unknown[]) => mocks.lookup(...args),
}));
vi.mock('axios', () => ({ default: { post: mocks.post } }));
vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function (this: any, options: Record<string, any>) {
    mocks.imapOptions.push(options);
    this.connect = (...args: unknown[]) => mocks.connect(...args);
    this.logout = (...args: unknown[]) => mocks.logout(...args);
  }),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: (name: string) => {
      mocks.tableCalls.push(name);
      const query: any = {
        where: () => query,
        first: async () => name === 'email_providers' ? mocks.provider : mocks.config,
        update: async () => 1,
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: mocks.getTenantSecret,
    setTenantSecret: mocks.setTenantSecret,
    deleteTenantSecret: mocks.deleteTenantSecret,
  }),
}));

const imapProvider = { ...mocks.provider };
function setupConfig(overrides: Record<string, unknown> = {}) {
  mocks.config = {
    email_provider_id: 'provider-1',
    host: 'imap.example.test', port: 993, secure: true, username: 'mailbox', auth_type: 'oauth2',
    oauth_token_url: 'https://login.example.test/token', oauth_client_id: 'client-id',
    oauth_credentials_token_url: 'https://login.example.test/token', oauth_credentials_secret_version: 1,
    access_token: null, token_expires_at: null, refresh_token: 'refresh-token',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableCalls.length = 0;
  mocks.imapOptions.length = 0;
  mocks.provider = { ...imapProvider };
  setupConfig();
  mocks.createTenantKnex.mockResolvedValue({ knex: { fn: { now: () => new Date() } } });
  mocks.hasPermission.mockResolvedValue(true);
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.post.mockResolvedValue({ data: { access_token: 'new-access', expires_in: 3600 } });
  mocks.connect.mockResolvedValue(undefined);
  mocks.logout.mockResolvedValue(undefined);
  mocks.getTenantSecret.mockImplementation(async (_tenant: string, key: string) =>
    key.includes('refresh_token') ? 'refresh-token' : key.includes('client_secret') ? 'client-secret' : undefined);
});

describe('IMAP outbound target protections', () => {
  it.each(['https://127.0.0.1/token', 'https://10.0.0.5/token', 'https://169.254.169.254/latest/meta-data'])('rejects OAuth token endpoint %s before reading credentials or posting', async (tokenUrl) => {
      setupConfig({ oauth_token_url: tokenUrl, oauth_credentials_token_url: tokenUrl });
      const { testEmailProviderConnection } = await import('./emailProviderActions');

      const result = await testEmailProviderConnection('provider-1');

      expect(result).toEqual({ success: false, error: 'IMAP OAuth token endpoint is not an allowed target.', errorCode: 'missing_config' });
      expect(mocks.getTenantSecret).not.toHaveBeenCalled();
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
    });

  it('rejects a DNS name with a private answer before posting credentials', async () => {
    setupConfig({ oauth_token_url: 'https://token.internal.example/token' });
    mocks.lookup.mockResolvedValue([{ address: '172.20.4.9', family: 4 }]);
    const { testEmailProviderConnection } = await import('./emailProviderActions');

    const result = await testEmailProviderConnection('provider-1');

    expect(result).toMatchObject({ success: false, errorCode: 'missing_config' });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('rejects a private IMAP destination before requesting OAuth tokens or connecting', async () => {
    setupConfig({ host: '127.0.0.1' });
    const { testEmailProviderConnection } = await import('./emailProviderActions');

    const result = await testEmailProviderConnection('provider-1');

    expect(result).toEqual({ success: false, error: 'IMAP server is not an allowed target.', errorCode: 'missing_config' });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([25, 110, 1430])('rejects IMAP port %s before reading credentials or connecting', async (port) => {
    setupConfig({ port, auth_type: 'password' });
    const { testEmailProviderConnection } = await import('./emailProviderActions');

    const result = await testEmailProviderConnection('provider-1');

    expect(result).toMatchObject({ success: false, errorCode: 'missing_config' });
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('does not follow a token endpoint redirect with credentials', async () => {
    mocks.post.mockRejectedValue(new Error('Request failed with status code 302'));
    const { testEmailProviderConnection } = await import('./emailProviderActions');

    const result = await testEmailProviderConnection('provider-1');

    expect(result).toMatchObject({ success: false, errorCode: 'oauth_refresh_failed' });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('https://login.example.test/token', expect.any(URLSearchParams), expect.objectContaining({ maxRedirects: 0, proxy: false }));
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('keeps public endpoints usable and allows a deployment-listed private IMAP host', async () => {
    const oldAllowlist = process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
    mocks.lookup.mockResolvedValue([{ address: '10.10.2.20', family: 4 }]);
    try {
      const { testEmailProviderConnection } = await import('./emailProviderActions');
      delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
      mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const publicResult = await testEmailProviderConnection('provider-1');
      expect(publicResult).toEqual({ success: true });
      expect(mocks.post).toHaveBeenCalledTimes(1);
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      const httpLookup = mocks.post.mock.calls[0][2].httpsAgent.options.lookup;
      const imapLookup = mocks.imapOptions[0].tls.lookup;
      mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const resolvePinned = (lookup: Function) => new Promise((resolve, reject) =>
        lookup('imap.internal.example', { all: true }, (error: Error | null, addresses: unknown) =>
          error ? reject(error) : resolve(addresses)
        )
      );
      await expect(resolvePinned(httpLookup)).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);
      await expect(resolvePinned(imapLookup)).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);

      process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = 'imap.internal.example';
      setupConfig({ host: 'imap.internal.example', auth_type: 'password', access_token: 'already-authorized' });
      mocks.getTenantSecret.mockResolvedValue('mailbox-password');
      mocks.lookup.mockResolvedValue([{ address: '10.10.2.20', family: 4 }]);
      const privateResult = await testEmailProviderConnection('provider-1');
      expect(privateResult).toEqual({ success: true });
      expect(mocks.connect).toHaveBeenCalledTimes(2);
    } finally {
      if (oldAllowlist === undefined) delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
      else process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = oldAllowlist;
    }
  });
});
