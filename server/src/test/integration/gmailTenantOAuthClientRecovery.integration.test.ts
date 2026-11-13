/**
 * alga-2026-0002844 — Gmail refresh must use the tenant's OAuth client.
 *
 * T003: the Google callback records the issuing client_id; a later refresh
 *       after the tenant swapped OAuth clients makes no Google call and writes
 *       the reconnect-required error.
 * T005: a google provider in status='error' with an expired watch is renewed
 *       by renew-google-gmail-watch, ends 'connected', and the missed interval
 *       is enqueued once; a rejected history id falls back to the
 *       last_sync_at-bounded time query.
 * T006: re-running the recovery reconciliation, or running it over mail that
 *       was already ingested, creates no duplicate ingress rows (the keys the
 *       durable pipeline dedupes tickets/comments on).
 *
 * Google is mocked everywhere; no real network calls.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const tenantSecrets = vi.hoisted(() => ({} as Record<string, string | null>));
const gmailMock = vi.hoisted(() => ({
  listMessagesSince: vi.fn(),
  listMessageIdsSinceTime: vi.fn(),
  refreshAccessToken: vi.fn(),
  registerWatch: vi.fn(),
}));
const axiosMock = vi.hoisted(() => ({ post: vi.fn() }));
const enqueueMock = vi.hoisted(() => ({ enqueueUnifiedInboundEmailQueueJob: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ tenant: '' }));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in gmail recovery tests');
  },
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => testDb }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (_t: string, key: string) => tenantSecrets[key] ?? null,
    setTenantSecret: async () => undefined,
    getAppSecret: async () => undefined,
  }),
}));

vi.mock('axios', () => ({ default: { post: axiosMock.post, create: () => ({ interceptors: { request: { use() {} } } }) } }));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(public clientId?: string, public clientSecret?: string) {}
    setCredentials() {}
    async refreshAccessToken() {
      return gmailMock.refreshAccessToken(this.clientId, this.clientSecret);
    }
  },
}));
vi.mock('googleapis', () => ({ google: { gmail: () => ({}) } }));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/unifiedInboundEmailQueue')>();
  return { ...actual, enqueueUnifiedInboundEmailQueueJob: enqueueMock.enqueueUnifiedInboundEmailQueueJob };
});

// Lifecycle reconciler's adapter: listing is mocked, history rejection simulated.
vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    constructor(public config: any) {}
    async listMessagesSince(id: string) {
      return gmailMock.listMessagesSince(id);
    }
    async listMessageIdsSinceTime(since: Date, max?: number, opts?: unknown) {
      return gmailMock.listMessageIdsSinceTime(since, max, opts);
    }
  },
}));

// configureGmailProvider collaborators: Pub/Sub provisioning and the watch call.
vi.mock('@alga-psa/integrations/actions/email-actions/setupPubSub', () => ({ setupPubSub: async () => undefined }));
vi.mock('../../../../packages/integrations/src/actions/email-actions/setupPubSub', () => ({ setupPubSub: async () => undefined }));
vi.mock('../../../../packages/integrations/src/utils/email/gmailPubSub', () => ({
  getGmailPubSubNames: async () => ({
    topicName: 'topic',
    subscriptionName: 'sub',
    webhookUrl: 'https://psa.example.test/api/email/webhooks/google',
  }),
}));
vi.mock('../../../../packages/integrations/src/services/email/GmailWebhookService', () => ({
  GmailWebhookService: class {
    async registerWatch(config: any) {
      const result = await gmailMock.registerWatch(config);
      if (result?.success) {
        // Faithful to the real adapter: the new watch overwrites history_id.
        await tenantDb(testDb, testTenant)
          .table('google_email_provider_config')
          .where({ email_provider_id: config.id })
          .update({ history_id: '9999', watch_expiration: new Date(Date.now() + 7 * 864e5).toISOString() });
      }
      return result;
    }
  },
}));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testDb, tenant: testTenant }),
    runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
  };
});
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: async () => ({ tenant: sessionMock.tenant, user_id: 'u1' }),
}));
vi.mock('../../lib/db', () => ({
  createTenantKnex: async () => ({ knex: testDb, tenant: testTenant }),
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('next/headers.js', () => ({ headers: async () => new Headers() }));

const t = <Row = Record<string, unknown>>(table: string) => tenantDb(testDb, testTenant).table<Row>(table);

async function seedGoogleProvider(opts: {
  status?: string;
  clientId?: string | null;
  historyId?: string | null;
  lastSyncAt?: Date | null;
}) {
  const providerId = uuidv4();
  const now = new Date();
  await t('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'google',
    provider_name: 'Gmail recovery',
    mailbox: `gmail-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: opts.status ?? 'error',
    error_message: 'Gmail watch registration failed ... unauthorized_client (code: 401)',
    last_sync_at: opts.lastSyncAt === undefined ? new Date(Date.now() - 3 * 864e5) : opts.lastSyncAt,
    created_at: now,
    updated_at: now,
  });
  await t('google_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: opts.clientId ?? null,
    project_id: 'project',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify([]),
    access_token: 'old-access',
    refresh_token: 'refresh',
    token_expires_at: new Date(Date.now() - 3600_000).toISOString(),
    history_id: opts.historyId === undefined ? '1500' : opts.historyId,
    watch_expiration: new Date(Date.now() - 864e5).toISOString(),
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

const provider = (id: string) => t('email_providers').where({ id }).first();
const googleCfg = (id: string) => t('google_email_provider_config').where({ email_provider_id: id }).first();
const ingressCount = async (providerId: string) =>
  Number(
    (await t('inbound_email_ingress').where({ provider_id: providerId }).count<{ count: string }[]>('* as count'))[0].count
  );

describeDb('Gmail tenant OAuth client + error recovery (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    sessionMock.tenant = testTenant;
    await tenantDb(testDb, testTenant)
      .unscoped('tenants', 'gmail recovery test fixture creates and removes tenant rows')
      .insert({ tenant: testTenant, client_name: 'Gmail Recovery Client', email: 'gmail@client.com', created_at: new Date(), updated_at: new Date() });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await t('email_processed_messages').delete();
      await t('inbound_email_ingress').delete();
      await t('google_email_provider_config').delete();
      await t('email_providers').delete();
      await tenantDb(testDb, testTenant).unscoped('tenants', 'cleanup').where({ tenant: testTenant }).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(async () => {
    // Each test owns the tenant's providers: the renewal job renews every due provider.
    await t('email_processed_messages').delete();
    await t('inbound_email_ingress').delete();
    await t('google_email_provider_config').delete();
    await t('email_providers').delete();
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    for (const k of Object.keys(tenantSecrets)) delete tenantSecrets[k];
    tenantSecrets.google_client_id = 'tenant-client';
    tenantSecrets.google_client_secret = 'tenant-secret';
    process.env.GOOGLE_CLIENT_ID = 'alga-env-client';
    process.env.GOOGLE_CLIENT_SECRET = 'alga-env-secret';
    gmailMock.listMessagesSince.mockReset().mockResolvedValue(['m-1', 'm-2']);
    gmailMock.listMessageIdsSinceTime.mockReset().mockResolvedValue(['m-fb-1']);
    gmailMock.refreshAccessToken.mockReset();
    gmailMock.registerWatch.mockReset().mockResolvedValue({ success: true });
    axiosMock.post.mockReset();
    enqueueMock.enqueueUnifiedInboundEmailQueueJob.mockReset().mockResolvedValue({ job: {}, queueDepth: 1 });
  });

  afterEach(() => {
    // T003 stubs configureGmailProvider for the callback import. The server
    // integration config shuffles tests, so drop that stub and the module
    // registry here or a later T005/T006 renewal would run against it.
    vi.doUnmock('@alga-psa/integrations/actions/email-actions/configureGmailProvider');
    vi.resetModules();
  });

  it('T003: callback stores the issuing client_id; a later client change fails without calling Google', async () => {
    const providerId = await seedGoogleProvider({ status: 'connected', clientId: null });
    axiosMock.post.mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } });
    vi.doMock('@alga-psa/integrations/actions/email-actions/configureGmailProvider', () => ({
      configureGmailProvider: async () => ({ success: true, warnings: [] }),
    }));
    const { GET } = await import('../../app/api/auth/google/callback/route');
    const state = Buffer.from(
      JSON.stringify({ tenant: testTenant, providerId, redirectUri: 'https://psa.example.test/api/auth/google/callback' })
    ).toString('base64');
    await GET({ nextUrl: new URL(`https://psa.example.test/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`) } as any);

    // The code was exchanged with the tenant's client, never the env client.
    expect(axiosMock.post.mock.calls[0][1]).toContain('client_id=tenant-client');
    expect((await googleCfg(providerId)).client_id).toBe('tenant-client');

    // Tenant replaces their Google app; refresh must not reach Google.
    tenantSecrets.google_client_id = 'replacement-client';
    tenantSecrets.google_client_secret = 'replacement-secret';
    const { GmailAdapter } = await vi.importActual<typeof import('@alga-psa/shared/services/email/providers/GmailAdapter')>(
      '@alga-psa/shared/services/email/providers/GmailAdapter'
    );
    const cfg = await googleCfg(providerId);
    const adapter: any = new GmailAdapter({
      id: providerId,
      tenant: testTenant,
      provider_type: 'google',
      provider_config: { ...cfg, token_expires_at: new Date(Date.now() - 1000).toISOString() },
    } as any);
    adapter.refreshToken = 'new-refresh';
    await expect(adapter.refreshAccessToken()).rejects.toThrow(/client changed/i);
    expect(gmailMock.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('T005: renewal recovers a status=error provider and enqueues the missed interval once', async () => {
    const providerId = await seedGoogleProvider({ status: 'error', historyId: '1500' });
    const { renewGoogleGmailWatchSubscriptions } = await import(
      '../../../../packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler'
    );

    await renewGoogleGmailWatchSubscriptions({ tenantId: testTenant });

    const row = await provider(providerId);
    expect(row.status).toBe('connected');
    expect(row.error_message).toBeNull();
    expect(gmailMock.listMessagesSince).toHaveBeenCalledWith('1500'); // pre-watch cursor, not 9999
    expect(gmailMock.listMessageIdsSinceTime).not.toHaveBeenCalled();
    expect(await ingressCount(providerId)).toBe(2);
  });

  it('T005: a rejected history id falls back to the last_sync_at-bounded time query', async () => {
    const lastSync = new Date(Date.now() - 5 * 864e5);
    const providerId = await seedGoogleProvider({ status: 'error', historyId: '1500', lastSyncAt: lastSync });
    const rejected: any = new Error('Requested entity was not found.');
    rejected.code = 'gmail.historyIdNotFound';
    gmailMock.listMessagesSince.mockRejectedValue(rejected);
    const { renewGoogleGmailWatchSubscriptions } = await import(
      '../../../../packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler'
    );

    await renewGoogleGmailWatchSubscriptions({ tenantId: testTenant });

    expect(gmailMock.listMessageIdsSinceTime).toHaveBeenCalledTimes(1);
    const [since, , opts] = gmailMock.listMessageIdsSinceTime.mock.calls[0];
    expect(new Date(since).getTime()).toBe(lastSync.getTime());
    expect(opts).toEqual({ paginateAll: true });
    expect((await provider(providerId)).status).toBe('connected');
    expect(await ingressCount(providerId)).toBe(1);
  });

  it('T005: a failed reconciliation leaves the provider in error with the pre-watch cursor restored for retry', async () => {
    const providerId = await seedGoogleProvider({ status: 'error', historyId: '1500' });
    gmailMock.listMessagesSince.mockRejectedValue(new Error('boom'));
    const { renewGoogleGmailWatchSubscriptions } = await import(
      '../../../../packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler'
    );

    await renewGoogleGmailWatchSubscriptions({ tenantId: testTenant });

    const row = await provider(providerId);
    expect(row.status).toBe('error');
    expect(row.error_message).toMatch(/could not be recovered yet/);
    expect((await googleCfg(providerId)).history_id).toBe('1500');
    // Made due for the very next renewal run (not ~6.75 days out).
    expect((await googleCfg(providerId)).watch_expiration).toBeNull();
    const failedSync = (await provider(providerId)).last_sync_at;
    expect(await ingressCount(providerId)).toBe(0);

    // Next renewal run selects it again (watch registered once more) and,
    // with the reconciler healthy, recovers and enqueues the gap exactly once.
    gmailMock.registerWatch.mockClear();
    gmailMock.listMessagesSince.mockReset().mockResolvedValue(['m-1', 'm-2']);
    await renewGoogleGmailWatchSubscriptions({ tenantId: testTenant });
    expect(gmailMock.registerWatch).toHaveBeenCalledTimes(1);
    expect(gmailMock.listMessagesSince).toHaveBeenCalledWith('1500');
    const recovered = await provider(providerId);
    expect(recovered.status).toBe('connected');
    expect(recovered.error_message).toBeNull();
    expect(await ingressCount(providerId)).toBe(2);
    expect(new Date(recovered.last_sync_at).getTime()).toBeGreaterThan(new Date(failedSync).getTime());

    // A further run does not re-select it (fresh watch) nor duplicate mail.
    await renewGoogleGmailWatchSubscriptions({ tenantId: testTenant });
    expect(gmailMock.registerWatch).toHaveBeenCalledTimes(1);
    expect(await ingressCount(providerId)).toBe(2);
  });

  it('T006: running the reconciliation twice, or over already-ingested mail, creates no duplicates', async () => {
    const providerId = await seedGoogleProvider({ status: 'error', historyId: '1500' });
    const { EmailProviderLifecycleService } = await import('@alga-psa/shared/services/email/EmailProviderLifecycleService');
    const service = new EmailProviderLifecycleService();
    const params = { providerId, tenant: testTenant, since: new Date(Date.now() - 864e5), savedHistoryId: '1500' };

    // m-1 was already ingested (same pointer shape) before the outage window ended.
    gmailMock.listMessagesSince.mockResolvedValue(['m-1']);
    await service.reconcileGoogleDeliveryGap(params);
    expect(await ingressCount(providerId)).toBe(1);

    gmailMock.listMessagesSince.mockResolvedValue(['m-1', 'm-2']);
    await service.reconcileGoogleDeliveryGap(params);
    await service.reconcileGoogleDeliveryGap(params);
    expect(await ingressCount(providerId)).toBe(2);
    const keys = (await t('inbound_email_ingress').where({ provider_id: providerId }).select('ingress_key')).map((r: any) => r.ingress_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
