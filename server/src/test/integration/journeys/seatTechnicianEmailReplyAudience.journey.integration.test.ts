import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { EmulatorHost } from '@alga-psa/emulator-host';
import smtpSink, { type CapturedEmail } from '@alga-psa/emulator-smtp-sink';
import { TenantEmailService } from '@alga-psa/email';
import { changeThreadAudience, commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// S33 (T043): a seat technician answers a ticket notification by email.
//
// The whole loop is real, the wire included: an MSP agent's note is written through the comment
// model, TICKET_COMMENT_ADDED runs through the real subscriber, sendEventEmail (the reply token
// is minted and persisted) and the tenant's real SMTP provider, which delivers to the email
// emulator (`@alga-psa/emulator-smtp-sink`, started in this process on free ports). The
// technician's reply is built from the message the emulator received, its Message-ID and the
// reply token in its body, and handed to processInboundEmailInApp as a real inbound message.
//
// A reply is stored with the audience of the notification it answers: shared IT stays shared IT,
// requester stays requester, and nothing a technician writes is ever stored private or widened.

let db: Knex;
let tenantId: string;

let mailHost: EmulatorHost;
let mailControlUrl: string;
let originalEmailSettings: Record<string, unknown> | undefined;

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
    // The tenant's outbound mail goes to the emulator for the length of this suite.
    mailHost = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const { controlPort, ports } = await mailHost.start();
    mailControlUrl = `http://127.0.0.1:${controlPort}`;
    const emulatorSettings = {
      default_from_domain: FROM_DOMAIN, email_provider: 'smtp',
      provider_configs: JSON.stringify([{
        providerType: 'smtp', providerId: 'seat-reply-smtp-emulator', isEnabled: true,
        config: { host: '127.0.0.1', port: ports['smtp-sink'], secure: false, rejectUnauthorized: false, requireTLS: false, from: `support@${FROM_DOMAIN}` },
      }]),
      fallback_enabled: true, tracking_enabled: false,
    };
    originalEmailSettings = await t('tenant_email_settings').first();
    if (originalEmailSettings) await t('tenant_email_settings').update(emulatorSettings);
    else await t('tenant_email_settings').insert({ tenant: tenantId, ...emulatorSettings });
    await TenantEmailService.invalidateTenantSettings(tenantId);

    // The client with a live seat arrangement, and its one seat technician.
    clientId = uuidv4();
    await t('clients').insert({
      tenant: tenantId, client_id: clientId, client_name: `Seat Client ${clientId.slice(0, 8)}`,
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    arrangementId = uuidv4();
    await t('co_managed_seat_arrangements').insert({ tenant: tenantId, arrangement_id: arrangementId, client_id: clientId, allocation_id: uuidv4(), state: 'active' });
    await db.transaction((trx) => retainBuiltinResolverSubject(trx, { tenant: tenantId, userId: seatUserId }, CO_MANAGED_SEAT_RESOLVER_ID));
    await t('co_managed_seat_assignments').insert({ tenant: tenantId, assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: seatUserId, state: 'active' });

    ({ processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp'));
    ({ handleTicketEvent } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await mailHost?.stop().catch(() => undefined);
    if (db && tenantId && mailControlUrl) {
      if (originalEmailSettings) {
        const { tenant: _tenant, ...restored } = originalEmailSettings;
        for (const key of ['provider_configs', 'custom_domains']) {
          if (restored[key] !== null && typeof restored[key] === 'object') restored[key] = JSON.stringify(restored[key]);
        }
        await t('tenant_email_settings').update(restored);
      } else {
        await t('tenant_email_settings').delete();
      }
      await TenantEmailService.invalidateTenantSettings(tenantId);
    }
    if (db && arrangementId) {
      await t('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
      await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId }).delete();
      await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).delete();
    }
    await db?.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await mailHost.reset('smtp-sink');
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

  /** Everything the emulator has received over SMTP since the last reset. */
  async function deliveredMail(): Promise<CapturedEmail[]> {
    const response = await fetch(`${mailControlUrl}/control/smtp-sink/state/emails`);
    return ((await response.json())?.result ?? []) as CapturedEmail[];
  }

  /**
   * The notification the technician received for one comment: the message as the emulator
   * received it, the reply token printed in its body, and the row that token was persisted as.
   */
  async function notificationTo(commentId: string) {
    const message = (await deliveredMail()).find((mail) => mail.to.some((address) => address.toLowerCase() === seatEmail));
    const replyToken = message?.text.match(/\[ALGA-REPLY-TOKEN (\S+)[^\]]*\]/)?.[1];
    const token = replyToken
      ? await t('email_reply_tokens').where({ token: replyToken, comment_id: commentId, recipient_email: seatEmail }).first()
      : undefined;
    return { message, replyToken, token };
  }

  /** The technician hits reply in their mail client: quoted token footer, threaded on our Message-ID. */
  function technicianReply(
    ticket: { ticketId: string; ticketNumber: string; title: string },
    notification: Awaited<ReturnType<typeof notificationTo>>,
    text: string,
    from = seatEmail,
  ) {
    if (!notification.message?.messageId || !notification.replyToken) throw new Error('The technician received no notification to reply to');
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
        inReplyTo: notification.message.messageId,
        references: [...notification.message.references, notification.message.messageId],
        subject: `Re: [Ticket #${ticket.ticketNumber}] ${ticket.title}`,
        // Their mail client quotes the notification under the reply, token footer and all.
        body: { text: `${text}\n\n${notification.message.text.split('\n').map((line) => `> ${line}`).join('\n')}` },
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
    expect(await t('email_reply_tokens').where({ comment_id: note.commentId, recipient_email: seatEmail }).first()).toBeUndefined();
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

  it('a reply to a ticket that has left the technician\'s scope is admitted as an external party and stored as requester, never shared IT', async () => {
    const ticket = await createTicket();
    const note = await agentNote(ticket.ticketId, 'Shared: escalating to the carrier.', { is_internal: true, collaboration_audience: 'shared_it' });
    const notification = await notificationTo(note.commentId);

    await t('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    const result = await technicianReply(ticket, notification, 'Any update from the carrier?');
    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token' });
    const reply = await stored((result as { commentId: string }).commentId);
    // Out of scope they are an external party: the reply is requester content in a thread of its own.
    expect(reply).toMatchObject({ audience: 'requester', is_internal: false, parent_comment_id: null });
    expect(reply.thread_id).not.toBe(note.threadId);
  }, HOOK_TIMEOUT);
});
