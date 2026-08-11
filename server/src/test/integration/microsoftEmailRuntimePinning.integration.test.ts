/**
 * Blocker 3 — issuer pinning through every inbound email runtime.
 *
 * A provider pinned to a Microsoft profile (`microsoft_profile_id` +
 * `client_secret_ref` on `microsoft_email_provider_config`) must resolve its
 * Graph credentials ONLY through that profile in every runtime that mints or
 * refreshes tokens, and must FAIL CLOSED (`ms_email_provider_not_found` /
 * `ms_email_client_mismatch_reconnect_required`) when the pin is unresolvable
 * — never a silent fallback to the tenant Email binding.
 *
 * These tests exercise the real production entrypoints against real
 * PostgreSQL:
 *   - the unified-queue worker (`processUnifiedInboundEmailQueueJob`) token
 *     path, and
 *   - artifact/attachment processing (`processInboundEmailArtifactsBestEffort`
 *     original-email download path).
 *
 * The Graph adapter is stubbed (no live Microsoft calls); the provider config
 * resolution — including which profile the resolver used — is real.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { processUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor';
import { processInboundEmailArtifactsBestEffort } from '@alga-psa/shared/services/email/processInboundEmailArtifacts';

let testDb: Knex;
let testTenant: string;
let profileId: string;
let profileSecretRef: string;
let systemUserId: string;

const tenantSecrets = new Map<string, string>();
const capturedAdapterConfigs: any[] = [];

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft email runtime pinning test fixture creates and removes tenant rows'
  );
}

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in Microsoft email runtime pinning tests');
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testDb, tenant: testTenant }),
    getConnection: async () => testDb,
  };
});

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_name: string, envVar?: string, fallback = '') =>
    (envVar ? process.env[envVar] : undefined) ?? fallback,
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) =>
      tenantSecrets.get(`${tenant}:${key}`) || undefined,
    setTenantSecret: async () => undefined,
    getAppSecret: async () => undefined,
  }),
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftSubscriptionError: class MicrosoftSubscriptionError extends Error {
    constructor(public kind: string, message: string) {
      super(message);
    }
  },
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    constructor(public config: Record<string, any>) {
      capturedAdapterConfigs.push(config);
    }
    async connect() {}
    async downloadAttachmentBytes() {
      return { buffer: Buffer.from('attachment bytes', 'utf8'), contentType: 'text/plain', fileName: 'a.txt' };
    }
    async downloadMessageSource() {
      return Buffer.from(
        'From: sender@example.com\r\nTo: support@example.com\r\nSubject: Hello\r\n\r\nbody',
        'utf8'
      );
    }
  },
}));

// The unified queue worker continues into in-app processing after fetching the
// message. That flow is covered by its own suites; here the resolver/token path
// is the unit under test, so the rest is a deterministic stub.
vi.mock('@alga-psa/shared/services/email/processInboundEmailInApp', () => ({
  processInboundEmailInApp: async () => ({
    outcome: 'created',
    ticketId: '00000000-0000-4000-8000-0000000000aa',
    diagnostics: { outcome: { kind: 'created' } },
  }),
}));

// Artifact persistence uploads to object storage; stub it like the existing
// attachment-ingestion suite so the download/resolution path (the unit under
// test) is exercised without a live storage backend.
vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: async () => ({
      upload: async (file: Buffer, filePath: string) => ({
        path: filePath,
        size: file.length,
      }),
    }),
    clearProvider: vi.fn(),
  },
  generateStoragePath: (_tenant: string, _basePath: string, originalFilename: string) =>
    `test/${originalFilename}`,
}));

async function seedProfile(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv4();
  const secretRef = `microsoft_profile_${id}_client_secret`;
  const clientId = String(overrides.client_id ?? 'profile-client-id');
  const displayName = String(overrides.display_name ?? `Runtime Email App ${id.slice(0, 8)}`);
  await tenantTable('microsoft_profiles').insert({
    tenant: testTenant,
    profile_id: id,
    display_name: displayName,
    display_name_normalized: displayName.toLowerCase(),
    client_id: clientId,
    tenant_id: 'directory-tenant-guid',
    client_secret_ref: secretRef,
    capabilities: JSON.stringify(['email']),
    is_default: true,
    is_archived: false,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
  tenantSecrets.set(`${testTenant}:${secretRef}`, 'profile-secret-value');
  return id;
}

async function seedPinnedProvider(overrides: {
  clientId?: string;
  profileId?: string | null;
  clientSecretRef?: string | null;
  active?: boolean;
} = {}): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  const pinnedProfileId = overrides.profileId === undefined ? profileId : overrides.profileId;
  const pinnedRef = overrides.clientSecretRef === undefined ? profileSecretRef : overrides.clientSecretRef;
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Runtime Mailbox',
    mailbox: `runtime-${providerId.slice(0, 8)}@client.com`,
    is_active: overrides.active ?? true,
    status: 'connected',
    inbound_paused_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: overrides.clientId ?? 'profile-client-id',
    client_secret: 'stored-secret',
    tenant_id: 'directory-tenant-guid',
    microsoft_profile_id: pinnedProfileId,
    client_secret_ref: pinnedRef,
    redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'runtime-access',
    refresh_token: 'runtime-refresh',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    webhook_subscription_id: 'sub-1',
    webhook_verification_token: 'token',
    webhook_expires_at: new Date(Date.now() + 7200000).toISOString(),
    last_subscription_renewal: now,
    delivery_mode: 'webhook',
    webhook_silent_runs: 0,
    next_subscription_probe_at: null,
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

async function seedUser(): Promise<string> {
  const userId = uuidv4();
  await tenantTable('users').insert({
    tenant: testTenant,
    user_id: userId,
    username: `runtime-${userId.slice(0, 8)}`,
    hashed_password: 'unused',
    user_type: 'internal',
    email: `runtime-${userId.slice(0, 8)}@test.co`,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return userId;
}

function unifiedJob(providerId: string) {
  return {
    jobId: `job-${uuidv4()}`,
    tenantId: testTenant,
    providerId,
    provider: 'microsoft',
    pointer: {
      subscriptionId: 'sub-1',
      messageId: 'msg-1',
      resource: '/users/user-1/messages/msg-1',
      changeType: 'created',
    },
  } as const;
}

describe('Microsoft inbound email runtime issuer pinning (DB-backed)', () => {
  beforeAll(async () => {
    const secretsDir = path.resolve(__dirname, '../../../../secrets');
    const readSecret = (name: string) => {
      try {
        return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim();
      } catch {
        return undefined;
      }
    };
    // Override unconditionally: .env.localtest points DB_PASSWORD_* at container
    // secret paths that do not exist on this host, and the secrets provider is
    // mocked below, so getSecret() falls back to these env vars.
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5472';
    process.env.DB_USER_ADMIN = 'postgres';
    process.env.DB_USER_SERVER = 'app_user';
    process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
    process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
    process.env.NODE_ENV = 'test';

    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Runtime Pinning Test Client',
      email: 'runtime-pinning@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    systemUserId = await seedUser();
    profileId = await seedProfile();
    profileSecretRef = `microsoft_profile_${profileId}_client_secret`;
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      const docIds = (
        await tenantTable('documents').select('document_id')
      ).map((row: any) => row.document_id);
      if (docIds.length > 0) {
        for (const table of ['document_associations', 'document_versions', 'document_content', 'document_block_content']) {
          await tenantTable(table).whereIn('document_id', docIds).delete();
        }
        await tenantTable('documents').whereIn('document_id', docIds).delete();
      }
      await tenantTable('external_files').delete();
      await tenantTable('document_folders').delete();
      await tenantTable('email_processed_attachments').delete();
      await tenantTable('email_processed_messages').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantTable('microsoft_profiles').delete();
      await tenantTable('users').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    capturedAdapterConfigs.length = 0;
  });

  describe('unified queue worker token path', () => {
    it('resolves a pinned provider through its profile (resolved_profile_id + client_secret_ref)', async () => {
      const providerId = await seedPinnedProvider();

      const result = await processUnifiedInboundEmailQueueJob(unifiedJob(providerId));

      expect(result.outcome).toBe('processed');
      const config = capturedAdapterConfigs[capturedAdapterConfigs.length - 1];
      expect(config.provider_config).toMatchObject({
        resolved_profile_id: profileId,
        resolved_client_secret_ref: profileSecretRef,
        resolved_client_id: 'profile-client-id',
        resolved_credential_source: 'profile',
      });
    });

    it('fails closed when the pinned profile no longer exists (ms_email_provider_not_found)', async () => {
      const missingProfileId = uuidv4();
      const providerId = await seedPinnedProvider({ profileId: missingProfileId });

      await expect(processUnifiedInboundEmailQueueJob(unifiedJob(providerId))).rejects.toThrow(
        /ms_email_provider_not_found/
      );
    });

    it('fails closed when the pinned profile exists but its app disagrees with the persisted client id (ms_email_client_mismatch_reconnect_required)', async () => {
      const mismatchProfileId = await seedProfile({
        client_id: 'a-different-app-client-id',
        is_default: false,
      });
      const providerId = await seedPinnedProvider({ profileId: mismatchProfileId });

      await expect(processUnifiedInboundEmailQueueJob(unifiedJob(providerId))).rejects.toThrow(
        /ms_email_client_mismatch_reconnect_required/
      );
    });
  });

  describe('artifact / attachment processing token path', () => {
    it('resolves a pinned provider through its profile when downloading the original email source', async () => {
      const providerId = await seedPinnedProvider();
      const emailId = `source-${uuidv4()}@example.com`;

      await processInboundEmailArtifactsBestEffort({
        tenantId: testTenant,
        providerId,
        ticketId: uuidv4(),
        scopeLabel: 'reply',
        emailData: {
          id: emailId,
          from: { email: 'from@example.com', name: 'From' },
          to: [{ email: 'to@example.com', name: 'To' }],
          subject: 'Artifact pinning',
          body: { text: 'body' },
          receivedAt: new Date().toISOString(),
        },
      });

      const config = capturedAdapterConfigs[capturedAdapterConfigs.length - 1];
      expect(config.provider_config).toMatchObject({
        resolved_profile_id: profileId,
        resolved_client_secret_ref: profileSecretRef,
        resolved_client_id: 'profile-client-id',
        resolved_credential_source: 'profile',
      });

      const originalRow = await tenantTable<any>('email_processed_attachments')
        .where({ provider_id: providerId, email_id: emailId })
        .first();
      expect(originalRow?.processing_status).toBe('success');
    });

    it('fails closed (no binding fallback) when the pinned profile is missing — attachment marked failed, no document', async () => {
      const missingProfileId = uuidv4();
      const providerId = await seedPinnedProvider({ profileId: missingProfileId });
      const emailId = `source-missing-${uuidv4()}@example.com`;
      const docsBefore = (await tenantTable<any>('documents').count<{ count: string }>('* as count').first())?.count;

      const result = await processInboundEmailArtifactsBestEffort({
        tenantId: testTenant,
        providerId,
        ticketId: uuidv4(),
        scopeLabel: 'new-ticket',
        emailData: {
          id: emailId,
          from: { email: 'from@example.com', name: 'From' },
          to: [{ email: 'to@example.com', name: 'To' }],
          subject: 'Missing pin',
          body: { text: 'body' },
          receivedAt: new Date().toISOString(),
        },
      });

      // processInboundEmailArtifactsBestEffort is best-effort: the download
      // failure is recorded on the attachment row, not thrown.
      expect(result.embeddedImageUrlMappings).toEqual([]);

      const originalRow = await tenantTable<any>('email_processed_attachments')
        .where({ provider_id: providerId, email_id: emailId })
        .first();
      expect(originalRow?.processing_status).toBe('failed');
      expect(String(originalRow?.error_message)).toContain('ms_email_provider_not_found');

      const docsAfter = (await tenantTable<any>('documents').count<{ count: string }>('* as count').first())?.count;
      expect(Number(docsAfter ?? 0)).toBe(Number(docsBefore ?? 0));
    });
  });
});
