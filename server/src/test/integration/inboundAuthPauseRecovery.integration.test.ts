/**
 * Behavioral integration tests for the auth-failure recovery path
 * (reconnect → validate → re-establish → reconcile → clear) per provider:
 *
 * - the pause remains when credential validation fails;
 * - the saved pause boundary/cursor is used for reconciliation;
 * - a successful reconciliation clears the pause and counters;
 * - repeated ingestion of the same reconciled message is deduped.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { EmailProviderLifecycleService } from '@alga-psa/shared/services/email/EmailProviderLifecycleService';
import type { UnifiedInboundEmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const reconcileMock = vi.hoisted(() => ({ reconcileProviderMessages: vi.fn() }));
const graphAdapterMock = vi.hoisted(() => ({ testConnection: vi.fn() }));
const gmailAdapterMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
  registerWebhookSubscription: vi.fn(),
  listMessagesSince: vi.fn(),
  listMessageIdsSinceTime: vi.fn(),
  getMessageDetails: vi.fn(),
}));
const imapFlowMock = vi.hoisted(() => ({
  instances: [] as any[],
  connectShouldFail: false,
}));
const enqueueMock = vi.hoisted(() => ({ enqueueUnifiedInboundEmailQueueJob: vi.fn() }));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in auth-failure recovery tests');
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async () => 'unit-test-password',
    setTenantSecret: async () => undefined,
    getAppSecret: async () => undefined,
  }),
}));

vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/microsoftEmailProviderConfig')>();
  return {
    ...actual,
    buildMicrosoftEmailProviderConfig: async (config: any) => config,
  };
});

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphError: class MicrosoftGraphError extends Error {},
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    constructor(public config: any) {}
    async testConnection() {
      return graphAdapterMock.testConnection();
    }
    async initializeWebhook() {
      return { success: true, subscriptionId: 'sub-new' };
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    constructor(public config: any) {}
    async connect() {}
    async testConnection() {
      return gmailAdapterMock.testConnection();
    }
    async registerWebhookSubscription() {
      await gmailAdapterMock.registerWebhookSubscription();
      // Faithful to the real adapter: a new watch persists its own (newer)
      // history cursor, overwriting the pre-watch one.
      const { getAdminConnection } = await import('@alga-psa/db/admin');
      const { tenantDb } = await import('@alga-psa/db');
      const knex = await getAdminConnection();
      await tenantDb(knex, this.config.tenant).table('google_email_provider_config')
        .where({ email_provider_id: this.config.id })
        .update({ history_id: '9999' });
    }
    async listMessagesSince(startHistoryId: string) {
      return gmailAdapterMock.listMessagesSince(startHistoryId);
    }
    async listMessageIdsSinceTime(since: Date, maxResults?: number) {
      return gmailAdapterMock.listMessageIdsSinceTime(since, maxResults);
    }
    async getMessageDetails(messageId: string) {
      return gmailAdapterMock.getMessageDetails(messageId);
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/EmailWebhookMaintenanceService', () => ({
  EmailWebhookMaintenanceService: class EmailWebhookMaintenanceService {
    async reconcileProviderMessages(params: any) {
      return reconcileMock.reconcileProviderMessages(params);
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/unifiedInboundEmailQueue')>();
  return {
    ...actual,
    enqueueUnifiedInboundEmailQueueJob: enqueueMock.enqueueUnifiedInboundEmailQueueJob,
  };
});

vi.mock('imapflow', () => ({
  ImapFlow: class ImapFlow {
    constructor(public options: any) {
      imapFlowMock.instances.push(this);
    }
    async connect() {
      if (imapFlowMock.connectShouldFail) {
        const failure: any = new Error('Authentication failed');
        failure.authenticationFailed = true;
        throw failure;
      }
    }
    async logout() {}
    close() {}
  },
}));

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'auth-failure recovery test fixture creates and removes tenant rows'
  );
}

async function seedPausedProvider(
  providerType: 'microsoft' | 'google' | 'imap',
  options: { pausedDaysAgo?: number } = {}
): Promise<{
  providerId: string;
  pausedAt: Date;
}> {
  const providerId = uuidv4();
  const pausedAt = new Date(Date.now() - (options.pausedDaysAgo ?? 0) * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000);
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: providerType,
    provider_name: `Recovery ${providerType}`,
    mailbox: `recovery-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'error',
    error_message: 'Sign-in was rejected by the email provider. Reconnect the mailbox to resume inbound email.',
    inbound_paused_at: pausedAt,
    inbound_pause_reason: 'auth_failure',
    inbound_auth_failure_count: 3,
    inbound_auth_failure_last_at: pausedAt,
    inbound_auth_failure_code: `${providerType}:invalid_grant`,
    created_at: now,
    updated_at: now,
  });

  if (providerType === 'microsoft') {
    await tenantTable('microsoft_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: testTenant,
      client_id: 'client-id',
      client_secret: 'client-secret',
      tenant_id: 'directory-tenant-guid',
      redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: JSON.stringify(['Inbox']),
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delivery_mode: 'polling',
      created_at: now,
      updated_at: now,
    });
  } else if (providerType === 'google') {
    await tenantTable('google_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: testTenant,
      client_id: 'client-id',
      client_secret: 'client-secret',
      project_id: 'project',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      label_filters: JSON.stringify([]),
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      history_id: '1500',
      created_at: now,
      updated_at: now,
    });
  } else {
    await tenantTable('imap_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: testTenant,
      host: 'imap.example.com',
      port: 993,
      secure: true,
      allow_starttls: false,
      auth_type: 'password',
      username: `recovery-${providerId.slice(0, 8)}`,
      folder_filters: JSON.stringify(['INBOX']),
      auto_process_emails: true,
      max_emails_per_sync: 50,
      uid_validity: 'abc',
      last_uid: '400',
      folder_state: JSON.stringify({ INBOX: { uid_validity: 'abc', last_uid: '400' } }),
      created_at: now,
      updated_at: now,
    });
  }
  return { providerId, pausedAt };
}

async function getProviderRow(providerId: string) {
  return tenantTable('email_providers').where({ id: providerId }).first();
}

function googleJob(providerId: string): UnifiedInboundEmailQueueJob {
  return {
    jobId: `job-${uuidv4()}`,
    schemaVersion: 1,
    tenantId: testTenant,
    providerId,
    provider: 'google',
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
    maxAttempts: 5,
    pointer: { historyId: '1500', emailAddress: 'recovery@example.com', discoveredMessageIds: ['g-1'] },
  };
}

describeDb('auth-failure recovery path (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Recovery Test Client',
      email: 'recovery@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('email_processed_messages').delete();
      await tenantTable('inbound_email_ingress').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('imap_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where({ tenant: testTenant }).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    reconcileMock.reconcileProviderMessages.mockReset().mockResolvedValue({ queuedMessages: 4 });
    graphAdapterMock.testConnection.mockReset().mockResolvedValue({ success: true });
    gmailAdapterMock.testConnection.mockReset().mockResolvedValue({ success: true });
    gmailAdapterMock.registerWebhookSubscription.mockReset().mockResolvedValue(undefined);
    gmailAdapterMock.listMessagesSince.mockReset().mockResolvedValue(['g-1', 'g-2']);
    gmailAdapterMock.listMessageIdsSinceTime.mockReset().mockResolvedValue(['g-fb-1']);
    gmailAdapterMock.getMessageDetails.mockReset().mockResolvedValue({
      id: 'g-1',
      provider: 'google',
      providerId: 'x',
      tenant: testTenant,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com' },
      to: [{ email: 'support@example.com' }],
      subject: 'Paused-interval mail',
      body: { text: 'hello' },
      attachments: [],
    });
    enqueueMock.enqueueUnifiedInboundEmailQueueJob.mockReset().mockResolvedValue({ job: {}, queueDepth: 1 });
    imapFlowMock.instances.length = 0;
    imapFlowMock.connectShouldFail = false;
  });

  describe('Microsoft', () => {
    it('keeps the pause when credential validation fails', async () => {
      const { providerId } = await seedPausedProvider('microsoft');
      graphAdapterMock.testConnection.mockResolvedValue({
        success: false,
        error: 'Error in refreshAccessToken: Request failed with status code 400 (code: 400)',
      });

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(false);
      expect(result.reconnectRequired).toBe(true);
      expect(reconcileMock.reconcileProviderMessages).not.toHaveBeenCalled();

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).not.toBeNull();
      expect(row.inbound_pause_reason).toBe('auth_failure');
    });

    it('reconciles from the saved pause boundary and clears the pause on success', async () => {
      const { providerId, pausedAt } = await seedPausedProvider('microsoft');

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
        providerId,
        testTenant,
        { credentialsValidated: true, deliveryEstablished: true }
      );

      expect(result.resumed).toBe(true);
      expect(result.reconciliation).toEqual({ status: 'completed', queuedMessages: 4 });
      expect(reconcileMock.reconcileProviderMessages).toHaveBeenCalledTimes(1);
      const call = reconcileMock.reconcileProviderMessages.mock.calls[0][0];
      expect(call.providerId).toBe(providerId);
      expect(call.tenant).toBe(testTenant);
      expect(new Date(call.since).getTime()).toBe(pausedAt.getTime());

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
      expect(row.inbound_pause_reason).toBeNull();
      expect(Number(row.inbound_auth_failure_count)).toBe(0);
      expect(row.inbound_auth_failure_code).toBeNull();
      expect(row.status).toBe('connected');
    });

    it('routes resumeProvider through the recovery path for auth_failure pauses', async () => {
      const { providerId } = await seedPausedProvider('microsoft');
      graphAdapterMock.testConnection.mockResolvedValue({
        success: false,
        error: 'credentials still rejected',
      });

      const result = await new EmailProviderLifecycleService().resumeProvider(providerId, testTenant);

      // No bare resume: dead credentials cannot clear the pause.
      expect(result.resumed).toBe(false);
      expect(result.reconnectRequired).toBe(true);
      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).not.toBeNull();
    });
  });

  describe('Google', () => {
    it('uses the saved pre-watch history cursor, re-registers the watch, and clears the pause', async () => {
      const { providerId } = await seedPausedProvider('google');

      // No options.savedHistoryId: recovery must snapshot the pre-watch
      // cursor itself, BEFORE registerWebhookSubscription overwrites it with
      // the new watch cursor (regression: this path used to reconcile from
      // the post-watch cursor and silently drop the paused interval).
      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(true);
      expect(result.webhookRegistered).toBe(true);

      // The reconciliation read the PRE-watch cursor, not the new one.
      expect(gmailAdapterMock.listMessagesSince).toHaveBeenCalledWith('1500');
      expect(gmailAdapterMock.listMessagesSince).not.toHaveBeenCalledWith('9999');
      expect(gmailAdapterMock.registerWebhookSubscription).toHaveBeenCalledTimes(1);
      const cursorRow = await tenantTable('google_email_provider_config')
        .where({ email_provider_id: providerId })
        .first('history_id');
      expect(cursorRow.history_id).toBe('9999');

      // One durable enqueue per reconciled message id.
      expect(enqueueMock.enqueueUnifiedInboundEmailQueueJob).toHaveBeenCalledTimes(2);
      const firstEnqueue = enqueueMock.enqueueUnifiedInboundEmailQueueJob.mock.calls[0][0];
      expect(firstEnqueue).toMatchObject({
        tenantId: testTenant,
        providerId,
        provider: 'google',
      });
      expect(firstEnqueue.pointer.discoveredMessageIds).toEqual(['g-1']);
      // The enqueued pointer carries the post-watch cursor so processing does
      // not regress google_email_provider_config.history_id below the new watch.
      expect(firstEnqueue.pointer.historyId).toBe('9999');

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
      expect(Number(row.inbound_auth_failure_count)).toBe(0);
    });

    it('enforce mode: durable pointers carry the post-watch cursor, mailbox identity, and discovered ids (one ingress per message)', async () => {
      const { providerId } = await seedPausedProvider('google');
      const providerRow = await getProviderRow(providerId);

      const prevMode = process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE;
      process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
      try {
        const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);
        expect(result.resumed).toBe(true);

        // No legacy V1 handoff in enforce mode — the durable ingress rows are
        // the hand-off.
        expect(enqueueMock.enqueueUnifiedInboundEmailQueueJob).not.toHaveBeenCalled();

        const rows = await tenantTable('inbound_email_ingress')
          .where({ tenant: testTenant, provider_id: providerId });
        // One ingress row per reconciled message id. Pre-fix every message
        // shared the single deterministic key `history:<pre-watch-cursor>`,
        // collapsing the whole interval into one row.
        expect(rows.length).toBe(2);
        expect(new Set(rows.map((row: any) => row.ingress_key)).size).toBe(2);

        for (const row of rows) {
          const pointer = row.provider_pointer;
          // Post-watch cursor (9999), never the pre-watch one (1500): the
          // staging worker persists pointer.historyId back to
          // google_email_provider_config, and the pre-watch value would
          // regress it below the fresh watch.
          expect(String(pointer.historyId)).toBe('9999');
          // Mailbox identity parity with the direct-enqueue branch.
          expect(pointer.mailbox).toBe(providerRow.mailbox);
          expect(pointer.emailAddress).toBe(providerRow.mailbox);
          // The staging worker only downloads explicitly discovered ids;
          // without them it re-lists from the post-watch cursor and finds
          // nothing from the paused interval.
          expect(Array.isArray(pointer.discoveredMessageIds)).toBe(true);
          expect(pointer.discoveredMessageIds).toHaveLength(1);
          expect(['g-1', 'g-2']).toContain(pointer.discoveredMessageIds[0]);
        }
      } finally {
        process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = prevMode;
        await tenantTable('inbound_email_ingress').where({ tenant: testTenant, provider_id: providerId }).delete();
      }
    });

    it('falls back to a pause-bounded mailbox query when the saved cursor is rejected', async () => {
      const { providerId, pausedAt } = await seedPausedProvider('google');
      const rejected: any = new Error('Gmail history_id is no longer valid.');
      rejected.code = 'gmail.historyIdNotFound';
      rejected.status = 404;
      gmailAdapterMock.listMessagesSince.mockRejectedValue(rejected);

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(true);
      expect(gmailAdapterMock.listMessageIdsSinceTime).toHaveBeenCalledTimes(1);
      const [sinceDate] = gmailAdapterMock.listMessageIdsSinceTime.mock.calls[0];
      expect(new Date(sinceDate).getTime()).toBe(pausedAt.getTime());
      expect(enqueueMock.enqueueUnifiedInboundEmailQueueJob).toHaveBeenCalledTimes(1);
      expect(
        enqueueMock.enqueueUnifiedInboundEmailQueueJob.mock.calls[0][0].pointer.discoveredMessageIds
      ).toEqual(['g-fb-1']);

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
    });

    it('queues the entire paused interval when it exceeds a single batch (no dropped mail)', async () => {
      const { providerId } = await seedPausedProvider('google');
      // More message ids than the previous 200-message recovery cap: every
      // message must now be handed off — the pause may not clear over a
      // known gap, so the cap is gone.
      gmailAdapterMock.listMessagesSince.mockResolvedValue(
        Array.from({ length: 203 }, (_, index) => `g-overflow-${index}`)
      );

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(true);
      expect(result.reconciliation?.status).toBe('completed');
      expect(result.reconciliation?.queuedMessages).toBe(203);
      expect(enqueueMock.enqueueUnifiedInboundEmailQueueJob).toHaveBeenCalledTimes(203);
    });

    it('loops Microsoft reconciliation passes until the paused interval is exhausted', async () => {
      const { providerId, pausedAt } = await seedPausedProvider('microsoft');
      reconcileMock.reconcileProviderMessages
        .mockResolvedValueOnce({ queuedMessages: 50, moreRemaining: true, enqueuedMessageIds: Array.from({ length: 50 }, (_, i) => `ms-a-${i}`) })
        .mockResolvedValueOnce({ queuedMessages: 30, moreRemaining: true, enqueuedMessageIds: Array.from({ length: 30 }, (_, i) => `ms-b-${i}`) })
        .mockResolvedValueOnce({ queuedMessages: 2, moreRemaining: false, enqueuedMessageIds: ['ms-c-0', 'ms-c-1'] });

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
        providerId,
        testTenant,
        { credentialsValidated: true, deliveryEstablished: true }
      );

      expect(result.resumed).toBe(true);
      expect(result.reconciliation).toEqual({ status: 'completed', queuedMessages: 82 });
      expect(reconcileMock.reconcileProviderMessages).toHaveBeenCalledTimes(3);

      // Every pass sweeps from the pause boundary; ids handed off by earlier
      // passes are seeded so later passes recognize them as covered.
      for (const call of reconcileMock.reconcileProviderMessages.mock.calls) {
        expect(call[0].providerId).toBe(providerId);
        expect(new Date(call[0].since).getTime()).toBe(pausedAt.getTime());
      }
      expect(reconcileMock.reconcileProviderMessages.mock.calls[1][0].handedOffIds.has('ms-a-0')).toBe(true);
      expect(reconcileMock.reconcileProviderMessages.mock.calls[2][0].handedOffIds.has('ms-b-29')).toBe(true);

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
    });

    it('keeps the pause when Microsoft reconciliation never exhausts the interval', async () => {
      const { providerId } = await seedPausedProvider('microsoft');
      // A pathological provider that always reports more remaining: recovery
      // must fail (bounded passes) and the provider must stay paused — never
      // "resumed with a known gap".
      reconcileMock.reconcileProviderMessages.mockResolvedValue({
        queuedMessages: 50,
        moreRemaining: true,
        enqueuedMessageIds: Array.from({ length: 50 }, (_, i) => `ms-x-${i}`),
      });

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
        providerId,
        testTenant,
        { credentialsValidated: true, deliveryEstablished: true }
      );

      expect(result.resumed).toBe(false);
      expect(result.reconnectRequired).toBe(true);
      expect(result.error).toMatch(/unexhausted/i);

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).not.toBeNull();
      expect(row.inbound_pause_reason).toBe('auth_failure');
    });

    it('reconciled messages are deduped on repeated processing', async () => {
      const { providerId } = await seedPausedProvider('google');

      const { processUnifiedInboundEmailQueueJob } = await import(
        '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor'
      );
      const processInboundEmailInAppModule = await vi.importActual<
        typeof import('@alga-psa/shared/services/email/processInboundEmailInApp')
      >('@alga-psa/shared/services/email/processInboundEmailInApp');
      const spy = vi
        .spyOn(processInboundEmailInAppModule, 'processInboundEmailInApp')
        .mockResolvedValue({
          outcome: 'created',
          ticketId: '00000000-0000-4000-8000-0000000000bb',
          diagnostics: {},
        } as any);

      try {
        const uniqueMessageId = `g-dedupe-${uuidv4()}`;
        gmailAdapterMock.getMessageDetails.mockResolvedValue({
          id: uniqueMessageId,
          provider: 'google',
          providerId: 'x',
          tenant: testTenant,
          receivedAt: new Date().toISOString(),
          from: { email: 'sender@example.com' },
          to: [{ email: 'support@example.com' }],
          subject: 'Paused-interval mail',
          body: { text: 'hello' },
          attachments: [],
        });

        // Lift the pause first (the queue gate skips paused providers).
        const recovered = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
          providerId,
          testTenant,
          { credentialsValidated: true, deliveryEstablished: true }
        );
        expect(recovered.resumed).toBe(true);

        const job = {
          ...googleJob(providerId),
          pointer: { historyId: '1500', emailAddress: 'recovery@example.com', discoveredMessageIds: [uniqueMessageId] },
        };

        const first = await processUnifiedInboundEmailQueueJob(job);
        expect(first.outcome).toBe('processed');

        const second = await processUnifiedInboundEmailQueueJob(job);
        expect(second.outcome).toBe('skipped');
        expect(second.dedupedCount).toBe(1);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('IMAP', () => {
    it('keeps the pause when stored credentials cannot connect', async () => {
      const { providerId } = await seedPausedProvider('imap');
      imapFlowMock.connectShouldFail = true;

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(false);
      expect(result.reconnectRequired).toBe(true);

      const config = await tenantTable('imap_email_provider_config')
        .where({ email_provider_id: providerId })
        .first('uid_validity', 'last_uid');
      // Cursors must survive: they are only cleared AFTER validation.
      expect(config.uid_validity).toBe('abc');
      expect(config.last_uid).toBe('400');

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).not.toBeNull();
    });

    it('arms the covering resync cursor and clears the pause after credentials validate', async () => {
      const { providerId } = await seedPausedProvider('imap');

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant, {
        credentialsValidated: true,
      });

      expect(result.resumed).toBe(true);
      expect(result.reconciliation).toEqual({ status: 'started', queuedMessages: 0 });

      const config = await tenantTable('imap_email_provider_config')
        .where({ email_provider_id: providerId })
        .first('uid_validity', 'last_uid', 'folder_state');
      expect(config.uid_validity).toBeNull();
      // '0' is the explicit scan-from-UID-1 marker: a NULL cursor would make
      // the email-service listener resume from the most recent window and
      // silently skip paused-interval mail older than that window.
      expect(config.last_uid).toBe('0');
      expect(config.folder_state).toEqual({});

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
      expect(row.inbound_pause_reason).toBeNull();
      expect(Number(row.inbound_auth_failure_count)).toBe(0);
    });
  });
});
