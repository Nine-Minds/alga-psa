import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Board notification rule, trigger "client replied on an unassigned ticket": delivered inside both
 * TICKET_COMMENT_ADDED handlers (email + in-app). Rule recipients are never assigned and never
 * added to the watch list, and the rule fires again on every further client reply.
 */
const sent: Array<{ to: string; template: string; recipientUserId?: string; replyContext?: Record<string, unknown> }> = [];
let testDb: Knex;
const deniedUserIds = new Set<string>();

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));

vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }),
}));

vi.mock('../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: { to: string; template: string; recipientUserId?: string; replyContext?: Record<string, unknown> }) => {
    sent.push({ to: params.to, template: params.template, recipientUserId: params.recipientUserId, replyContext: params.replyContext });
  }),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    getUserWithRoles: async (userId: string, tenant: string) => {
      const user = await actual.tenantDb(testDb, tenant).table('users').where({ user_id: userId }).first();
      return user ? { ...user, roles: [] } : null;
    },
  };
});
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>()),
  authorizeTicketRecordAccess: vi.fn(async (input: { user: { user_id: string } }) => {
    if (deniedUserIds.has(input.user.user_id)) {
      throw new Error('Permission denied: Cannot access ticket');
    }
    return {};
  }),
}));

const RULE_TEMPLATE = 'ticket-board-client-reply-unassigned';
const DL_ADDRESS = 'reply-dl@msp.test';

