/**
 * Behavioral integration tests for auth-failure outcome recording at the
 * source-fetch boundary of the unified inbound email queue processor:
 *
 * - a classified terminal auth failure increments the provider counter and
 *   rethrows the original error (queue retry policy stays authoritative);
 * - a transient 429/timeout never increments;
 * - a successful source fetch — including one that returns no messages —
 *   resets a prior count before downstream processing;
 * - a downstream ticket-processing failure after a successful fetch does
 *   NOT increment the auth counter.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { processUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor';
import type { UnifiedInboundEmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const microsoftAdapterMock = vi.hoisted(() => ({
  downloadMessageSource: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in inbound auth-failure processor tests');
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/microsoftEmailProviderConfig')>();
  return {
    ...actual,
    buildMicrosoftEmailProviderConfig: async (config: any) => config,
  };
});

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    constructor(public config: any) {}
    async connect() {
      // connect() rethrows sanitized token-refresh failures with structured
      // metadata; the classifier reads error.responseBody.
      const failure: any = new Error('Error in connect: Request failed with status code 400 (code: 400)');
      failure.status = 400;
      failure.code = '400';
      failure.responseBody = {
        error: 'invalid_grant',
        error_description: 'AADSTS50173: The provided grant has expired or was revoked.',
      };
      throw failure;
    }
    async downloadMessageSource() {
      return microsoftAdapterMock.downloadMessageSource();
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    constructor(public config: any) {}
    async connect() {}
    async listMessagesSince() {
      return [];
    }
    async getMessageDetails() {
      throw new Error('not expected in these tests');
    }
  },
}));

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'inbound auth-failure processor test fixture creates and removes tenant rows'
  );
}

async function seedMicrosoftProvider(withCount = 0): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Processor Mailbox',
    mailbox: `processor-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    inbound_paused_at: null,
    error_message: null,
    inbound_auth_failure_count: withCount,
    created_at: now,
    updated_at: now,
  });
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
    access_token: 'stale-access',
    refresh_token: 'revoked-refresh',
    token_expires_at: new Date(Date.now() - 3600_000).toISOString(),
    delivery_mode: 'polling',
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

async function seedGoogleProvider(): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'google',
    provider_name: 'Google Processor Mailbox',
    mailbox: `gprocessor-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    inbound_paused_at: null,
    error_message: null,
    inbound_auth_failure_count: 2,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('google_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: 'client-id',
    client_secret: 'client-secret',
    project_id: 'project',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify([]),
    access_token: 'access',
    refresh_token: 'refresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    history_id: '2000',
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

function microsoftJob(providerId: string): UnifiedInboundEmailQueueJob {
  return {
    jobId: `job-${uuidv4()}`,
    schemaVersion: 1,
    tenantId: testTenant,
    providerId,
    provider: 'microsoft',
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
    maxAttempts: 5,
    pointer: { subscriptionId: 'sub', messageId: 'msg-1' },
  };
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
    pointer: { historyId: '2000', emailAddress: 'mailbox@example.com' },
  };
}

async function getCount(providerId: string): Promise<number> {
  const row = await tenantTable('email_providers').where({ id: providerId }).first('inbound_auth_failure_count');
  return Number(row?.inbound_auth_failure_count || 0);
}

describeDb('unified inbound queue processor auth-failure outcomes (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Auth Pause Processor Test Client',
      email: 'auth-pause-processor@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('email_processed_messages').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  it('records a classified terminal auth failure and rethrows the original error', async () => {
    const providerId = await seedMicrosoftProvider(0);

    await expect(processUnifiedInboundEmailQueueJob(microsoftJob(providerId))).rejects.toThrow(
      /AADSTS50173|invalid_grant|status code 400/i
    );

    expect(await getCount(providerId)).toBe(1);
    const row = await tenantTable('email_providers').where({ id: providerId }).first();
    expect(row.inbound_paused_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBe('microsoft:invalid_grant');
  });

  it('does not increment for a transient throttling error', async () => {
    const providerId = await seedMicrosoftProvider(1);

    // Override connect to throw a 429 with a Graph-shaped body.
    const { MicrosoftGraphAdapter } = await import(
      '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
    );
    const originalConnect = MicrosoftGraphAdapter.prototype.connect;
    (MicrosoftGraphAdapter.prototype as any).connect = async function () {
      const failure: any = new Error('Error in connect: Too many requests (code: 429)');
      failure.status = 429;
      failure.code = '429';
      failure.responseBody = { error: { code: '429', message: 'Too many requests' } };
      throw failure;
    };
    try {
      await expect(processUnifiedInboundEmailQueueJob(microsoftJob(providerId))).rejects.toThrow(/429|Too many/i);
    } finally {
      (MicrosoftGraphAdapter.prototype as any).connect = originalConnect;
    }

    expect(await getCount(providerId)).toBe(1);
    const row = await tenantTable('email_providers').where({ id: providerId }).first();
    expect(row.inbound_paused_at).toBeNull();
  });

  it('resets a prior count when the source fetch succeeds with no messages', async () => {
    const providerId = await seedGoogleProvider();
    expect(await getCount(providerId)).toBe(2);

    const result = await processUnifiedInboundEmailQueueJob(googleJob(providerId));

    // GmailAdapter mock lists zero message ids since the pause boundary.
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('no_messages_from_pointer');
    expect(await getCount(providerId)).toBe(0);
  });

  it('does not increment the auth counter when downstream ticket processing fails after a successful fetch', async () => {
    const processInboundEmailInAppModule = await vi.importActual<
      typeof import('@alga-psa/shared/services/email/processInboundEmailInApp')
    >('@alga-psa/shared/services/email/processInboundEmailInApp');
    const spy = vi
      .spyOn(processInboundEmailInAppModule, 'processInboundEmailInApp')
      .mockRejectedValueOnce(new Error('ticket processing exploded'));

    try {
      const { GmailAdapter } = await import('@alga-psa/shared/services/email/providers/GmailAdapter');
      (GmailAdapter.prototype as any).listMessagesSince = async () => ['gmail-msg-1'];
      (GmailAdapter.prototype as any).getMessageDetails = async () => ({
        id: 'gmail-msg-1',
        provider: 'google',
        providerId: 'x',
        tenant: testTenant,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com' },
        to: [{ email: 'support@example.com' }],
        subject: 'Hello',
        body: { text: 'body' },
        attachments: [],
      });

      const providerId = await seedGoogleProvider();
      expect(await getCount(providerId)).toBe(2);

      await expect(processUnifiedInboundEmailQueueJob(googleJob(providerId))).rejects.toThrow(
        /ticket processing exploded/
      );

      // The successful source fetch already reset the counter; the downstream
      // application failure must not re-inflate it.
      expect(await getCount(providerId)).toBe(0);
      const row = await tenantTable('email_providers').where({ id: providerId }).first();
      expect(row.inbound_paused_at).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
