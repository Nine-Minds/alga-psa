import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  clients: [] as any[],
  leaseUpdates: 0,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ({ fn: { now: () => new Date().toISOString() } })),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    tenantJoin: () => undefined,
    unscoped: () => {
      const query: any = {
        where: () => query,
        andWhere: () => query,
        whereNull: () => query,
        select: async () => mocks.rows,
        update: async () => 1,
      };
      return query;
    },
    table: () => {
      const query: any = {
        where: () => query,
        andWhere: () => query,
        first: async () => ({ inbound_paused_at: null, inbound_pause_reason: null }),
        update: async () => {
          mocks.leaseUpdates += 1;
          return 1;
        },
      };
      return query;
    },
  })),
}));

vi.mock('@alga-psa/shared/services/net/outboundAddressPolicy', () => ({
  assertSafeOutboundHost: vi.fn(async () => undefined),
}));

vi.mock('imapflow', () => ({
  ImapFlow: class MockImapFlow {
    options: any;
    logout = vi.fn(async () => undefined);
    on = vi.fn();
    connect = vi.fn(() => new Promise(() => {}));

    constructor(options: any) {
      this.options = options;
      mocks.clients.push(this);
    }
  },
}));

import { EmailService } from './emailService';

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    tenant: 'tenant-1',
    provider_name: 'IMAP',
    mailbox: 'user@example.test',
    is_active: true,
    status: 'connected',
    host: 'imap.example.test',
    port: 993,
    secure: true,
    allow_starttls: false,
    auth_type: 'oauth2',
    username: 'user@example.test',
    credential_generation: 'generation-old',
    auto_process_emails: false,
    max_emails_per_sync: 5,
    folder_filters: ['INBOX'],
    oauth_token_url: 'https://login.example.test/token',
    oauth_client_id: 'client-id',
    access_token: 'access-token-old',
    token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

async function waitForClientCount(count: number) {
  await vi.waitFor(() => expect(mocks.clients).toHaveLength(count));
}

describe('EmailService provider refresh credential generations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.IMAP_STARTUP_STAGGER_MS = '0';
    process.env.IMAP_CONNECTION_TIMEOUT_MS = '60000';
    mocks.rows = [provider()];
    mocks.clients = [];
    mocks.leaseUpdates = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.IMAP_STARTUP_STAGGER_MS;
    delete process.env.IMAP_CONNECTION_TIMEOUT_MS;
  });

  it('replaces OAuth listeners after a generation-only scope rotation and uses the current token', async () => {
    const service = new EmailService();
    await (service as any).refreshProviders();
    await waitForClientCount(1);

    mocks.rows = [provider({
      credential_generation: 'generation-new',
      oauth_client_id: 'replacement-client-id',
      access_token: 'access-token-new',
    })];
    await (service as any).refreshProviders();
    await waitForClientCount(2);

    expect(mocks.clients[0].logout).toHaveBeenCalled();
    expect(mocks.clients[1].options.auth).toEqual(expect.objectContaining({
      user: 'user@example.test',
      accessToken: 'access-token-new',
    }));
    await service.stop();
    vi.clearAllTimers();
  });

  it('renews the lease without restarting listeners when the generation is unchanged', async () => {
    const service = new EmailService();
    await (service as any).refreshProviders();
    await waitForClientCount(1);

    mocks.rows = [provider({ access_token: 'new-token-same-scope' })];
    await (service as any).refreshProviders();

    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0].logout).not.toHaveBeenCalled();
    expect(mocks.leaseUpdates).toBe(2);
    await service.stop();
    vi.clearAllTimers();
  });

  it('updates existing listener snapshots after a same-generation OAuth reconnect', async () => {
    const service = new EmailService();
    await (service as any).refreshProviders();
    await waitForClientCount(1);

    const worker = (service as any).workers.get('provider-1');
    const listener = worker.listeners[0];
    const workerId = worker.workerId;
    const listenerId = listener.listenerId;
    mocks.rows = [provider({ access_token: 'access-token-reconnected' })];
    await (service as any).refreshProviders();

    const nextClient = await listener.buildClient();

    expect(nextClient.options.auth.accessToken).toBe('access-token-reconnected');
    expect((service as any).workers.get('provider-1')).toBe(worker);
    expect(worker.workerId).toBe(workerId);
    expect(worker.listeners[0]).toBe(listener);
    expect(listener.listenerId).toBe(listenerId);
    expect(mocks.clients[0].logout).not.toHaveBeenCalled();
    await service.stop();
    vi.clearAllTimers();
  });

  it('refreshes a listener snapshot after OAuth reconnect when it started without tokens', async () => {
    const service = new EmailService();
    mocks.rows = [provider({ access_token: null })];
    await (service as any).refreshProviders();

    const worker = (service as any).workers.get('provider-1');
    const listener = worker.listeners[0];
    const workerId = worker.workerId;
    const listenerId = listener.listenerId;
    expect(mocks.clients).toHaveLength(0);

    mocks.rows = [provider({ access_token: 'access-token-after-reconnect' })];
    await (service as any).refreshProviders();
    const nextClient = await listener.buildClient();

    expect(nextClient.options.auth.accessToken).toBe('access-token-after-reconnect');
    expect((service as any).workers.get('provider-1')).toBe(worker);
    expect(worker.workerId).toBe(workerId);
    expect(worker.listeners[0]).toBe(listener);
    expect(listener.listenerId).toBe(listenerId);
    await service.stop();
    vi.clearAllTimers();
  });
});