describe('board notification rules: client-reply-on-unassigned trigger delivery (integration)', () => {
  let tenant: string;
  let clientId: string;
  let contactId: string;
  let boardId: string;
  let statusId: string;
  let closedStatusId: string;
  let priorityId: string;
  let scoped: ReturnType<typeof tenantDb>;
  let users: Record<string, string>;
  let ruleTeamId: string;
  let ruleId: string;
  let emailHandler: (event: any) => Promise<void>;
  let inAppHandler: (event: any, opts?: any) => Promise<void>;
  let TicketModel: typeof import('../../../../shared/models/ticketModel')['TicketModel'];

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketCommentAdded: emailHandler } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
    ({ internalNotificationSubscriberTestHarness: { handleTicketCommentAdded: inAppHandler } } = await import(
      '../../lib/eventBus/subscribers/internalNotificationSubscriber'
    ));
    ({ TicketModel } = await import('../../../../shared/models/ticketModel'));

    tenant = await createTenant(testDb, `ReplyRule ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    contactId = uuidv4();
    await scoped.table('contacts').insert({
      tenant, contact_name_id: contactId, full_name: 'Casey Contact', email: 'casey@client.example', client_id: clientId,
    });
    users = {
      assignee: await createUser(testDb, tenant, { email: 'assignee@example.com' }),
      agent: await createUser(testDb, tenant, { email: 'agent@example.com' }),
      techA: await createUser(testDb, tenant, { email: 'a@example.com' }),
      techB: await createUser(testDb, tenant, { email: 'b@example.com' }),
      member1: await createUser(testDb, tenant, { email: 'm1@example.com' }),
      member2: await createUser(testDb, tenant, { email: 'm2@example.com' }),
      gone: await createUser(testDb, tenant, { email: 'gone@example.com', is_inactive: true }),
      watcher: await createUser(testDb, tenant, { email: 'watcher@example.com' }),
      portal: await createUser(testDb, tenant, {
        email: 'casey@client.example', user_type: 'client', contact_id: contactId,
        first_name: 'Casey', last_name: 'Contact',
      }),
    };
    ruleTeamId = uuidv4();
    await scoped.table('teams').insert({ tenant, team_id: ruleTeamId, team_name: 'Rule team', manager_id: users.techA });
    await scoped.table('team_members').insert([
      { tenant, team_id: ruleTeamId, user_id: users.member1 },
      { tenant, team_id: ruleTeamId, user_id: users.member2 },
      { tenant, team_id: ruleTeamId, user_id: users.gone },
    ]);

    boardId = uuidv4();
    statusId = uuidv4();
    closedStatusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Reply Queue', is_default: true });
    await scoped.table('statuses').insert([
      { tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
      { tenant, status_id: closedStatusId, board_id: boardId, name: 'Closed', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: true },
    ]);
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: users.techA });

    ruleId = uuidv4();
    await scoped.table('board_notification_rules').insert({
      tenant, rule_id: ruleId, board_id: boardId, notify_on_create: false, notify_on_unassigned_client_reply: true,
    });
    await scoped.table('board_notification_rule_recipients').insert([
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techA },
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techB },
      { tenant, rule_id: ruleId, recipient_type: 'team', team_id: ruleTeamId },
      { tenant, rule_id: ruleId, recipient_type: 'email', email: DL_ADDRESS },
    ]);
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(async () => {
    sent.length = 0;
    deniedUserIds.clear();
    await scoped.table('internal_notifications').delete();
  });

  async function createTicketRow(extra: Record<string, unknown> = {}): Promise<string> {
    const ticketId = uuidv4();
    await scoped.table('tickets').insert({
      tenant,
      ticket_id: ticketId,
      ticket_number: `T-${uuidv4().slice(0, 6)}`,
      title: 'Printer on fire',
      client_id: clientId,
      contact_name_id: contactId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      ticket_origin: 'inbound_email',
      entered_at: new Date(),
      ...extra,
    });
    return ticketId;
  }

  const note = (text: string) =>
    JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

  /**
   * Insert a comment the way the product does (TicketModel.createComment) and build the bus event
   * the subscribers receive. `author_type: 'contact'` is stored as author_type 'client'.
   */
  async function comment(
    ticketId: string,
    text: string,
    fields: {
      author_type: 'contact' | 'internal';
      author_id?: string;
      contact_id?: string;
      is_internal?: boolean;
    }
  ): Promise<any> {
    const content = note(text);
    const created = await testDb.transaction((trx) => TicketModel.createComment({
      ticket_id: ticketId,
      content,
      is_internal: fields.is_internal ?? false,
      is_resolution: false,
      author_type: fields.author_type,
      author_id: fields.author_id,
      contact_id: fields.contact_id,
    } as any, tenant, trx));
    return {
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: tenant,
        ticketId,
        ...(fields.author_id ? { userId: fields.author_id, actorUserId: fields.author_id, actorType: 'USER' } : { actorType: 'SYSTEM' }),
        comment: {
          id: created.comment_id,
          content,
          author: fields.author_type === 'contact' ? 'Casey Contact' : 'MSP Author',
          isInternal: fields.is_internal ?? false,
        },
      },
    };
  }

  /** A client reply through the portal: a portal user who is the ticket's contact. */
  const portalReply = (ticketId: string, text = 'Any update? This is urgent.') =>
    comment(ticketId, text, { author_type: 'contact', author_id: users.portal, contact_id: contactId });

  async function deliver(event: any) {
    await runWithTenant(tenant, () => emailHandler(event));
    await runWithTenant(tenant, () => inAppHandler(event, { propagateErrors: true }));
  }

  async function inApp(): Promise<string[]> {
    const rows = await scoped.table('internal_notifications').where({ template_name: RULE_TEMPLATE });
    return rows.map((row: any) => row.user_id as string).sort();
  }
  const emails = () => sent.filter((email) => email.template === RULE_TEMPLATE).map((email) => email.to).sort();

  const allEmails = ['a@example.com', 'b@example.com', DL_ADDRESS, 'm1@example.com', 'm2@example.com'].sort();
  const allUsers = () => [users.techA, users.techB, users.member1, users.member2].sort();

  it('notifies the rule users, active team members and the plain address, without assigning or watching', async () => {
    const ticketId = await createTicketRow();
    await deliver(await portalReply(ticketId));

    expect(emails()).toEqual(allEmails);
    expect(await inApp()).toEqual(allUsers());
    // The plain address gets email only: no principal, no in-app row, no reply token.
    const toDl = sent.filter((email) => email.to === DL_ADDRESS);
    expect(toDl).toHaveLength(1);
    expect(toDl[0].recipientUserId).toBeUndefined();
    expect(toDl[0].replyContext).toMatchObject({ ticketId, issueReplyToken: false });
    expect(sent.find((email) => email.to === 'a@example.com')?.recipientUserId).toBe(users.techA);

    // The in-app alert names the board, the client, the reply and says the ticket is unassigned.
    const row = await scoped.table('internal_notifications')
      .where({ template_name: RULE_TEMPLATE, user_id: users.techA }).first();
    expect(row.title).toContain('Reply Queue');
    expect(row.message).toContain('Acme');
    expect(row.message).toContain('Casey Contact');
    expect(row.message).toContain('no assignee');
    expect(row.message).toContain('This is urgent.');
    expect(row.metadata?.ticketId ?? JSON.parse(row.metadata ?? '{}').ticketId).toBe(ticketId);

    const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.assigned_to).toBeNull();
    expect(ticket.assigned_team_id ?? null).toBeNull();
    expect(ticket.attributes?.watch_list).toBeUndefined();
  });

  it('does not fire when the ticket has an assignee', async () => {
    const ticketId = await createTicketRow({ assigned_to: users.assignee });
    await deliver(await portalReply(ticketId));

    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
    // The assignee still gets their standard comment notification.
    expect(sent.filter((email) => email.template === 'ticket-comment-added').map((email) => email.to))
      .toContain('assignee@example.com');
  });

  it('does not fire for an internal note or for an MSP-authored public comment', async () => {
    const internalNoteTicket = await createTicketRow();
    await deliver(await comment(internalNoteTicket, 'Internal only', {
      author_type: 'internal', author_id: users.agent, is_internal: true,
    }));
    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);

    // A client-visible comment written by an agent is an answer, not a client reply.
    const agentReplyTicket = await createTicketRow();
    await deliver(await comment(agentReplyTicket, 'We are on it', { author_type: 'internal', author_id: users.agent }));
    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });

  it('does not fire when the rule is disabled or the client-reply flag is off', async () => {
    await scoped.table('board_notification_rules').where({ rule_id: ruleId }).update({ is_enabled: false });
    try {
      await deliver(await portalReply(await createTicketRow()));
      expect(emails()).toEqual([]);
      expect(await inApp()).toEqual([]);
    } finally {
      await scoped.table('board_notification_rules').where({ rule_id: ruleId }).update({ is_enabled: true });
    }

    sent.length = 0;
    await scoped.table('internal_notifications').delete();
    await scoped.table('board_notification_rules').where({ rule_id: ruleId })
      .update({ notify_on_unassigned_client_reply: false, notify_on_create: true });
    try {
      await deliver(await portalReply(await createTicketRow()));
      expect(emails()).toEqual([]);
      expect(await inApp()).toEqual([]);
    } finally {
      await scoped.table('board_notification_rules').where({ rule_id: ruleId })
        .update({ notify_on_unassigned_client_reply: true, notify_on_create: false });
    }
  });

  it('fires again on a second client reply', async () => {
    const ticketId = await createTicketRow();
    await deliver(await portalReply(ticketId, 'Any update?'));
    await deliver(await portalReply(ticketId, 'This is now urgent.'));

    expect(sent.filter((email) => email.template === RULE_TEMPLATE && email.to === 'a@example.com')).toHaveLength(2);
    expect(sent.filter((email) => email.template === RULE_TEMPLATE && email.to === DL_ADDRESS)).toHaveLength(2);
    const rows = await scoped.table('internal_notifications').where({ template_name: RULE_TEMPLATE, user_id: users.techA });
    expect(rows).toHaveLength(2);
  });

  it('a rule recipient who also watches the ticket is notified exactly once', async () => {
    await scoped.table('board_notification_rule_recipients')
      .insert({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.watcher });
    try {
      const ticketId = await createTicketRow({
        attributes: JSON.stringify({ watch_list: [{ email: 'watcher@example.com', active: true }] }),
      });
      await deliver(await portalReply(ticketId));

      expect(sent.filter((email) => email.to === 'watcher@example.com')).toHaveLength(1);
      expect(sent.find((email) => email.to === 'watcher@example.com')?.template).toBe(RULE_TEMPLATE);
      const rows = await scoped.table('internal_notifications').where({ user_id: users.watcher });
      expect(rows).toHaveLength(1);
      expect(rows[0].template_name).toBe(RULE_TEMPLATE);
    } finally {
      await scoped.table('board_notification_rule_recipients')
        .where({ rule_id: ruleId, user_id: users.watcher }).delete();
    }
  });

  it('an inbound-email reply from the contact behaves like a portal reply', async () => {
    const ticketId = await createTicketRow();
    // The inbound-email path writes the comment with the contact and no user row.
    await deliver(await comment(ticketId, 'Replying by email', { author_type: 'contact', contact_id: contactId }));

    expect(emails()).toEqual(allEmails);
    expect(await inApp()).toEqual(allUsers());
  });

  it('does not fire on a closed ticket', async () => {
    const ticketId = await createTicketRow({ status_id: closedStatusId, is_closed: true });
    await deliver(await portalReply(ticketId));

    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });

  it('suppressInternalNotifications silences the rule on both channels', async () => {
    const ticketId = await createTicketRow();
    const event = await portalReply(ticketId);
    await deliver({ ...event, payload: { ...event.payload, suppressInternalNotifications: true } });

    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });

  it('skips a recipient denied by the per-record authorization policy', async () => {
    deniedUserIds.add(users.techB);
    const ticketId = await createTicketRow();
    await deliver(await portalReply(ticketId));

    expect(emails()).toEqual(['a@example.com', DL_ADDRESS, 'm1@example.com', 'm2@example.com'].sort());
    expect(await inApp()).toEqual([users.techA, users.member1, users.member2].sort());
  });

  it('does not fire for a ticket on a board without a client-reply rule', async () => {
    const otherBoard = uuidv4();
    const otherStatus = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: otherBoard, board_name: 'Other', is_default: false });
    await scoped.table('statuses').insert({ tenant, status_id: otherStatus, board_id: otherBoard, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    const ticketId = await createTicketRow({ board_id: otherBoard, status_id: otherStatus });
    await deliver(await portalReply(ticketId));

    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });
});
