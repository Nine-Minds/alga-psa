import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import process from 'node:process';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

let db: Knex;
let tenantId: string;
let systemUserId: string;

let microsoftDownloadShouldFail = false;
let microsoftDownloadUnsupported = false;
let gmailDownloadShouldFail = false;

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
  },
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    async connect() {}
    async downloadAttachmentBytes(_messageId: string, _attachmentId: string) {
      if (microsoftDownloadShouldFail) {
        throw new Error('microsoft download failed');
      }
      if (microsoftDownloadUnsupported) {
        throw new Error('Unsupported attachment type: #microsoft.graph.itemAttachment');
      }
      const buffer = Buffer.from('hello', 'utf-8');
      return {
        fileName: undefined,
        contentType: undefined,
        size: buffer.length,
        buffer,
      };
    }
  },
}));

vi.mock('@/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    async connect() {}
    async downloadAttachmentBytes(_messageId: string, _attachmentId: string) {
      if (gmailDownloadShouldFail) {
        throw new Error('gmail download failed');
      }
      return Buffer.from('zipdata', 'utf-8');
    }
  },
}));

const uploads: Array<{ path: string; size: number; mime_type?: string }> = [];
vi.mock('@/lib/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({
      upload: vi.fn(async (file: Buffer, path: string, options?: { mime_type?: string }) => {
        uploads.push({ path, size: file.length, mime_type: options?.mime_type });
        return { path, size: file.length, mime_type: options?.mime_type };
      }),
    })),
    clearProvider: vi.fn(),
  },
  generateStoragePath: vi.fn((tenant: string, _basePath: string, originalFilename: string) => {
    return `test/${tenant}/${originalFilename}`;
  }),
}));

