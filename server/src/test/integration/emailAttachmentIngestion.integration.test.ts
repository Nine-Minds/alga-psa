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
let microsoftSourceShouldFail = false;
let gmailSourceShouldFail = false;

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
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
    async downloadMessageSource(_messageId: string) {
      if (microsoftSourceShouldFail) {
        throw new Error('microsoft source download failed');
      }
      return Buffer.from('From: sender@example.com\r\nSubject: Example\r\n\r\nbody', 'utf-8');
    }
  },
}));

vi.mock('@alga-psa/integrations', () => ({
  GmailAdapter: class GmailAdapter {
    async connect() {}
    async downloadAttachmentBytes(_messageId: string, _attachmentId: string) {
      if (gmailDownloadShouldFail) {
        throw new Error('gmail download failed');
      }
      return Buffer.from('zipdata', 'utf-8');
    }
    async downloadMessageSource(_messageId: string) {
      if (gmailSourceShouldFail) {
        throw new Error('gmail source download failed');
      }
      return Buffer.from('From: sender@example.com\r\nSubject: Gmail Example\r\n\r\nbody', 'utf-8');
    }
  },
}));

const uploads: Array<{ path: string; size: number; mime_type?: string }> = [];
vi.mock('@alga-psa/documents', () => ({
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
    microsoftSourceShouldFail = false;
    gmailSourceShouldFail = false;

    await db('document_associations').where({ tenant: tenantId, entity_type: 'ticket' }).delete();
    await db('documents').where({ tenant: tenantId }).delete();
    await db('external_files').where({ tenant: tenantId }).delete();
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

  it('extracts embedded attachments from HTML data URLs and referenced CID images only', async () => {
    const { action } = await createEmbeddedExtractionAction();
    const result = await action.execute(
      {
        emailId: 'msg-embedded-1',
        html: '<p><img src=\"data:image/png;base64,aGVsbG8=\" /><img src=\"cid:cid-1\" /><img src=\"cid:not-found\" /></p>',
        attachments: [
          { id: 'real-1', name: 'inline.png', contentType: 'image/png', size: 5, contentId: '<cid-1>', isInline: true },
          { id: 'real-2', name: 'doc.pdf', contentType: 'application/pdf', size: 100, contentId: '<cid-doc>', isInline: true },
        ],
      },
      {
        tenant: tenantId,
        executionId: 'test',
        idempotencyKey: 'test',
        parameters: {},
        knex: db,
      } as any
    );

    expect(result.success).toBe(true);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((item: any) => item.source)).toEqual(['data-url', 'cid']);
    expect(result.attachments[1].providerAttachmentId).toBe('real-1');
    expect(result.warnings.some((warning: string) => warning.startsWith('missing_cid_attachment'))).toBe(true);
  });

  it('processes synthetic embedded data URL image attachments', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);

    const ticketId = uuidv4();
    const res = await action.execute(
      {
        emailId: 'msg-embedded-2',
        attachmentId: 'embedded-data-1',
        ticketId,
        tenant: tenantId,
        providerId,
        attachmentData: {
          id: 'embedded-data-1',
          name: 'embedded-image-1.png',
          contentType: 'image/png',
          size: 5,
          content: Buffer.from('hello', 'utf8').toString('base64'),
          allowInlineProcessing: true,
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

    expect(res).toMatchObject({ success: true, contentType: 'image/png' });
    const file = await db('external_files')
      .where({ tenant: tenantId, original_name: 'embedded-image-1.png' })
      .first();
    expect(file).toBeTruthy();
    expect(file?.mime_type).toBe('image/png');
    expect(Number(file?.file_size)).toBe(5);
    expect(file?.uploaded_by_id).toBe(systemUserId);

    const doc = await db('documents')
      .where({ tenant: tenantId, document_name: 'embedded-image-1.png' })
      .first();
    expect(doc).toBeTruthy();
    expect(doc?.mime_type).toBe('image/png');
    expect(Number(doc?.file_size)).toBe(5);
    expect(doc?.created_by).toBe(systemUserId);

    const assoc = await db('document_associations')
      .where({ tenant: tenantId, entity_type: 'ticket', entity_id: ticketId, document_id: doc?.document_id })
      .first();
    expect(assoc).toBeTruthy();
  });

  it('is idempotent for synthetic embedded image processing', async () => {
    const { action } = await createAttachmentAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);
    const ticketId = uuidv4();

    const params = {
      emailId: 'msg-embedded-3',
      attachmentId: 'embedded-data-idempotent',
      ticketId,
      tenant: tenantId,
      providerId,
      attachmentData: {
        id: 'embedded-data-idempotent',
        name: 'embedded-image-idempotent.png',
        contentType: 'image/png',
        size: 5,
        content: Buffer.from('hello', 'utf8').toString('base64'),
        allowInlineProcessing: true,
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
    const second = await action.execute(params, context);
    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true, duplicate: true });

    const files = await db('external_files')
      .where({ tenant: tenantId, original_name: 'embedded-image-idempotent.png' })
      .select('file_id');
    const docs = await db('documents')
      .where({ tenant: tenantId, document_name: 'embedded-image-idempotent.png' })
      .select('document_id');
    const assocs = await db('document_associations')
      .where({ tenant: tenantId, entity_type: 'ticket', entity_id: ticketId });

    expect(files).toHaveLength(1);
    expect(docs).toHaveLength(1);
    expect(assocs).toHaveLength(1);
  });

  it('process_original_email_attachment stores .eml and associates it with ticket', async () => {
    const { action } = await createOriginalEmailAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);
    const ticketId = uuidv4();

    const res = await action.execute(
      {
        emailId: '<source-msg-1@example.com>',
        ticketId,
        tenant: tenantId,
        providerId,
        emailData: {
          id: '<source-msg-1@example.com>',
          from: { email: 'from@example.com', name: 'From' },
          to: [{ email: 'to@example.com', name: 'To' }],
          subject: 'Subject',
          body: { text: 'Body' },
          receivedAt: new Date().toISOString(),
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

    expect(res).toMatchObject({ success: true, contentType: 'message/rfc822' });
    expect(String(res.fileName || '')).toContain('original-email-source-msg-1-example.com.eml');

    const doc = await db('documents')
      .where({ tenant: tenantId })
      .andWhere('document_name', 'like', 'original-email-%')
      .first();
    expect(doc).toBeTruthy();
    expect(doc?.mime_type).toBe('message/rfc822');
    expect(doc?.created_by).toBe(systemUserId);

    const assoc = await db('document_associations')
      .where({ tenant: tenantId, entity_type: 'ticket', entity_id: ticketId, document_id: doc?.document_id })
      .first();
    expect(assoc).toBeTruthy();
  });

  it('process_original_email_attachment is idempotent on duplicate invocation', async () => {
    const { action } = await createOriginalEmailAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);
    const ticketId = uuidv4();

    const params = {
      emailId: 'source-msg-2@example.com',
      ticketId,
      tenant: tenantId,
      providerId,
      emailData: {
        id: 'source-msg-2@example.com',
        from: { email: 'from@example.com' },
        to: [{ email: 'to@example.com' }],
        subject: 'Subject',
        body: { text: 'Body' },
        receivedAt: new Date().toISOString(),
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
    const second = await action.execute(params, context);
    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true, duplicate: true });

    const docs = await db('documents')
      .where({ tenant: tenantId })
      .andWhere('document_name', 'like', 'original-email-source-msg-2-example.com.eml')
      .select('document_id');
    expect(docs).toHaveLength(1);
  });

  it('process_original_email_attachment records failed status when provider source retrieval fails', async () => {
    const { action } = await createOriginalEmailAction();
    const providerId = uuidv4();
    await insertGoogleProvider(db, tenantId, providerId);
    gmailSourceShouldFail = true;

    const res = await action.execute(
      {
        emailId: 'source-msg-fail@example.com',
        ticketId: uuidv4(),
        tenant: tenantId,
        providerId,
        emailData: {
          id: 'source-msg-fail@example.com',
          from: { email: 'from@example.com' },
          to: [{ email: 'to@example.com' }],
          subject: 'Subject',
          body: { text: 'Body' },
          receivedAt: new Date().toISOString(),
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

    expect(res).toMatchObject({ success: false });

    const failed = await db('email_processed_attachments')
      .where({
        tenant: tenantId,
        provider_id: providerId,
        email_id: 'source-msg-fail@example.com',
      })
      .andWhere('attachment_id', '__original_email_source__')
      .first();
    expect(failed?.processing_status).toBe('failed');
  });
});

async function createRegisteredAttachmentActions(): Promise<Record<string, { execute: (params: any, context: any) => Promise<any> }>> {
  const { ActionRegistry } = await import('@shared/workflow/core/actionRegistry');
  const workflowWorkerModulePath =
    '../../../../' + 'services/workflow-worker/src/actions/registerEmailAttachmentActions';
  const { registerEmailAttachmentActions } = await import(workflowWorkerModulePath);

  const registry = new ActionRegistry();
  registerEmailAttachmentActions(registry);
  return registry.getRegisteredActions() as any;
}

async function createAttachmentAction(): Promise<{ action: { execute: (params: any, context: any) => Promise<any> } }> {
  const actions = await createRegisteredAttachmentActions();
  const action = actions['process_email_attachment'];
  if (!action) {
    throw new Error('process_email_attachment action not registered');
  }
  return { action };
}

async function createOriginalEmailAction(): Promise<{ action: { execute: (params: any, context: any) => Promise<any> } }> {
  const actions = await createRegisteredAttachmentActions();
  const action = actions['process_original_email_attachment'];
  if (!action) {
    throw new Error('process_original_email_attachment action not registered');
  }
  return { action };
}

async function createEmbeddedExtractionAction(): Promise<{ action: { execute: (params: any, context: any) => Promise<any> } }> {
  const actions = await createRegisteredAttachmentActions();
  const action = actions['extract_embedded_email_attachments'];
  if (!action) {
    throw new Error('extract_embedded_email_attachments action not registered');
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
