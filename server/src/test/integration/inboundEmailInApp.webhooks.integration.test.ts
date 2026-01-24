import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { NextRequest } from 'next/server';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';

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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
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

function makeFakeJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
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

describe('Inbound email in-app processing via webhooks (integration)', () => {
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

    const { POST } = await import('@alga-psa/integrations/webhooks/email/microsoft');

    const req = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
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

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });

  it('Unmatched sender: system follows the defined behavior without throwing', async () => {
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
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.contact_name_id ?? null).toBeNull();

    const comments = await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);

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
    const emailActions = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
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
    const emailActions = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
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
});