describe('Email attachment ingestion (workflow-worker action override)', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    // Force DB connection to the known local test Postgres (see existing e2e containers)
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USER_ADMIN = 'postgres';
    process.env.DB_PASSWORD_ADMIN = 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.DB_NAME_SERVER = 'test_database';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    systemUserId = await ensureSystemUserId(db, tenantId);
    await ensureInboundTicketDefaults(db, tenantId, systemUserId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!tenantId) return;
    uploads.length = 0;
    microsoftDownloadShouldFail = false;
    microsoftDownloadUnsupported = false;
    gmailDownloadShouldFail = false;

    await db('document_associations').where({ tenant: tenantId, entity_type: 'ticket' }).delete();
    await db('documents').where({ tenant: tenantId }).andWhere('document_name', 'like', 'email-att-%').delete();
    await db('external_files').where({ tenant: tenantId }).andWhere('original_name', 'like', 'email-att-%').delete();
    await db('email_processed_attachments').where({ tenant: tenantId }).delete();
    await db('microsoft_email_provider_config').where({ tenant: tenantId }).delete();
    await db('google_email_provider_config').where({ tenant: tenantId }).delete();
    await db('email_providers').where({ tenant: tenantId }).delete();
  });

  it('skips inline/CID attachments (no documents/files created)', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertMicrosoftProvider(db, tenantId, providerId);

    const res = await action.execute(
      {
        emailId: 'msg-1',
        attachmentId: 'att-1',
        ticketId: uuidv4(),
        tenant: tenantId,
        providerId,
        attachmentData: {
          id: 'att-1',
          name: 'email-att-inline.png',
          contentType: 'image/png',
          size: 123,
          contentId: '<cid:abc>',
          isInline: true,
        },
      },
      {
        tenant: tenantId,
        executionId: 'test',
        idempotencyKey: 'test',
        parameters: {},
        knex: db,
      } as any
    );

    expect(res).toMatchObject({ success: true, skipped: true, reason: 'inline' });

    const processed = await db('email_processed_attachments').where({ tenant: tenantId }).first();
    expect(processed?.processing_status).toBe('skipped');

    const docs = await db('documents').where({ tenant: tenantId, document_name: 'email-att-inline.png' });
    expect(docs.length).toBe(0);
  });

  it('rejects attachments >100MB (no documents/files created)', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertMicrosoftProvider(db, tenantId, providerId);

    const tooLarge = 100 * 1024 * 1024 + 1;
    const res = await action.execute(
      {
        emailId: 'msg-2',
        attachmentId: 'att-2',
        ticketId: uuidv4(),
        tenant: tenantId,
        providerId,
        attachmentData: {
          id: 'att-2',
          name: 'email-att-too-large.bin',
          contentType: 'application/octet-stream',
          size: tooLarge,
        },
      },
      {
        tenant: tenantId,
        executionId: 'test',
        idempotencyKey: 'test',
        parameters: {},
        knex: db,
      } as any
    );

    expect(res).toMatchObject({ success: true, skipped: true, reason: 'too_large' });

    const docs = await db('documents').where({ tenant: tenantId, document_name: 'email-att-too-large.bin' });
    expect(docs.length).toBe(0);
  });

  it('is idempotent: duplicate processing does not create duplicate documents/files', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertMicrosoftProvider(db, tenantId, providerId);

    const params = {
      emailId: 'msg-3',
      attachmentId: 'att-3',
      ticketId: uuidv4(),
      tenant: tenantId,
      providerId,
      attachmentData: {
        id: 'att-3',
        name: 'email-att-idempotent.txt',
        contentType: 'text/plain',
        size: 5,
      },
    };

    const context = {
      tenant: tenantId,
      executionId: 'test',
      idempotencyKey: 'test',
      parameters: {},
      knex: db,
    } as any;

    const first = await action.execute(params, context);
    expect(first).toMatchObject({ success: true });
    expect(uploads.length).toBe(1);
    expect(uploads[0]).toMatchObject({ size: 5, mime_type: 'text/plain' });

    const second = await action.execute(params, context);
    expect(second).toMatchObject({ success: true, duplicate: true });

    const files = await db('external_files')
      .where({ tenant: tenantId, original_name: 'email-att-idempotent.txt' })
      .select('file_id');
    const docs = await db('documents')
      .where({ tenant: tenantId, document_name: 'email-att-idempotent.txt' })
      .select('document_id');

    expect(files.length).toBe(1);
    expect(docs.length).toBe(1);
  });

  it('skips unsupported Microsoft attachment types (records skipped)', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertMicrosoftProvider(db, tenantId, providerId);

    microsoftDownloadUnsupported = true;
    const res = await action.execute(
      {
        emailId: 'msg-unsupported',
        attachmentId: 'att-unsupported',
        ticketId: uuidv4(),
        tenant: tenantId,
        providerId,
        attachmentData: {
          id: 'att-unsupported',
          name: 'email-att-unsupported.msg',
          contentType: 'application/octet-stream',
          size: 12,
        },
      },
      {
        tenant: tenantId,
        executionId: 'test',
        idempotencyKey: 'test',
        parameters: {},
        knex: db,
      } as any
    );

    expect(res).toMatchObject({ success: true, skipped: true, reason: 'unsupported_attachment' });

    const processed = await db('email_processed_attachments')
      .where({ tenant: tenantId, email_id: 'msg-unsupported', attachment_id: 'att-unsupported' })
      .first();
    expect(processed?.processing_status).toBe('skipped');

    const docs = await db('documents').where({ tenant: tenantId, document_name: 'email-att-unsupported.msg' });
    expect(docs.length).toBe(0);
  });

  it('retries failed processing without duplicating records', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertMicrosoftProvider(db, tenantId, providerId);

    const params = {
      emailId: 'msg-4',
      attachmentId: 'att-4',
      ticketId: uuidv4(),
      tenant: tenantId,
      providerId,
      attachmentData: {
        id: 'att-4',
        name: 'email-att-retry.txt',
        contentType: 'text/plain',
        size: 5,
      },
    };
    const context = {
      tenant: tenantId,
      executionId: 'test',
      idempotencyKey: 'test',
      parameters: {},
      knex: db,
    } as any;

    microsoftDownloadShouldFail = true;
    const first = await action.execute(params, context);
    expect(first).toMatchObject({ success: false });

    const failed = await db('email_processed_attachments')
      .where({ tenant: tenantId, email_id: 'msg-4', attachment_id: 'att-4' })
      .first();
    expect(failed?.processing_status).toBe('failed');

    microsoftDownloadShouldFail = false;
    const second = await action.execute(params, context);
    expect(second).toMatchObject({ success: true });
    expect(uploads.length).toBe(1);

    const processed = await db('email_processed_attachments')
      .where({ tenant: tenantId, email_id: 'msg-4', attachment_id: 'att-4' })
      .first();
    expect(processed?.processing_status).toBe('success');
    expect(processed?.file_id).toBeTruthy();
    expect(processed?.document_id).toBeTruthy();

    const docs = await db('documents')
      .where({ tenant: tenantId, document_name: 'email-att-retry.txt' })
      .select('document_id');
    expect(docs.length).toBe(1);
  });

  it('creates external_files + documents + document_associations with system attribution (Gmail path)', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);

    const ticketId = uuidv4();
    const res = await action.execute(
      {
        emailId: 'msg-5',
        attachmentId: 'att-5',
        ticketId,
        tenant: tenantId,
        providerId,
        attachmentData: {
          id: 'att-5',
          name: 'email-att-gmail.zip',
          contentType: 'application/zip',
          size: 7,
        },
      },
      {
        tenant: tenantId,
        executionId: 'test',
        idempotencyKey: 'test',
        parameters: {},
        knex: db,
      } as any
    );

    expect(res).toMatchObject({ success: true });
    expect(uploads.length).toBe(1);
    expect(uploads[0]).toMatchObject({ size: 7, mime_type: 'application/zip' });

    const file = await db('external_files')
      .where({ tenant: tenantId, original_name: 'email-att-gmail.zip' })
      .first();
    expect(file).toBeTruthy();
    expect(file?.uploaded_by_id).toBe(systemUserId);

    const doc = await db('documents')
      .where({ tenant: tenantId, document_name: 'email-att-gmail.zip' })
      .first();
    expect(doc).toBeTruthy();
    expect(doc?.created_by).toBe(systemUserId);
    expect(doc?.user_id).toBe(systemUserId);

    const assoc = await db('document_associations')
      .where({ tenant: tenantId, entity_type: 'ticket', entity_id: ticketId, document_id: doc?.document_id })
      .first();
    expect(assoc).toBeTruthy();
  });
});

