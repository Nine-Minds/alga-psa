import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { changeThreadAudience, commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// S33 (T043): a seat technician answers a ticket notification by email.
//
// The whole loop is real except the wire: an MSP agent's note is written through the comment
// model, TICKET_COMMENT_ADDED runs through the real subscriber and sendEventEmail (the reply token
// is minted and persisted), and the technician's reply is a real inbound message handed to
// processInboundEmailInApp, carrying the token from the notification they received. The SMTP
// transport is replaced by a recorder, which stands in for the email emulator: the running app
// and its emulators are not available to this suite.
//
// A reply is stored with the audience of the notification it answers: shared IT stays shared IT,
// requester stays requester, and nothing a technician writes is ever stored private or widened.

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
          user_id: 'seat-reply-test-user',
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
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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
          providerId: 'seat-reply-transport',
          providerType: 'smtp',
          sendEmail: async (message: any, _tenant: string) => {
            outboundSends.push(message);
            return {
              success: true,
              messageId: `seat-reply-provider-${outboundSends.length}`,
              providerId: 'seat-reply-transport',
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
const FROM_DOMAIN = 'seatreply.example';
const SEAT_DOMAIN = 'client-it.example';

let processInboundEmailInApp: typeof import('@alga-psa/shared/services/email/processInboundEmailInApp').processInboundEmailInApp;
let handleTicketEvent: typeof import('@/lib/eventBus/subscribers/ticketEmailSubscriber').handleTicketEvent;

let boardId: string;
let statusId: string;
let priorityId: string;
let agentUserId: string;
let seatUserId: string;
let seatEmail: string;
let providerId: string;
let providerMailbox: string;
let clientId: string;
let arrangementId: string;

describe('journey: a seat technician replies by email to a ticket notification', () => {
  const t = (table: string) => tenantTable<any>(db, tenantId, table);

  async function insertInternalUser(label: string, email: string): Promise<string> {
    const userId = uuidv4();
    await t('users').insert({
      tenant: tenantId, user_id: userId, username: `${label}.${userId.slice(0, 8)}`, first_name: 'Seat', last_name: label,
      email, hashed_password: 'x', created_at: db.fn.now(), two_factor_enabled: false, is_google_user: false,
      is_inactive: false, user_type: 'internal',
    });
    return userId;
  }

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = undefined;

    const tenantRow = await tenantRows(db).first<{ tenant: string }>('tenant');
    if (!tenantRow?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenantRow.tenant;

    const board = await t('boards').first('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;
    const status = await t('statuses').where({ status_type: 'ticket', board_id: boardId }).first('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;
    const priority = await t('priorities').first('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;
    const enteredBy = await t('users').first('user_id');
    if (!enteredBy?.user_id) throw new Error('Expected seeded user');

    const run = uuidv4().slice(0, 8);
    agentUserId = await insertInternalUser('Agent', `agent-${run}@msp.example`);
    seatEmail = `tech-${run}@${SEAT_DOMAIN}`;
    seatUserId = await insertInternalUser('Technician', seatEmail);

    const defaultsId = uuidv4();
    await t('inbound_ticket_defaults').insert({
      id: defaultsId, tenant: tenantId, short_name: `seat-${defaultsId.slice(0, 6)}`,
      display_name: `Seat Reply Defaults ${defaultsId.slice(0, 6)}`, description: 'seat reply inbound defaults',
      board_id: boardId, status_id: statusId, priority_id: priorityId, client_id: null, entered_by: enteredBy.user_id,
      is_active: true, is_default: false, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    providerId = uuidv4();
    providerMailbox = `support-${providerId.slice(0, 6)}@${FROM_DOMAIN}`;
    await t('email_providers').insert({
      id: providerId, tenant: tenantId, provider_type: 'google', provider_name: 'Seat Reply Inbound Provider',
      mailbox: providerMailbox, is_active: true, status: 'connected', inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    if (!(await t('tenant_email_settings').first('tenant'))) {
      await t('tenant_email_settings').insert({
        tenant: tenantId, default_from_domain: FROM_DOMAIN, email_provider: 'smtp',
        provider_configs: JSON.stringify([
          { providerType: 'smtp', providerId: 'seat-reply-smtp', isEnabled: true, config: { from: `support@${FROM_DOMAIN}` } },
        ]),
        fallback_enabled: true, tracking_enabled: false,
      });
    }

    // The client with a live seat arrangement, and its one seat technician.
    clientId = uuidv4();
    await t('clients').insert({
      tenant: tenantId, client_id: clientId, client_name: `Seat Client ${clientId.slice(0, 8)}`,
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    arrangementId = uuidv4();
    await t('co_managed_seat_arrangements').insert({ tenant: tenantId, arrangement_id: arrangementId, client_id: clientId, allocation_id: uuidv4(), state: 'active' });
    await t('co_managed_seat_assignments').insert({ tenant: tenantId, assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: seatUserId, state: 'active' });

    ({ processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp'));
    ({ handleTicketEvent } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && arrangementId) {
      await t('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
      await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId }).delete();
      await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).delete();
    }
    await db?.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    outboundSends.length = 0;
    await t('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    await t('co_managed_seat_board_scopes').insert({ tenant: tenantId, arrangement_id: arrangementId, board_id: boardId, can_create: false });
  });

  /** A ticket of the arrangement's client, on the in-scope board, assigned to the technician. */
  async function createTicket(): Promise<{ ticketId: string; ticketNumber: string; title: string }> {
    const ticketId = uuidv4();
    const ticketNumber = `SR-${ticketId.slice(0, 8)}`;
    const title = `VPN keeps dropping ${ticketId.slice(0, 6)}`;
    await t('tickets').insert({
      tenant: tenantId, ticket_id: ticketId, ticket_number: ticketNumber, title, client_id: clientId, board_id: boardId,
      status_id: statusId, priority_id: priorityId, assigned_to: seatUserId, entered_at: new Date(),
    });
    return { ticketId, ticketNumber, title };
  }

  /** The MSP agent writes a note; the real subscriber mails whoever it reaches. Returns the comment. */
  async function agentNote(ticketId: string, text: string, fields: Record<string, unknown>): Promise<{ commentId: string; threadId: string }> {
    const content = textBlocks(text);
    const { withAdminTransaction } = await import('@alga-psa/db');
    const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
    const commentId = await withAdminTransaction(async (trx) => (await TicketModel.createComment({
      ticket_id: ticketId, content, is_resolution: false, author_type: 'internal', author_id: agentUserId, ...fields,
    } as any, tenantId, trx)).comment_id);
    await handleTicketEvent({
      id: uuidv4(), eventType: 'TICKET_COMMENT_ADDED', timestamp: new Date().toISOString(),
      payload: {
        tenantId, ticketId, userId: agentUserId,
        comment: { id: commentId, content, author: 'MSP Agent', isInternal: fields.is_internal === true, authorType: 'internal' },
      },
    } as any);
    const row = await t('comments').where({ comment_id: commentId }).first('thread_id');
    return { commentId, threadId: row.thread_id };
  }

  /** The notification the technician received for one comment: the wire message and its reply token. */
  async function notificationTo(commentId: string) {
    const message = outboundSends.find((send) => send.to?.some((r: any) => String(r.email).toLowerCase() === seatEmail));
    const token = await t('email_reply_tokens').where({ comment_id: commentId, recipient_email: seatEmail }).first();
    return { message, token };
  }

  /** The technician hits reply in their mail client: quoted token footer, threaded on our Message-ID. */
  function technicianReply(ticket: { ticketId: string; ticketNumber: string; title: string }, notification: { message: any; token: any }, text: string, from = seatEmail) {
    const domain = from.split('@')[1];
    return processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `<seat-reply-${uuidv4().slice(0, 8)}@${domain}>`,
        provider: 'google', providerId, tenant: tenantId, receivedAt: new Date().toISOString(),
        from: { email: from, name: 'Seat Technician' },
        to: [{ email: providerMailbox, name: 'Support' }],
        attachments: [],
        headers: { 'Authentication-Results': `mx.google.com; dkim=pass header.d=${domain}; spf=pass smtp.mailfrom=${from}` },
        inReplyTo: notification.message?.headers?.['Message-ID'],
        references: [notification.message?.headers?.['Message-ID']].filter(Boolean),
        subject: `Re: [Ticket #${ticket.ticketNumber}] ${ticket.title}`,
        body: { text: `${text}\n\n[ALGA-REPLY-TOKEN ${notification.token.token} ticketId=${ticket.ticketId} commentId=${notification.token.comment_id}]` },
      } as any,
    });
  }

  /** A stored comment with its audience, resolved exactly as every reader resolves it. */
  async function stored(commentId: string) {
    return tenantDb(db, tenantId).table('comments as c')
      .join('comment_threads as th', function () { this.on('th.thread_id', 'c.thread_id').andOn('th.tenant', 'c.tenant'); })
      .join('comments as root', function () { this.on('root.comment_id', 'th.root_comment_id').andOn('root.tenant', 'th.tenant'); })
      .where('c.comment_id', commentId).where('c.tenant', tenantId)
      .select('c.thread_id', 'c.parent_comment_id', 'c.is_internal', 'c.user_id', 'c.author_type', 'c.note',
        db.raw('(?) as audience', [commentAudienceSql(db, 'th', 'root', 'c')]))
      .first<any>();
  }

  it('a reply to a shared IT notification is stored as shared IT (F082)', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'Shared: please check the client firewall log.', { is_internal: true, collaboration_audience: 'shared_it' });
    const notification = await notificationTo(note.commentId);
    expect(notification.message).toBeTruthy();
    expect(notification.token?.metadata).toMatchObject({ notificationAudience: 'shared_it' });

    const result = await technicianReply(ticket, notification, 'Firewall log shows the tunnel resetting hourly.');
    if (result.outcome !== 'replied') console.error('unexpected result:', JSON.stringify(result, null, 2));
    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: ticket.ticketId });

    const reply = await stored((result as { commentId: string }).commentId);
    expect(reply.note).toContain('tunnel resetting hourly');
    expect(reply).toMatchObject({ audience: 'shared_it', is_internal: true, thread_id: note.threadId, user_id: seatUserId, author_type: 'internal' });
  }, HOOK_TIMEOUT);

  it('a reply to a requester-audience notification is stored as requester (F082)', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'We have restarted the concentrator. Is it stable now?', { is_internal: false });
    const notification = await notificationTo(note.commentId);
    expect(notification.message).toBeTruthy();
    expect(notification.token?.metadata).toMatchObject({ notificationAudience: 'requester' });

    const result = await technicianReply(ticket, notification, 'Stable for the last hour on site.');
    if (result.outcome !== 'replied') console.error('unexpected result:', JSON.stringify(result, null, 2));
    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: ticket.ticketId });

    const reply = await stored((result as { commentId: string }).commentId);
    expect(reply.note).toContain('Stable for the last hour');
    expect(reply).toMatchObject({ audience: 'requester', is_internal: false, thread_id: note.threadId, user_id: seatUserId });
  }, HOOK_TIMEOUT);

  it('a private note sends the technician nothing to reply to', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'Private: client is behind on the firewall renewal.', { is_internal: true });
    const notification = await notificationTo(note.commentId);
    expect(notification.message).toBeUndefined();
    expect(notification.token).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('a reply never follows a thread whose audience was widened after the notification was sent', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'Shared: rotating the pre-shared key tonight.', { is_internal: true, collaboration_audience: 'shared_it' });
    const notification = await notificationTo(note.commentId);

    // The MSP discloses the thread to the requester before the technician answers.
    await db.transaction((trx) => changeThreadAudience(trx, tenantId, {
      threadId: note.threadId, audience: 'requester', author: { kind: 'staff', tenant: tenantId }, confirmDisclosure: true,
    }));

    const result = await technicianReply(ticket, notification, 'Old key is still cached on two laptops.');
    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token' });
    const reply = await stored((result as { commentId: string }).commentId);
    // Still shared IT, in a thread of its own: what they wrote for IT is not shown to the requester.
    expect(reply).toMatchObject({ audience: 'shared_it', is_internal: true, parent_comment_id: null });
    expect(reply.thread_id).not.toBe(note.threadId);
  }, HOOK_TIMEOUT);

  it('a reply to a ticket that has left the technician\'s scope is refused and stores nothing', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'Shared: escalating to the carrier.', { is_internal: true, collaboration_audience: 'shared_it' });
    const notification = await notificationTo(note.commentId);
    const before = await t('comments').where({ ticket_id: ticket.ticketId }).where('is_system_generated', false).count<{ count: string }[]>('* as count');

    await t('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    const result = await technicianReply(ticket, notification, 'Any update from the carrier?');
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'reply_outside_sender_audience', ticketId: ticket.ticketId });
    const after = await t('comments').where({ ticket_id: ticket.ticketId }).where('is_system_generated', false).count<{ count: string }[]>('* as count');
    expect(Number(after[0].count)).toBe(Number(before[0].count));
  }, HOOK_TIMEOUT);
});
