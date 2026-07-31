import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// P0 journey (docs: journey-first testing pivot): the through-line an MSP's
// support mailbox actually walks — a customer email arrives and is resolved
// into a NEW ticket (client/contact matched by sender), the customer's second
// email on the same thread lands as a COMMENT on that ticket instead of a
// duplicate ticket, an agent's reply flows back out through the real
// notification pipeline with RFC threading headers anchored to the customer's
// original Message-ID (transport mocked, seam asserted), and the customer's
// reply to that outbound notification threads back onto the same ticket.
// The bricks (destination routing, findTicketByEmailThread, thread headers)
// are covered elsewhere; this asserts the seams between them.

let db: Knex;
let tenantId: string;

// Transport seam: every provider-level send lands here instead of the wire.
const outboundSends: any[] = [];

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture discovers the seeded tenant');
}

async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 15_000
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function textBlocks(text: string): string {
  return JSON.stringify([
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ]);
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'journey-test-user',
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

// The transport. TenantEmailService builds providers through
// EmailProviderManager; everything above this seam (thread-header
// application, Message-ID stamping, email_sending_logs persistence)
// stays real.
vi.mock('@alga-psa/email/providers/EmailProviderManager', () => {
  class MockEmailProviderManager {
    async initialize(_settings: unknown): Promise<void> {}
    async getAvailableProviders(_tenantId: string) {
      return [
        {
          providerId: 'journey-transport',
          providerType: 'smtp',
          sendEmail: async (message: any, _tenant: string) => {
            outboundSends.push(message);
            return {
              success: true,
              messageId: `journey-provider-${outboundSends.length}`,
              providerId: 'journey-transport',
              providerType: 'smtp',
              sentAt: new Date(),
            };
          },
        },
      ];
    }
  }
  return { EmailProviderManager: MockEmailProviderManager };
});

const HOOK_TIMEOUT = 180_000;

const FROM_DOMAIN = 'journeymail.example';

let processInboundEmailInApp: typeof import('@alga-psa/shared/services/email/processInboundEmailInApp').processInboundEmailInApp;
let handleTicketEvent: typeof import('@/lib/eventBus/subscribers/ticketEmailSubscriber').handleTicketEvent;

let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;
let agentUserId: string;
let providerId: string;
let providerMailbox: string;
let clientId: string;
let contactId: string;
let contactEmail: string;

describe('journey: inbound email → ticket → threaded reply → agent reply out', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();

    const tenantRow = await tenantRows(db).first<{ tenant: string }>('tenant');
    if (!tenantRow?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenantRow.tenant;

    const board = await tenantTable(db, tenantId, 'boards')
      .where({ tenant: tenantId })
      .first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await tenantTable(db, tenantId, 'statuses')
      .where({ tenant: tenantId, status_type: 'ticket', board_id: boardId })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await tenantTable(db, tenantId, 'priorities')
      .where({ tenant: tenantId })
      .first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await tenantTable(db, tenantId, 'users')
      .where({ tenant: tenantId })
      .first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;

    // The responding agent (internal user) — author of the outbound reply.
    agentUserId = uuidv4();
    await tenantTable(db, tenantId, 'users').insert({
      tenant: tenantId,
      user_id: agentUserId,
      username: `journey.agent.${agentUserId.slice(0, 8)}`,
      first_name: 'Journey',
      last_name: 'Agent',
      email: `journey-agent-${agentUserId.slice(0, 8)}@msp.example`,
      hashed_password: 'x',
      created_at: db.fn.now(),
      two_factor_enabled: false,
      is_google_user: false,
      is_inactive: false,
      user_type: 'internal',
    });

    // Inbound routing config, as email settings UI would have built it:
    // provider-level inbound ticket defaults + the provider mailbox.
    const defaultsId = uuidv4();
    await tenantTable(db, tenantId, 'inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant: tenantId,
      short_name: `journey-${defaultsId.slice(0, 6)}`,
      display_name: `Journey Defaults ${defaultsId.slice(0, 6)}`,
      description: 'journey inbound defaults',
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      client_id: null,
      entered_by: enteredByUserId,
      is_active: true,
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    providerId = uuidv4();
    providerMailbox = `support-${providerId.slice(0, 6)}@${FROM_DOMAIN}`;
    await tenantTable(db, tenantId, 'email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Journey Inbound Provider',
      mailbox: providerMailbox,
      is_active: true,
      status: 'connected',
      inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Outbound settings so TenantEmailService resolves a provider (the mocked
    // transport) and a real from-domain for generated Message-IDs.
    await tenantTable(db, tenantId, 'tenant_email_settings').insert({
      tenant: tenantId,
      default_from_domain: FROM_DOMAIN,
      email_provider: 'smtp',
      provider_configs: JSON.stringify([
        {
          providerType: 'smtp',
          providerId: 'journey-smtp',
          isEnabled: true,
          config: { from: `support@${FROM_DOMAIN}` },
        },
      ]),
      fallback_enabled: true,
      tracking_enabled: false,
    });

    // The customer: a client with a contact whose address is the sender.
    clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey Customer ${clientId.slice(0, 8)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    contactId = uuidv4();
    contactEmail = `pat.customer-${contactId.slice(0, 6)}@customer.example`;
    await tenantTable(db, tenantId, 'contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Pat Customer',
      email: contactEmail,
      client_id: clientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    ({ processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    ));
    ({ handleTicketEvent } = await import(
      '@/lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('routes the thread end to end: new ticket, same-thread comment, threaded agent reply out, customer reply back in', async () => {
    const MSG1 = `<journey-cust-1-${uuidv4().slice(0, 8)}@customer.example>`;
    const MSG2 = `<journey-cust-2-${uuidv4().slice(0, 8)}@customer.example>`;
    const PROVIDER_THREAD = `journey-thread-${uuidv4().slice(0, 8)}`;
    const SUBJECT = `Printer on fire ${uuidv4().slice(0, 6)}`;

    const inboundEmail = (overrides: Record<string, unknown>) => ({
      provider: 'google',
      providerId,
      tenant: tenantId,
      receivedAt: new Date().toISOString(),
      from: { email: contactEmail, name: 'Pat Customer' },
      to: [{ email: providerMailbox, name: 'Support' }],
      attachments: [],
      ...overrides,
    });

    // --- Step 1: first customer email becomes a NEW ticket for the matched
    // client/contact (sender match, not provider-default fallback). ---
    const res1 = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: inboundEmail({
        id: MSG1,
        threadId: PROVIDER_THREAD,
        subject: SUBJECT,
        body: { text: 'Our printer is on fire. Please help.' },
      }) as any,
    });
    if (res1.outcome !== 'created') {
      console.error('Step 1 unexpected result:', JSON.stringify(res1, null, 2));
    }
    expect(res1.outcome).toBe('created');
    const ticketId = (res1 as { ticketId: string }).ticketId;

    const ticket = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first<any>();
    expect(ticket).toBeTruthy();
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.contact_name_id).toBe(contactId);
    expect(ticket.board_id).toBe(boardId);
    expect(ticket.title).toBe(SUBJECT);
    // The customer's Message-ID is the thread anchor for everything below.
    expect(ticket.email_metadata?.messageId).toBe(MSG1);
    expect(ticket.email_metadata?.threadId).toBe(PROVIDER_THREAD);

    // --- Step 2: second email on the SAME thread (In-Reply-To / References /
    // provider thread) attaches as a comment — not a duplicate ticket. ---
    const res2 = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: inboundEmail({
        id: MSG2,
        threadId: PROVIDER_THREAD,
        inReplyTo: MSG1,
        references: [MSG1],
        subject: `Re: ${SUBJECT}`,
        body: { text: 'Update: now the fax machine is smoking too.' },
      }) as any,
    });
    if (res2.outcome !== 'replied') {
      console.error('Step 2 unexpected result:', JSON.stringify(res2, null, 2));
    }
    expect(res2.outcome).toBe('replied');
    expect((res2 as { matchedBy: string }).matchedBy).toBe('thread_headers');
    expect((res2 as { ticketId: string }).ticketId).toBe(ticketId);

    const clientTickets = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, client_id: clientId });
    expect(clientTickets).toHaveLength(1);

    const secondComment = await tenantTable(db, tenantId, 'comments')
      .where({ tenant: tenantId, comment_id: (res2 as { commentId: string }).commentId })
      .first<any>();
    expect(secondComment).toBeTruthy();
    expect(secondComment.ticket_id).toBe(ticketId);
    expect(secondComment.note).toContain('fax machine is smoking');
    expect(secondComment.author_type).toBe('client');
    expect(secondComment.contact_id).toBe(contactId);

    // --- Step 3: the agent replies. The comment is written through the real
    // model, the TICKET_COMMENT_ADDED event flows through the real subscriber
    // and sendEventEmail, and the outbound send hits the mocked transport with
    // RFC threading headers anchored to the customer's original message. ---
    const agentReplyBlocks = textBlocks('Extinguisher dispatched. Please power the printer down.');
    const { withAdminTransaction } = await import('@alga-psa/db');
    const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
    const agentCommentId = await withAdminTransaction(async (trx) => {
      const result = await TicketModel.createComment(
        {
          ticket_id: ticketId,
          content: agentReplyBlocks,
          is_internal: false,
          is_resolution: false,
          author_type: 'internal',
          author_id: agentUserId,
        },
        tenantId,
        trx
      );
      return result.comment_id;
    });

    outboundSends.length = 0;
    await handleTicketEvent({
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: agentUserId,
        comment: {
          id: agentCommentId,
          content: agentReplyBlocks,
          author: 'Journey Agent',
          isInternal: false,
          authorType: 'internal',
        },
      },
    } as any);

    if (outboundSends.length !== 1) {
      console.error('Step 3 outbound sends:', JSON.stringify(outboundSends, null, 2));
    }
    expect(outboundSends).toHaveLength(1);
    const outbound = outboundSends[0];

    // Recipient is the ticket's contact; sender is the tenant's outbound identity.
    expect(outbound.to?.map((r: any) => r.email)).toEqual([contactEmail]);
    expect(String(outbound.from?.email)).toContain(`@${FROM_DOMAIN}`);

    // The threading seam: the reply threads into the customer's original email.
    expect(outbound.headers?.['In-Reply-To']).toBe(MSG1);
    expect(String(outbound.headers?.References)).toContain(MSG1);
    // Alga stamps its own wire Message-ID on the configured sending domain.
    const outboundMessageId = outbound.headers?.['Message-ID'];
    expect(outboundMessageId).toBeTruthy();
    expect(outboundMessageId).not.toBe(MSG1);
    expect(outboundMessageId).toContain(`@${FROM_DOMAIN}`);
    // RFC 3834: notifications are marked auto-generated.
    expect(outbound.headers?.['Auto-Submitted']).toBe('auto-generated');
    // Stable subject token for client-side grouping.
    expect(outbound.subject).toContain(`[Ticket #${ticket.ticket_number}]`);

    // Seam: the outbound Message-ID joins the ticket's reference chain...
    const ticketAfterReply = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first<any>();
    expect(ticketAfterReply.email_metadata?.references).toContain(outboundMessageId);

    // ...a reply token is persisted for the recipient...
    const replyToken = await tenantTable(db, tenantId, 'email_reply_tokens')
      .where({ tenant: tenantId, ticket_id: ticketId, recipient_email: contactEmail })
      .first<any>();
    expect(replyToken).toBeTruthy();
    expect(replyToken.comment_id).toBe(agentCommentId);

    // ...and the send is logged with the on-wire RFC id (async best-effort write).
    const sendLog = await waitFor(
      () =>
        tenantTable(db, tenantId, 'email_sending_logs')
          .where({ tenant: tenantId, rfc_message_id: outboundMessageId })
          .first<any>(),
      'email_sending_logs row for the outbound reply'
    );
    expect(sendLog.status).toBe('sent');
    expect(sendLog.entity_type).toBe('ticket');
    expect(sendLog.entity_id).toBe(ticketId);

    // --- Step 4: the customer replies to the agent's notification. The
    // In-Reply-To now points at OUR outbound Message-ID; the reply must land
    // on the same ticket (threaded under the agent's comment), never a new one. ---
    const MSG3 = `<journey-cust-3-${uuidv4().slice(0, 8)}@customer.example>`;
    const res3 = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: inboundEmail({
        id: MSG3,
        threadId: PROVIDER_THREAD,
        inReplyTo: outboundMessageId,
        references: [MSG1, outboundMessageId],
        subject: `Re: [Ticket #${ticket.ticket_number}] ${SUBJECT}`,
        body: { text: 'Powered down. Thank you!' },
      }) as any,
    });
    if (res3.outcome !== 'replied') {
      console.error('Step 4 unexpected result:', JSON.stringify(res3, null, 2));
    }
    expect(res3.outcome).toBe('replied');
    expect((res3 as { matchedBy: string }).matchedBy).toBe('thread_headers');
    expect((res3 as { ticketId: string }).ticketId).toBe(ticketId);

    const thirdComment = await tenantTable(db, tenantId, 'comments')
      .where({ tenant: tenantId, comment_id: (res3 as { commentId: string }).commentId })
      .first<any>();
    expect(thirdComment).toBeTruthy();
    expect(thirdComment.ticket_id).toBe(ticketId);
    expect(thirdComment.note).toContain('Powered down');
    // Threaded under the agent's outbound comment, via the send log's thread linkage.
    expect(thirdComment.parent_comment_id).toBe(agentCommentId);

    // Through-line invariant: one conversation, one ticket, four comments.
    const finalTickets = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, client_id: clientId });
    expect(finalTickets).toHaveLength(1);
    const finalComments = await tenantTable(db, tenantId, 'comments')
      .where({ tenant: tenantId, ticket_id: ticketId });
    expect(finalComments).toHaveLength(4);
  }, HOOK_TIMEOUT);
});