async function createAttachmentAction(): Promise<{ action: { execute: (params: any, context: any) => Promise<any> } }> {
  const { ActionRegistry } = await import('@shared/workflow/core/actionRegistry');
  const { registerEmailAttachmentActions } = await import(
    '../../../../services/workflow-worker/src/actions/registerEmailAttachmentActions'
  );

  const registry = new ActionRegistry();
  registerEmailAttachmentActions(registry);

  const actions = registry.getRegisteredActions();
  const action = actions['process_email_attachment'];
  if (!action) {
    throw new Error('process_email_attachment action not registered');
  }
  return { action };
}

async function ensureTenant(connection: Knex): Promise<string> {
  const row = await connection('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) return row.tenant;

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Email Attachment Test Tenant',
    email: 'email-attachment@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

async function ensureSystemUserId(connection: Knex, tenant: string): Promise<string> {
  const user = await connection('users').where({ tenant }).first<{ user_id: string }>('user_id');
  if (!user?.user_id) {
    throw new Error('No seeded user found for tenant');
  }
  return user.user_id;
}

async function ensureInboundTicketDefaults(connection: Knex, tenant: string, userId: string): Promise<void> {
  const existing = await connection('inbound_ticket_defaults')
    .where({ tenant })
    .andWhere('short_name', 'email-default')
    .first();
  if (existing) return;

  await connection('inbound_ticket_defaults').insert({
    id: uuidv4(),
    tenant,
    short_name: 'email-default',
    display_name: 'Email Default',
    description: 'Test defaults for inbound email',
    entered_by: userId,
    is_active: true,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

async function insertMicrosoftProvider(connection: Knex, tenant: string, providerId: string): Promise<void> {
  await connection('email_providers').insert({
    id: providerId,
    tenant,
    provider_type: 'microsoft',
    provider_name: 'Test Microsoft',
    mailbox: `ms-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  await connection('microsoft_email_provider_config').insert({
    tenant,
    email_provider_id: providerId,
    client_id: 'client-id',
    client_secret: 'client-secret',
    tenant_id: 'ms-tenant-id',
    redirect_uri: 'http://localhost/redirect',
    access_token: 'token',
    refresh_token: 'refresh',
    token_expires_at: connection.fn.now(),
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

async function insertGoogleProvider(connection: Knex, tenant: string, providerId: string): Promise<void> {
  await connection('email_providers').insert({
    id: providerId,
    tenant,
    provider_type: 'google',
    provider_name: 'Test Google',
    mailbox: `g-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  await connection('google_email_provider_config').insert({
    tenant,
    email_provider_id: providerId,
    client_id: 'client-id',
    client_secret: 'client-secret',
    project_id: 'project-id',
    redirect_uri: 'http://localhost/redirect',
    access_token: 'token',
    refresh_token: 'refresh',
    token_expires_at: connection.fn.now(),
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}
