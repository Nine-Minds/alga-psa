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
      return gmailAdapterMock.registerWebhookSubscription();
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

async function seedPausedProvider(providerType: 'microsoft' | 'google' | 'imap'): Promise<{
  providerId: string;
  pausedAt: Date;
}> {
  const providerId = uuidv4();
  const pausedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
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
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('imap_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
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

      const result = await new EmailProviderLifecycleService().recoverAuthPausedProvider(providerId, testTenant);

      expect(result.resumed).toBe(true);
      expect(result.webhookRegistered).toBe(true);

      // The pre-watch cursor is the seeded history_id.
      expect(gmailAdapterMock.listMessagesSince).toHaveBeenCalledWith('1500');
      expect(gmailAdapterMock.registerWebhookSubscription).toHaveBeenCalledTimes(1);

      // One durable enqueue per reconciled message id.
      expect(enqueueMock.enqueueUnifiedInboundEmailQueueJob).toHaveBeenCalledTimes(2);
      const firstEnqueue = enqueueMock.enqueueUnifiedInboundEmailQueueJob.mock.calls[0][0];
      expect(firstEnqueue).toMatchObject({
        tenantId: testTenant,
        providerId,
        provider: 'google',
      });
      expect(firstEnqueue.pointer.discoveredMessageIds).toEqual(['g-1']);

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
      expect(Number(row.inbound_auth_failure_count)).toBe(0);
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

    it('clears UID/folder cursors and the pause after credentials validate', async () => {
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
      expect(config.last_uid).toBeNull();
      expect(config.folder_state).toEqual({});

      const row = await getProviderRow(providerId);
      expect(row.inbound_paused_at).toBeNull();
      expect(row.inbound_pause_reason).toBeNull();
      expect(Number(row.inbound_auth_failure_count)).toBe(0);
    });
  });
});
