import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImapOauthSecretNames } from '@alga-psa/shared/services/email/imapOutboundTarget';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  axiosPost: vi.fn(),
  dnsLookup: vi.fn(),
  getTenantSecret: vi.fn(),
  imapConstructed: vi.fn(),
  imapConnect: vi.fn(),
  inboundAuthFailure: vi.fn(),
  inboundAccessSuccess: vi.fn(),
  listenerError: vi.fn(),
  configUpdates: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, any>>,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (db: any, tenant: string) => {
    if (tenant === 'imap-provider-discovery') {
      const query: any = {
        where: () => query,
        andWhere: () => query,
        whereNull: () => query,
        select: async () => mocks.rows,
        update: async (values: Record<string, unknown>) => {
          mocks.configUpdates.push(values);
          return 1;
        },
      };
      return {
        unscoped: () => query,
        tenantJoin: () => query,
        table: (name: string) => db(name),
      };
    }
    return {
      table: (name: string) => db(name),
      unscoped: (_name: string, _reason: string) => db('imap_email_provider_config'),
    };
  },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: mocks.getTenantSecret }),
}));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => mocks.dnsLookup(...args) },
  lookup: (...args: unknown[]) => mocks.dnsLookup(...args),
}));
vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function ImapFlow(options: unknown) {
    mocks.imapConstructed(options);
    return {
      connect: (...args: unknown[]) => mocks.imapConnect(...args),
      logout: vi.fn(async () => undefined),
      close: vi.fn(),
      on: vi.fn(),
      list: vi.fn(async () => [{ path: 'INBOX' }]),
      mailboxOpen: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {}),
      idle: vi.fn(async () => undefined),
      socket: { setKeepAlive: vi.fn() },
      capabilities: new Set(),
    };
  }),
}));
vi.mock('@alga-psa/shared/services/email/inboundEmailAuthOutcomeRecorder', () => ({
  recordInboundSourceAccessSuccess: (...args: unknown[]) => mocks.inboundAccessSuccess(...args),
  recordInboundSourceAuthFailure: (...args: unknown[]) => mocks.inboundAuthFailure(...args),
}));
vi.mock('@alga-psa/shared/services/email/inboundEmailMetrics', () => ({
  recordImapListenerError: (...args: unknown[]) => mocks.listenerError(...args),
  recordImapWebhookDispatchRetry: vi.fn(),
}));

import { EmailService } from './emailService';

function providerRow(overrides: Record<string, unknown> = {}) {
  const tokenUrl = 'https://login.example.test/token';
  return {
    id: 'imap-provider-1', tenant: 'tenant-1', provider_name: 'Support',
    mailbox: 'support@example.test', is_active: true, status: 'connected',
    error_message: null, last_sync_at: null, host: 'imap.example.test', port: 993,
    secure: true, allow_starttls: false, auth_type: 'oauth2', username: 'support@example.test',
    auto_process_emails: true, max_emails_per_sync: 5, folder_filters: ['INBOX'],
    oauth_token_url: tokenUrl, oauth_credentials_token_url: tokenUrl,
    oauth_credentials_secret_version: 1, oauth_client_id: 'imap-client',
    oauth_client_secret: null, oauth_scopes: null, access_token: null,
    refresh_token: null, token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    uid_validity: null, last_uid: null, last_seen_at: null, last_sync_at_cfg: null,
    last_error: null, folder_state: {}, last_processed_message_id: null,
    server_capabilities: null, lease_owner: null, lease_expires_at: null,
    connection_timeout_ms: 1000, socket_keepalive: true,
    ...overrides,
  };
}

function createDb() {
  const db: any = (table: string) => {
    const query: any = {
      where: () => query,
      andWhere(callback: unknown) {
        if (typeof callback === 'function') (callback as Function).call(query);
        return query;
      },
      orWhere: () => query,
      whereNull: () => query,
      first: async () => table === 'email_providers'
        ? { inbound_paused_at: '2026-11-09T00:00:00.000Z', inbound_pause_reason: 'auth_failure' }
        : undefined,
      update: async (values: Record<string, unknown>) => {
        if (table === 'imap_email_provider_config') mocks.configUpdates.push(values);
        return 1;
      },
    };
    return query;
  };
  db.fn = { now: () => new Date().toISOString() };
  return db;
}

