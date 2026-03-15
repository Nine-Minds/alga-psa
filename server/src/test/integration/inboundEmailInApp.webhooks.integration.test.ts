import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { NextRequest } from 'next/server';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';
import net from 'node:net';

const dbReachable: boolean = await new Promise((resolve) => {
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || '5432');
  const socket = net.createConnection({ host, port });
  const done = (value: boolean) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };
  socket.on('connect', () => done(true));
  socket.on('error', () => done(false));
  socket.setTimeout(500, () => done(false));
});
const describeDb = dbReachable ? describe : describe.skip;

let db: Knex;
let tenantId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;

let gmailListMessagesSinceMock = vi.fn();
let gmailGetMessageDetailsMock = vi.fn();
let microsoftGetMessageDetailsMock = vi.fn();
let storageUploadMock = vi.fn(async (_buffer: Buffer, storagePath: string) => ({ path: storagePath }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async () => null,
  })),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

vi.mock('google-auth-library', () => {
  class OAuth2Client {
    async verifyIdToken(_opts: any) {
      return {
        getPayload: () => ({
          email: 'pubsub-publishing@system.gserviceaccount.com',
          aud: _opts?.audience,
          sub: 'sub',
        }),
      };
    }
  }
  return { OAuth2Client };
});

vi.mock('../../../../packages/integrations/src/services/email/providers/GmailAdapter', () => {
  return {
    GmailAdapter: class GmailAdapter {
      async connect() {}
      async listMessagesSince() {
        return gmailListMessagesSinceMock();
      }
      async getMessageDetails(messageId: string) {
        return gmailGetMessageDetailsMock(messageId);
      }
    },
  };
});

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => {
  return {
    MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
      async connect() {}
      async getMessageDetails(messageId: string) {
        return microsoftGetMessageDetailsMock(messageId);
      }
    },
  };
});

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({
      upload: (...args: any[]) => storageUploadMock(...args),
    })),
  },
  generateStoragePath: vi.fn((tenant: string, _prefix: string, fileName: string) => `${tenant}/${fileName}`),
}));

function makeFakeJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function expectedOriginalEmailFileName(messageId: string): string {
  const sanitizedMessageId = String(messageId)
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `original-email-${sanitizedMessageId || 'unknown-message'}.eml`;
}