async function startListeners(rows: Array<Record<string, any>>) {
  const db = createDb();
  mocks.rows = rows;
  mocks.getAdminConnection.mockResolvedValue(db);
  const service = new EmailService();
  await (service as any).refreshProviders();
  return service;
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('email-service IMAP outbound security', () => {
  const previousEnv = new Map<string, string | undefined>();
  const envNames = ['IMAP_STARTUP_STAGGER_MS', 'IMAP_MAX_CONNECTIONS_PER_TENANT', 'EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST'];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configUpdates.length = 0;
    mocks.rows = [];
    mocks.dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) => {
      if (name.includes('_client_secret')) return 'endpoint-scoped-client-secret';
      if (name.includes('_refresh_token')) return 'endpoint-scoped-refresh-token';
      return 'mailbox-password';
    });
    mocks.axiosPost.mockResolvedValue({ data: { access_token: 'listener-access-token', expires_in: 3600 } });
    mocks.imapConnect.mockRejectedValue(new Error('test socket closed after construction'));
    mocks.inboundAuthFailure.mockResolvedValue(undefined);
    mocks.inboundAccessSuccess.mockResolvedValue(undefined);
    for (const name of envNames) {
      previousEnv.set(name, process.env[name]);
    }
    process.env.IMAP_STARTUP_STAGGER_MS = '0';
    process.env.IMAP_MAX_CONNECTIONS_PER_TENANT = '5';
    delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
  });

  afterEach(() => {
    for (const name of envNames) {
      const value = previousEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('rejects prohibited IMAP hosts before constructing a listener socket', async () => {
    const service = await startListeners([providerRow({ host: '127.0.0.1', auth_type: 'password' })]);
    await tick();
    expect(mocks.imapConstructed).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    await service.stop();
  });

  it('rejects private OAuth endpoints before reading fallback credentials or posting', async () => {
    const row = providerRow({
      oauth_token_url: 'https://169.254.169.254/token',
      oauth_credentials_token_url: 'https://169.254.169.254/token',
    });
    const service = await startListeners([row]);
    await tick();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.imapConstructed).not.toHaveBeenCalled();
    await service.stop();
  });

  it('posts with redirects disabled and never constructs an IMAP socket after a redirect response', async () => {
    mocks.axiosPost.mockRejectedValue(new Error('Request failed with status code 302'));
    const service = await startListeners([providerRow()]);
    await vi.waitFor(() => expect(mocks.axiosPost).toHaveBeenCalledTimes(1));
    expect(mocks.axiosPost).toHaveBeenCalledWith(
      'https://login.example.test/token',
      expect.any(URLSearchParams),
      expect.objectContaining({ maxRedirects: 0 })
    );
    expect(mocks.imapConstructed).not.toHaveBeenCalled();
    await service.stop();
  });

  it('checks issuer binding before using a cached access token or legacy fallback secret', async () => {
    // Model CompositeSecretProvider returning credentials from the environment
    // after deletion from its write provider. An unbound listener must not ask
    // for these legacy keys and must not forward the cached token either.
    mocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) => {
      if (name === 'imap_refresh_token_imap-provider-1') return 'environment-old-refresh-token';
      if (name === 'imap_oauth_client_secret_imap-provider-1') return 'environment-old-client-secret';
      return null;
    });
    const row = providerRow({
      oauth_token_url: 'https://issuer-new.example.test/token',
      oauth_credentials_token_url: null,
      access_token: 'cached-old-issuer-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const service = await startListeners([row]);
    await tick();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.imapConstructed).not.toHaveBeenCalled();
    await service.stop();
  });

  it('uses endpoint-scoped secrets, persists a refreshed token, and authenticates the mailbox', async () => {
    const row = providerRow();
    const expectedNames = getImapOauthSecretNames(row);
    const service = await startListeners([row]);

    await vi.waitFor(() => expect(mocks.imapConstructed).toHaveBeenCalledTimes(1));
    expect(mocks.getTenantSecret).toHaveBeenCalledWith('tenant-1', expectedNames.refreshToken);
    expect(mocks.getTenantSecret).toHaveBeenCalledWith('tenant-1', expectedNames.clientSecret);
    const form = mocks.axiosPost.mock.calls[0][1] as URLSearchParams;
    expect(form.get('refresh_token')).toBe('endpoint-scoped-refresh-token');
    expect(form.get('client_secret')).toBe('endpoint-scoped-client-secret');
    expect(mocks.configUpdates).toContainEqual(expect.objectContaining({ access_token: 'listener-access-token' }));
    expect(mocks.imapConstructed.mock.calls[0][0]).toMatchObject({
      host: 'imap.example.test',
      auth: { accessToken: 'listener-access-token' },
    });
    const [clientOptions] = mocks.imapConstructed.mock.calls[0];
    const tokenRequest = mocks.axiosPost.mock.calls[0][2];
    const resolvePinned = (lookup: Function) => new Promise((resolve, reject) =>
      lookup('imap.example.test', { all: true }, (error: Error | null, addresses: unknown) =>
        error ? reject(error) : resolve(addresses)
      )
    );
    mocks.dnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(resolvePinned(tokenRequest.httpsAgent.options.lookup)).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    await expect(resolvePinned(clientOptions.tls.lookup)).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    await service.stop();
  });

  it('restarts an active worker when its OAuth issuer binding changes', async () => {
    const row = providerRow({ auth_type: 'password', access_token: null, oauth_credentials_token_url: 'https://issuer-one.example.test/token' });
    const service = await startListeners([row]);
    await vi.waitFor(() => expect(mocks.imapConstructed).toHaveBeenCalledTimes(1));

    row.oauth_token_url = 'https://issuer-two.example.test/token';
    row.oauth_credentials_token_url = null;
    await (service as any).refreshProviders();
    await tick();

    expect(mocks.imapConstructed).toHaveBeenCalledTimes(2);
    await service.stop();
  });
});