async function setupInboundDefaults(params: { providerId: string; mailbox: string }) {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `email-${defaultsId.slice(0, 6)}`,
    display_name: `Email Defaults ${defaultsId.slice(0, 6)}`,
    description: 'Test defaults',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: clientId,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('email_providers').insert({
    id: params.providerId,
    tenant: tenantId,
    provider_type: 'google',
    provider_name: 'Test Gmail Provider',
    mailbox: params.mailbox,
    is_active: true,
    status: 'connected',
    vendor_config: JSON.stringify({}),
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const subscriptionName = `sub-${uuidv4().slice(0, 6)}`;
  await db('google_email_provider_config').insert({
    email_provider_id: params.providerId,
    tenant: tenantId,
    client_id: 'client-id',
    client_secret: 'secret',
    project_id: 'project-id',
    redirect_uri: 'http://localhost/callback',
    pubsub_topic_name: 'topic',
    pubsub_subscription_name: subscriptionName,
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify([]),
    access_token: 'access',
    refresh_token: 'refresh',
    token_expires_at: null,
    history_id: '1',
    watch_expiration: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { defaultsId, subscriptionName };
}

async function setupMicrosoftProvider(params: {
  providerId: string;
  mailbox: string;
  subscriptionId: string;
}) {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `ms-email-${defaultsId.slice(0, 6)}`,
    display_name: `MS Email Defaults ${defaultsId.slice(0, 6)}`,
    description: 'Test defaults',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: clientId,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('email_providers').insert({
    id: params.providerId,
    tenant: tenantId,
    provider_type: 'microsoft',
    provider_name: 'Test Microsoft Provider',
    mailbox: params.mailbox,
    is_active: true,
    status: 'connected',
    vendor_config: JSON.stringify({}),
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('microsoft_email_provider_config').insert({
    email_provider_id: params.providerId,
    tenant: tenantId,
    client_id: 'client-id',
    client_secret: 'secret',
    tenant_id: 'ms-tenant-id',
    redirect_uri: 'http://localhost/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'access',
    refresh_token: 'refresh',
    token_expires_at: null,
    webhook_subscription_id: params.subscriptionId,
    webhook_expires_at: null,
    webhook_verification_token: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { defaultsId };
}

async function setupImapProvider(params: { providerId: string; mailbox: string }) {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `imap-email-${defaultsId.slice(0, 6)}`,
    display_name: `IMAP Email Defaults ${defaultsId.slice(0, 6)}`,
    description: 'Test defaults',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: clientId,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('email_providers').insert({
    id: params.providerId,
    tenant: tenantId,
    provider_type: 'imap',
    provider_name: 'Test IMAP Provider',
    mailbox: params.mailbox,
    is_active: true,
    status: 'connected',
    vendor_config: JSON.stringify({}),
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { defaultsId };
}

async function createRoutingBoardVariant(namePrefix: string): Promise<string> {
  const sourceBoard = await db('boards')
    .where({ tenant: tenantId, board_id: boardId })
    .first<any>();
  if (!sourceBoard) {
    throw new Error('Expected source board for routing variant');
  }

  const newBoardId = uuidv4();
  const {
    board_id: _sourceBoardId,
    created_at: _sourceCreatedAt,
    updated_at: _sourceUpdatedAt,
    ...sourceRest
  } = sourceBoard;

  await db('boards').insert({
    ...sourceRest,
    board_id: newBoardId,
    board_name: `${namePrefix}-${newBoardId.slice(0, 6)}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return newBoardId;
}

async function createInboundRoutingDefaults(params: {
  boardId: string;
  clientId?: string | null;
  descriptionPrefix: string;
}): Promise<string> {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `${params.descriptionPrefix}-${defaultsId.slice(0, 6)}`,
    display_name: `${params.descriptionPrefix}-${defaultsId.slice(0, 6)}`,
    description: `${params.descriptionPrefix} defaults`,
    board_id: params.boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: params.clientId ?? null,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return defaultsId;
}

describeDb('Inbound email in-app processing via webhooks (integration)', () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    db = await createTestDbConnection();

    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    clientId = client.client_id;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await db('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;
  }, 180_000);

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = '';
    process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = '';
    storageUploadMock.mockReset();
    storageUploadMock.mockImplementation(async (_buffer: Buffer, storagePath: string) => ({
      path: storagePath,
    }));
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('Gmail: webhook processes a new inbound email and creates 1 ticket + 1 initial comment', async () => {
    const providerId = uuidv4();
    const mailbox = `support-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId, subscriptionName } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = providerId;

    gmailListMessagesSinceMock = vi.fn().mockResolvedValue(['gmail-msg-1']);
    gmailGetMessageDetailsMock = vi.fn().mockResolvedValue({
      id: 'gmail-msg-1',
      provider: 'google',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject: 'Inbound email subject',
      body: { text: 'Hello from email', html: '<p>Hello from <strong>email</strong></p>' },
      attachments: [],
      threadId: 'thread-1',
      references: [],
    });

    const token = makeFakeJwt({
      aud: 'http://localhost:3000/api/email/webhooks/google',
      iss: 'issuer',
      sub: 'subject',
      email: 'pubsub-publishing@system.gserviceaccount.com',
    });

    const notification = { emailAddress: mailbox, historyId: '2' };
    const payload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-msg-1',
        publishTime: new Date().toISOString(),
      },
      subscription: `projects/project/subscriptions/${subscriptionName}`,
    };

    const { handleGoogleWebhook } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/googleWebhookHandler'
    );

    const req = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const res = await handleGoogleWebhook(req);
    expect(res.status).toBe(200);

    const tickets = await db('tickets').where({ tenant: tenantId, title: 'Inbound email subject' });
    expect(tickets).toHaveLength(1);

    const ticketId = tickets[0].ticket_id;
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
    expect(() => JSON.parse(comments[0].note)).not.toThrow();
  });

  it('Google: in-app path persists regular attachment, embedded image, and original .eml via shared artifact orchestrator', async () => {
    const providerId = uuidv4();
    const mailbox = `support-gmail-artifacts-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId, subscriptionName } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('email_processed_attachments').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = providerId;

    const messageId = `gmail-artifacts-${uuidv4()}@example.com`;
    const subject = `Gmail artifacts ${uuidv4().slice(0, 6)}`;
    gmailListMessagesSinceMock = vi.fn().mockResolvedValue([messageId]);
    gmailGetMessageDetailsMock = vi.fn().mockResolvedValue({
      id: messageId,
      provider: 'google',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject,
      body: {
        text: 'Google inbound body',
        html: `<p>Body<img src="data:image/png;base64,${Buffer.from('gmail-embedded').toString('base64')}" /></p>`,
      },
      attachments: [
        {
          id: 'att-google-1',
          name: 'google-regular.txt',
          contentType: 'text/plain',
          size: Buffer.from('google-regular').length,
          content: Buffer.from('google-regular').toString('base64'),
        },
      ],
      rawMimeBase64: Buffer.from('From: sender@example.com\r\n\r\ngmail').toString('base64'),
      threadId: 'gmail-thread-1',
      references: [],
    });

    const token = makeFakeJwt({
      aud: 'http://localhost:3000/api/email/webhooks/google',
      iss: 'issuer',
      sub: 'subject',
      email: 'pubsub-publishing@system.gserviceaccount.com',
    });
    const notification = { emailAddress: mailbox, historyId: '300' };
    const payload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-gmail-artifacts',
        publishTime: new Date().toISOString(),
      },
      subscription: `projects/project/subscriptions/${subscriptionName}`,
    };

    const { POST } = await import('@alga-psa/integrations/webhooks/email/google');
    const req = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('document_associations').where({ tenant: tenantId, entity_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });

    const docs = await db('documents as d')
      .join('document_associations as da', function () {
        this.on('d.document_id', 'da.document_id').andOn('d.tenant', 'da.tenant');
      })
      .where('d.tenant', tenantId)
      .andWhere('da.entity_type', 'ticket')
      .andWhere('da.entity_id', ticket.ticket_id)
      .select('d.document_name');
    const docNames = docs.map((d: any) => d.document_name);
    expect(docNames).toContain('google-regular.txt');
    expect(docNames).toContain('embedded-image-1.png');
    expect(docNames).toContain(expectedOriginalEmailFileName(messageId));
  });

  it('Microsoft: webhook processes a new inbound email and creates 1 ticket + 1 initial comment', async () => {
    const providerId = uuidv4();
    const mailbox = `support-ms-${uuidv4().slice(0, 6)}@example.com`;
    const subscriptionId = `sub-ms-${uuidv4()}`;
    const { defaultsId } = await setupMicrosoftProvider({ providerId, mailbox, subscriptionId });

    const messageId = `ms-msg-${uuidv4()}`;
    cleanup.push(async () => {
      await db('email_processed_messages').where({ tenant: tenantId, provider_id: providerId, message_id: messageId }).delete();
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = providerId;

    microsoftGetMessageDetailsMock = vi.fn().mockResolvedValue({
      id: messageId,
      provider: 'microsoft',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject: 'Inbound MS email subject',
      body: { text: 'Hello from MS email', html: '<p>Hello from <strong>MS</strong></p>' },
      attachments: [],
      threadId: 'thread-ms-1',
      references: [],
    });

    const payload = {
      value: [
        {
          changeType: 'created',
          clientState: 'ignored',
          resource: `/users/${uuidv4()}/messages/${messageId}`,
          resourceData: {
            '@odata.type': '#microsoft.graph.message',
            '@odata.id': 'ignored',
            id: messageId,
            subject: 'Inbound MS email subject',
          },
          subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
          subscriptionId,
          tenantId: 'ignored',
        },
      ],
    };

    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );

    const req = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await handleMicrosoftWebhookPost(req);
    expect(res.status).toBe(200);

    const tickets = await db('tickets').where({ tenant: tenantId, title: 'Inbound MS email subject' });
    expect(tickets).toHaveLength(1);

    const ticketId = tickets[0].ticket_id;
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
    expect(() => JSON.parse(comments[0].note)).not.toThrow();
  });

  it('Microsoft: in-app path persists regular attachment, embedded image, and original .eml via shared artifact orchestrator', async () => {
    const providerId = uuidv4();
    const mailbox = `support-ms-artifacts-${uuidv4().slice(0, 6)}@example.com`;
    const subscriptionId = `sub-ms-artifacts-${uuidv4()}`;
    const { defaultsId } = await setupMicrosoftProvider({ providerId, mailbox, subscriptionId });

    cleanup.push(async () => {
      await db('email_processed_attachments').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = providerId;

    const messageId = `ms-artifacts-${uuidv4()}@example.com`;
    const subject = `MS artifacts ${uuidv4().slice(0, 6)}`;
    microsoftGetMessageDetailsMock = vi.fn().mockResolvedValue({
      id: messageId,
      provider: 'microsoft',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject,
      body: {
        text: 'MS inbound body',
        html: `<p>Body<img src="data:image/png;base64,${Buffer.from('ms-embedded').toString('base64')}" /></p>`,
      },
      attachments: [
        {
          id: 'att-ms-1',
          name: 'ms-regular.txt',
          contentType: 'text/plain',
          size: Buffer.from('ms-regular').length,
          content: Buffer.from('ms-regular').toString('base64'),
        },
      ],
      rawMimeBase64: Buffer.from('From: sender@example.com\r\n\r\nmicrosoft').toString('base64'),
      threadId: 'ms-thread-1',
      references: [],
    });

    const payload = {
      value: [
        {
          changeType: 'created',
          clientState: 'ignored',
          resource: `/users/${uuidv4()}/messages/${messageId}`,
          resourceData: {
            '@odata.type': '#microsoft.graph.message',
            '@odata.id': 'ignored',
            id: messageId,
            subject,
          },
          subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
          subscriptionId,
          tenantId: 'ignored',
        },
      ],
    };

    const { POST } = await import('@alga-psa/integrations/webhooks/email/microsoft');
    const req = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('document_associations').where({ tenant: tenantId, entity_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });

    const docs = await db('documents as d')
      .join('document_associations as da', function () {
        this.on('d.document_id', 'da.document_id').andOn('d.tenant', 'da.tenant');
      })
      .where('d.tenant', tenantId)
      .andWhere('da.entity_type', 'ticket')
      .andWhere('da.entity_id', ticket.ticket_id)
      .select('d.document_name');
    const docNames = docs.map((d: any) => d.document_name);
    expect(docNames).toContain('ms-regular.txt');
    expect(docNames).toContain('embedded-image-1.png');
    expect(docNames).toContain(expectedOriginalEmailFileName(messageId));
  });

  it('IMAP in-app path persists regular attachment, embedded image, and original .eml as ticket documents', async () => {
    const providerId = uuidv4();
    const mailbox = `support-imap-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupImapProvider({ providerId, mailbox });

    cleanup.push(async () => {
      await db('email_processed_attachments').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'true';

    const regularAttachmentBase64 = Buffer.from('regular-attachment-body').toString('base64');
    const embeddedDataBase64 = Buffer.from('embedded-image-body').toString('base64');
    const embeddedDecodedSize = Buffer.from('embedded-image-body').length;
    const rawMimeBase64 = Buffer.from('From: sender@example.com\r\n\r\nbody').toString('base64');
    const subject = `IMAP artifacts subject ${uuidv4().slice(0, 6)}`;
    const messageId = `imap-artifacts-${uuidv4()}@example.com`;

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: messageId,
        provider: 'imap',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com', name: 'Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: {
          text: 'Inbound body',
          html: `<p>Body<img src="data:image/png;base64,${embeddedDataBase64}" /></p>`,
        },
        attachments: [
          {
            id: 'att-regular-1',
            name: 'regular.txt',
            contentType: 'text/plain',
            size: Buffer.from('regular-attachment-body').length,
            content: regularAttachmentBase64,
          },
        ],
        rawMimeBase64,
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('document_associations').where({ tenant: tenantId, entity_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });

    const docs = await db('documents as d')
      .join('document_associations as da', function () {
        this.on('d.document_id', 'da.document_id').andOn('d.tenant', 'da.tenant');
      })
      .where('d.tenant', tenantId)
      .andWhere('da.entity_type', 'ticket')
      .andWhere('da.entity_id', ticket.ticket_id)
      .select('d.document_name', 'd.file_id', 'd.mime_type');

    const documentNames = docs.map((d: any) => d.document_name).sort();
    expect(documentNames).toContain('regular.txt');
    expect(documentNames).toContain('embedded-image-1.png');
    expect(documentNames).toContain(expectedOriginalEmailFileName(messageId));
    const emlDocs = docs.filter((d: any) => d.document_name.endsWith('.eml'));
    expect(emlDocs).toHaveLength(1);

    const embeddedDoc = docs.find((d: any) => d.document_name === 'embedded-image-1.png');
    expect(embeddedDoc?.mime_type).toBe('image/png');

    const fileIds = docs.map((d: any) => d.file_id).filter(Boolean);
    expect(fileIds.length).toBeGreaterThanOrEqual(3);

    const files = await db('external_files')
      .where({ tenant: tenantId })
      .whereIn('file_id', fileIds)
      .select('file_id', 'mime_type', 'file_size');
    expect(files).toHaveLength(fileIds.length);

    const embeddedFile = files.find((f: any) => f.file_id === embeddedDoc?.file_id);
    expect(embeddedFile?.mime_type).toBe('image/png');
    expect(Number(embeddedFile?.file_size)).toBe(embeddedDecodedSize);
  });

  it('Idempotency: duplicate inbound message does not duplicate provider, embedded, or .eml artifact documents', async () => {
    const providerId = uuidv4();
    const mailbox = `support-imap-dupe-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupImapProvider({ providerId, mailbox });

    cleanup.push(async () => {
      await db('email_processed_attachments').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'true';

    const regularAttachmentBase64 = Buffer.from('duplicate-regular-attachment').toString('base64');
    const embeddedDataBase64 = Buffer.from('duplicate-embedded-image').toString('base64');
    const rawMimeBase64 = Buffer.from('From: sender@example.com\r\n\r\nduplicate-body').toString('base64');
    const subject = `IMAP duplicate artifacts ${uuidv4().slice(0, 6)}`;
    const messageId = `imap-dupe-${uuidv4()}@example.com`;
    const emlName = expectedOriginalEmailFileName(messageId);

    const emailData = {
      id: messageId,
      provider: 'imap',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject,
      body: {
        text: 'Inbound body',
        html: `<p>Body<img src="data:image/png;base64,${embeddedDataBase64}" /></p>`,
      },
      attachments: [
        {
          id: 'att-regular-1',
          name: 'regular-dupe.txt',
          contentType: 'text/plain',
          size: Buffer.from('duplicate-regular-attachment').length,
          content: regularAttachmentBase64,
        },
      ],
      rawMimeBase64,
    } as any;

    const first = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData,
    });
    expect(first.outcome).toBe('created');

    const second = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData,
    });
    expect(second.outcome).toBe('deduped');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('document_associations').where({ tenant: tenantId, entity_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });

    const docs = await db('documents as d')
      .join('document_associations as da', function () {
        this.on('d.document_id', 'da.document_id').andOn('d.tenant', 'da.tenant');
      })
      .where('d.tenant', tenantId)
      .andWhere('da.entity_type', 'ticket')
      .andWhere('da.entity_id', ticket.ticket_id)
      .select('d.document_name');

    const countByName = docs.reduce<Record<string, number>>((acc, item: any) => {
      const key = String(item.document_name);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    expect(countByName['regular-dupe.txt']).toBe(1);
    expect(countByName['embedded-image-1.png']).toBe(1);
    expect(countByName[emlName]).toBe(1);
  });

  it('Artifact failure: attachment persistence failure is recorded while ticket/comment creation still succeeds', async () => {
    const providerId = uuidv4();
    const mailbox = `support-imap-failure-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupImapProvider({ providerId, mailbox });

    cleanup.push(async () => {
      await db('email_processed_attachments').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'true';
    storageUploadMock.mockRejectedValueOnce(new Error('simulated upload failure'));

    const subject = `IMAP artifact failure ${uuidv4().slice(0, 6)}`;
    const messageId = `imap-failure-${uuidv4()}@example.com`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: messageId,
        provider: 'imap',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com', name: 'Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: {
          text: 'Inbound body',
          html: '<p>Inbound body</p>',
        },
        attachments: [
          {
            id: 'att-failure-1',
            name: 'failure.txt',
            contentType: 'text/plain',
            size: Buffer.from('failure-content').length,
            content: Buffer.from('failure-content').toString('base64'),
          },
        ],
        rawMimeBase64: Buffer.from('From: sender@example.com\r\n\r\nfailure').toString('base64'),
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('document_associations').where({ tenant: tenantId, entity_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);

    const failedAttachmentRow = await db('email_processed_attachments')
      .where({
        tenant: tenantId,
        provider_id: providerId,
        email_id: messageId,
        attachment_id: 'att-failure-1',
      })
      .first<any>();
    expect(failedAttachmentRow).toBeDefined();
    expect(failedAttachmentRow.processing_status).toBe('failed');
    expect(String(failedAttachmentRow.error_message || '')).toContain('simulated upload failure');
  });

  it('Reply threading: reply token resolves ticket and creates exactly 1 new comment', async () => {
    const providerId = uuidv4();
    const mailbox = `support-reply-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `REPLY-${Math.floor(Math.random() * 1_000_000)}`,
      title: 'Token threaded ticket',
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      board_id: boardId,
      entered_by: enteredByUserId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const replyToken = `token-${uuidv4()}`;
    await db('email_reply_tokens').insert({
      tenant: tenantId,
      token: replyToken,
      ticket_id: ticketId,
      comment_id: null,
      project_id: null,
      created_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('email_reply_tokens').where({ tenant: tenantId, token: replyToken }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `reply-email-${uuidv4()}`,
        provider: 'microsoft',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com', name: 'Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Re: Token threaded ticket',
        body: {
          text: `Customer reply\n\n[ALGA-REPLY-TOKEN ${replyToken}]\n\nOlder content`,
          html: undefined,
        },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('replied');
    expect(result.outcome === 'replied' ? result.ticketId : null).toBe(ticketId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);

    const ticketAfterReply = await db('tickets')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first<any>();
    expect(ticketAfterReply).toBeDefined();
    expect(ticketAfterReply.board_id).toBe(boardId);
  });

  it('Reply threading: In-Reply-To/References resolves ticket and creates exactly 1 new comment', async () => {
    const providerId = uuidv4();
    const mailbox = `support-thread-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const ticketId = uuidv4();
    const originalMessageId = `orig-${uuidv4()}@mail`;
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `THREAD-${Math.floor(Math.random() * 1_000_000)}`,
      title: 'Header threaded ticket',
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      board_id: boardId,
      entered_by: enteredByUserId,
      email_metadata: JSON.stringify({ messageId: originalMessageId, threadId: 'thread-x' }),
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `reply-email-${uuidv4()}`,
        provider: 'microsoft',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com', name: 'Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Re: Header threaded ticket',
        inReplyTo: originalMessageId,
        references: [originalMessageId],
        body: {
          text: 'Customer reply without embedded markers.',
          html: undefined,
        },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('replied');
    expect(result.outcome === 'replied' ? result.ticketId : null).toBe(ticketId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);

    const ticketAfterReply = await db('tickets')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first<any>();
    expect(ticketAfterReply).toBeDefined();
    expect(ticketAfterReply.board_id).toBe(boardId);
  });

  it("Contact match: sender email matches existing contact and ticket uses contact's client_id/contact_id", async () => {
    const providerId = uuidv4();
    const mailbox = `support-contact-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const contactClientId = uuidv4();
    const contactEmail = `contact-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Contact Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Inbound Contact',
      email: contactEmail,
      client_id: contactClientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: contactEmail, name: 'Inbound Contact' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Contact matched subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Contact matched subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(contactClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].author_type).toBe('client');
    expect(comments[0].contact_id).toBe(contactId);
    expect(comments[0].user_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it("Contact match (Microsoft): sender email matches existing contact and ticket stores contact-authored initial comment", async () => {
    const providerId = uuidv4();
    const mailbox = `support-ms-contact-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const contactClientId = uuidv4();
    const contactEmail = `ms-contact-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `MS Contact Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Inbound Microsoft Contact',
      email: contactEmail,
      client_id: contactClientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const subject = `Microsoft contact matched subject ${uuidv4().slice(0, 6)}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'microsoft',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: contactEmail, name: 'Inbound Microsoft Contact' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello from microsoft contact', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(contactClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].author_type).toBe('client');
    expect(comments[0].contact_id).toBe(contactId);
    expect(comments[0].user_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Contact reply match: reply-token threading stores contact-authored comment when sender has no user', async () => {
    const providerId = uuidv4();
    const mailbox = `support-ms-contact-reply-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const contactEmail = `ms-contact-reply-${uuidv4().slice(0, 6)}@example.com`;
    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Reply Contact',
      email: contactEmail,
      client_id: clientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `REPLY-CONTACT-${Math.floor(Math.random() * 1_000_000)}`,
      title: 'Contact reply threaded ticket',
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      board_id: boardId,
      entered_by: enteredByUserId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const replyToken = `token-${uuidv4()}`;
    await db('email_reply_tokens').insert({
      tenant: tenantId,
      token: replyToken,
      ticket_id: ticketId,
      comment_id: null,
      project_id: null,
      created_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('email_reply_tokens').where({ tenant: tenantId, token: replyToken }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `reply-email-${uuidv4()}`,
        provider: 'microsoft',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: contactEmail, name: 'Reply Contact' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Re: Contact reply threaded ticket',
        body: {
          text: `Customer contact reply\n\n[ALGA-REPLY-TOKEN ${replyToken}]\n\nOlder content`,
          html: undefined,
        },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('replied');
    expect(result.outcome === 'replied' ? result.ticketId : null).toBe(ticketId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
    expect(comments[0].author_type).toBe('client');
    expect(comments[0].contact_id).toBe(contactId);
    expect(comments[0].user_id ?? null).toBeNull();
  });

  it('Contact match: initial comment is associated with matched client user', async () => {
    const providerId = uuidv4();
    const mailbox = `support-contact-user-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const contactClientId = uuidv4();
    const contactEmail = `contact-user-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Contact User Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Inbound Contact User',
      email: contactEmail,
      client_id: contactClientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const clientUserId = uuidv4();
    await db('users').insert({
      user_id: clientUserId,
      tenant: tenantId,
      username: `client-user-${clientUserId.slice(0, 8)}`,
      email: contactEmail,
      first_name: 'Inbound',
      last_name: 'Client',
      hashed_password: 'not-a-real-hash',
      user_type: 'client',
      is_inactive: false,
      contact_id: contactId,
      created_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('users').where({ tenant: tenantId, user_id: clientUserId }).delete();
    });

    const subject = `Contact matched user subject ${uuidv4().slice(0, 6)}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: contactEmail, name: 'Inbound Contact User' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(contactClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].author_type).toBe('client');
    expect(comments[0].contact_id).toBe(contactId);
    expect(comments[0].user_id).toBe(clientUserId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Domain fallback: unique domain match sets ticket client_id (no default contact configured => contact is null)', async () => {
    const providerId = uuidv4();
    const mailbox = `support-domain-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `acme-${uuidv4().slice(0, 6)}.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Domain Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const domainMappingId = uuidv4();
    await db('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_inbound_email_domains').where({ tenant: tenantId, id: domainMappingId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `new.person@${domain}`, name: 'New Person' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Domain matched subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Domain matched subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(domainClientId);
    expect(ticket.contact_name_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Routing destination: exact sender contact override uses contact override defaults board', async () => {
    const providerId = uuidv4();
    const mailbox = `support-contact-override-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId: providerDefaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const overrideBoardId = await createRoutingBoardVariant('contact-override-board');
    const contactOverrideDefaultsId = await createInboundRoutingDefaults({
      boardId: overrideBoardId,
      descriptionPrefix: 'contact-override',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: contactOverrideDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: overrideBoardId }).delete();
    });

    const contactClientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Contact Override Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    const senderEmail = `override-${uuidv4().slice(0, 6)}@example.com`;
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Contact Override Sender',
      email: senderEmail,
      client_id: contactClientId,
      inbound_ticket_defaults_id: contactOverrideDefaultsId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const subject = `Contact override routing ${uuidv4().slice(0, 6)}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: senderEmail, name: 'Contact Override Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.board_id).toBe(overrideBoardId);
    expect(ticket.client_id).toBe(contactClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it("Routing destination: exact sender without contact override uses contact's client destination defaults", async () => {
    const providerId = uuidv4();
    const mailbox = `support-client-default-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId: providerDefaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const clientDefaultBoardId = await createRoutingBoardVariant('client-default-board');
    const clientDefaultDefaultsId = await createInboundRoutingDefaults({
      boardId: clientDefaultBoardId,
      descriptionPrefix: 'client-default',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: clientDefaultDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: clientDefaultBoardId }).delete();
    });

    const destinationClientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: destinationClientId,
      client_name: `Client Default Destination ${uuidv4().slice(0, 6)}`,
      inbound_ticket_defaults_id: clientDefaultDefaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: destinationClientId }).delete();
    });

    const contactId = uuidv4();
    const senderEmail = `client-default-${uuidv4().slice(0, 6)}@example.com`;
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Client Destination Sender',
      email: senderEmail,
      client_id: destinationClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const subject = `Client destination routing ${uuidv4().slice(0, 6)}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: senderEmail, name: 'Client Destination Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.board_id).toBe(clientDefaultBoardId);
    expect(ticket.client_id).toBe(destinationClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Routing destination: unknown sender + domain-matched client uses domain client destination defaults', async () => {
    const providerId = uuidv4();
    const mailbox = `support-domain-destination-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId: providerDefaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const domainDestinationBoardId = await createRoutingBoardVariant('domain-destination-board');
    const domainDestinationDefaultsId = await createInboundRoutingDefaults({
      boardId: domainDestinationBoardId,
      descriptionPrefix: 'domain-default',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: domainDestinationDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: domainDestinationBoardId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `routing-${uuidv4().slice(0, 6)}.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Domain Destination Client ${uuidv4().slice(0, 6)}`,
      inbound_ticket_defaults_id: domainDestinationDefaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const domainMappingId = uuidv4();
    await db('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_inbound_email_domains').where({ tenant: tenantId, id: domainMappingId }).delete();
    });

    const subject = `Domain destination routing ${uuidv4().slice(0, 6)}`;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `new.person@${domain}`, name: 'New Person' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.board_id).toBe(domainDestinationBoardId);
    expect(ticket.client_id).toBe(domainClientId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it("Domain fallback: applies client's default contact when configured (client.properties.primary_contact_id)", async () => {
    const providerId = uuidv4();
    const mailbox = `support-domain-default-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `acme-${uuidv4().slice(0, 6)}.com`;
    const defaultContactId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Domain Default Client ${uuidv4().slice(0, 6)}`,
      properties: JSON.stringify({
        primary_contact_id: defaultContactId,
        primary_contact_name: 'Primary Contact',
      }),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const domainMappingId = uuidv4();
    await db('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_inbound_email_domains').where({ tenant: tenantId, id: domainMappingId }).delete();
    });

    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: defaultContactId,
      full_name: 'Primary Contact',
      email: `primary@${domain}`,
      client_id: domainClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: defaultContactId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `someoneelse@${domain}`, name: 'Someone Else' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Domain matched default contact subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Domain matched default contact subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(domainClientId);
    expect(ticket.contact_name_id).toBe(defaultContactId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Domain fallback: does not match by domain unless the domain is explicitly configured', async () => {
    const providerId = uuidv4();
    const mailbox = `support-domain-ambig-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const domain = `shared-${uuidv4().slice(0, 6)}.com`;
    const domainClientId = uuidv4();

    await db('clients').insert(
      {
        tenant: tenantId,
        client_id: domainClientId,
        client_name: `Unconfigured Domain Client ${uuidv4().slice(0, 6)}`,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      }
    );
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    // Seed a contact with the same domain to ensure the system does NOT infer domain ownership from contacts.
    const seedContactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: seedContactId,
      full_name: 'Seed Contact',
      email: `seed@${domain}`,
      client_id: domainClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: seedContactId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `x@${domain}`, name: 'Ambiguous Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Domain ambiguous subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Domain ambiguous subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.contact_name_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Domain fallback: when resolved client differs from defaults, ticket location_id is null', async () => {
    const providerId = uuidv4();
    const mailbox = `support-domain-location-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const defaultsLocationId = uuidv4();
    await db('client_locations').insert({
      tenant: tenantId,
      location_id: defaultsLocationId,
      client_id: clientId,
      location_name: 'Defaults Location',
      address_line1: '1 Main St',
      city: 'City',
      country_code: 'US',
      country_name: 'United States',
      is_default: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_locations').where({ tenant: tenantId, location_id: defaultsLocationId }).delete();
    });

    await db('inbound_ticket_defaults')
      .where({ tenant: tenantId, id: defaultsId })
      .update({ location_id: defaultsLocationId });

    const domainClientId = uuidv4();
    const domain = `acme-${uuidv4().slice(0, 6)}.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Domain Location Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const domainMappingId = uuidv4();
    await db('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_inbound_email_domains').where({ tenant: tenantId, id: domainMappingId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `new.person@${domain}`, name: 'New Person' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Domain matched location subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Domain matched location subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(domainClientId);
    expect(ticket.location_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Unmatched sender: inbound email is treated as customer-authored and awaits internal response', async () => {
    const providerId = uuidv4();
    const mailbox = `support-unmatched-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `unknown-${uuidv4().slice(0, 6)}@example.com`, name: 'Unknown' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Unmatched sender subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Unmatched sender subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.board_id).toBe(boardId);
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.contact_name_id ?? null).toBeNull();
    expect(ticket.response_state).toBe('awaiting_internal');

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].author_type).toBe('client');
    expect(comments[0].contact_id ?? null).toBeNull();
    expect(comments[0].user_id ?? null).toBeNull();

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Contact match: sender email is normalized from display-name format', async () => {
    const providerId = uuidv4();
    const mailbox = `support-contact-normalize-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const contactClientId = uuidv4();
    const canonicalEmail = `contact-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Normalized Contact Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Normalized Inbound Contact',
      email: canonicalEmail,
      client_id: contactClientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const displayFormattedSender = `  "Normalized Inbound Contact" <${canonicalEmail.toUpperCase()}>  `;
    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: displayFormattedSender, name: 'Normalized Inbound Contact' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Contact normalized sender subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Contact normalized sender subject' })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(ticket.client_id).toBe(contactClientId);
    expect(ticket.contact_name_id).toBe(contactId);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Missing defaults: inbound processing returns without creating ticket/comment', async () => {
    const providerId = uuidv4();
    const mailbox = `support-missing-defaults-${uuidv4().slice(0, 6)}@example.com`;

    await db('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Missing defaults provider',
      mailbox,
      is_active: true,
      status: 'connected',
      vendor_config: JSON.stringify({}),
      inbound_ticket_defaults_id: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `unknown-${uuidv4().slice(0, 6)}@example.com`, name: 'Unknown' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Missing defaults subject',
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'missing_defaults' });

    const tickets = await db('tickets').where({ tenant: tenantId, title: 'Missing defaults subject' });
    expect(tickets).toHaveLength(0);
  });

  it('Attachments: attachment failure does not prevent ticket creation', async () => {
    const emailActions = await import('@alga-psa/workflows/actions/emailWorkflowActions');
    const spy = vi.spyOn(emailActions, 'processEmailAttachment').mockRejectedValueOnce(new Error('boom'));

    const providerId = uuidv4();
    const mailbox = `support-attach-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      spy.mockRestore();
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: `unknown-${uuidv4().slice(0, 6)}@example.com`, name: 'Unknown' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Attachment failure subject',
        body: { text: 'Hello', html: undefined },
        attachments: [{ id: 'att-1', name: 'file.txt', contentType: 'text/plain', size: 10 }],
      } as any,
    });

    expect(result.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: 'Attachment failure subject' })
      .first<any>();
    expect(ticket).toBeDefined();

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Attachments: attachment failure does not prevent reply comment creation', async () => {
    const emailActions = await import('@alga-psa/workflows/actions/emailWorkflowActions');
    const spy = vi.spyOn(emailActions, 'processEmailAttachment').mockRejectedValueOnce(new Error('boom'));

    const providerId = uuidv4();
    const mailbox = `support-reply-attach-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      spy.mockRestore();
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `REPLYATT-${Math.floor(Math.random() * 1_000_000)}`,
      title: 'Reply attach ticket',
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      board_id: boardId,
      entered_by: enteredByUserId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const replyToken = `token-${uuidv4()}`;
    await db('email_reply_tokens').insert({
      tenant: tenantId,
      token: replyToken,
      ticket_id: ticketId,
      comment_id: null,
      project_id: null,
      created_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('email_reply_tokens').where({ tenant: tenantId, token: replyToken }).delete();
    });

    const result = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `reply-email-${uuidv4()}`,
        provider: 'microsoft',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com', name: 'Sender' },
        to: [{ email: mailbox, name: 'Support' }],
        subject: 'Re: Reply attach ticket',
        body: {
          text: `Customer reply\n\n[ALGA-REPLY-TOKEN ${replyToken}]\n\nOlder content`,
          html: undefined,
        },
        attachments: [{ id: 'att-1', name: 'file.txt', contentType: 'text/plain', size: 10 }],
      } as any,
    });

    expect(result.outcome).toBe('replied');

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
  });

  it('Idempotency: replay same reply email does not create duplicate comments', async () => {
    const providerId = uuidv4();
    const mailbox = `support-idem-reply-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupMicrosoftProvider({
      providerId,
      mailbox,
      subscriptionId: `sub-ms-${uuidv4()}`,
    });

    cleanup.push(async () => {
      await db('microsoft_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `IDEMR-${Math.floor(Math.random() * 1_000_000)}`,
      title: 'Idem reply ticket',
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      board_id: boardId,
      entered_by: enteredByUserId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticketId }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete();
    });

    const replyToken = `token-${uuidv4()}`;
    await db('email_reply_tokens').insert({
      tenant: tenantId,
      token: replyToken,
      ticket_id: ticketId,
      comment_id: null,
      project_id: null,
      created_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('email_reply_tokens').where({ tenant: tenantId, token: replyToken }).delete();
    });

    const emailId = `reply-email-${uuidv4()}`;
    const emailData = {
      id: emailId,
      provider: 'microsoft',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject: 'Re: Idem reply ticket',
      body: {
        text: `Customer reply\n\n[ALGA-REPLY-TOKEN ${replyToken}]\n\nOlder content`,
        html: undefined,
      },
      attachments: [],
    } as any;

    const first = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(first.outcome).toBe('replied');

    const second = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(second.outcome).toBe('deduped');

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
  });

  it('Idempotency: replay same new-email does not create duplicate tickets', async () => {
    const providerId = uuidv4();
    const mailbox = `support-idem-new-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    const emailId = `new-email-${uuidv4()}`;
    const emailData = {
      id: emailId,
      provider: 'google',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: `unknown-${uuidv4().slice(0, 6)}@example.com`, name: 'Unknown' },
      to: [{ email: mailbox, name: 'Support' }],
      subject: 'Idem new subject',
      body: { text: 'Hello', html: undefined },
      attachments: [],
    } as any;

    const first = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(first.outcome).toBe('created');

    const second = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(second.outcome).toBe('deduped');

    const tickets = await db('tickets').where({ tenant: tenantId, title: 'Idem new subject' });
    expect(tickets).toHaveLength(1);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id });
    expect(comments).toHaveLength(1);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id }).delete();
    });
  });

  it('Idempotency: replay same routed contact-override email does not create duplicate routed tickets', async () => {
    const providerId = uuidv4();
    const mailbox = `support-idem-routed-${uuidv4().slice(0, 6)}@example.com`;
    const { defaultsId: providerDefaultsId } = await setupInboundDefaults({ providerId, mailbox });

    cleanup.push(async () => {
      await db('gmail_processed_history').where({ tenant: tenantId, provider_id: providerId }).delete();
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const overrideBoardId = await createRoutingBoardVariant('idem-routed-override-board');
    const contactOverrideDefaultsId = await createInboundRoutingDefaults({
      boardId: overrideBoardId,
      descriptionPrefix: 'idem-routed-contact-override',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: contactOverrideDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: overrideBoardId }).delete();
    });

    const contactClientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Idempotency Routed Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const contactId = uuidv4();
    const senderEmail = `idem-routed-${uuidv4().slice(0, 6)}@example.com`;
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Idempotency Routed Sender',
      email: senderEmail,
      client_id: contactClientId,
      inbound_ticket_defaults_id: contactOverrideDefaultsId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
    });

    const subject = `Idem routed subject ${uuidv4().slice(0, 6)}`;
    const emailId = `new-email-${uuidv4()}`;
    const emailData = {
      id: emailId,
      provider: 'google',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: senderEmail, name: 'Idempotency Routed Sender' },
      to: [{ email: mailbox, name: 'Support' }],
      subject,
      body: { text: 'Hello', html: undefined },
      attachments: [],
    } as any;

    const first = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(first.outcome).toBe('created');

    const second = await processInboundEmailInApp({ tenantId, providerId, emailData });
    expect(second.outcome).toBe('deduped');

    const tickets = await db('tickets').where({ tenant: tenantId, title: subject });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].board_id).toBe(overrideBoardId);
    expect(tickets[0].client_id).toBe(contactClientId);
    expect(tickets[0].contact_name_id).toBe(contactId);

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id });
    expect(comments).toHaveLength(1);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: tickets[0].ticket_id }).delete();
    });
  });
});
