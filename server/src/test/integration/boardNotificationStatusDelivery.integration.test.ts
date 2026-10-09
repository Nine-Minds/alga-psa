import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Board notification rule, trigger "status entered": delivered by the TICKET_STATUS_CHANGED
 * handlers (email + in-app). Rule recipients are never assigned and never added to the watch list.
 */
const sent: Array<{ to: string; template: string }> = [];
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
  sendEventEmail: vi.fn(async (params: { to: string; template: string }) => {
    sent.push({ to: params.to, template: params.template });
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

const RULE_TEMPLATE = 'ticket-board-status-entered';

describe('board notification rules: status-entered trigger delivery (integration)', () => {
  let tenant: string;
  let clientId: string;
  let boardId: string;
  let newStatusId: string;
  let triggerStatusId: string;
  let otherStatusId: string;
  let priorityId: string;
  let scoped: ReturnType<typeof tenantDb>;
  let users: Record<string, string>;
  let ruleTeamId: string;
  let ruleId: string;
  let accumulate: ReturnType<typeof vi.spyOn>;
  let emailHandler: (event: any) => Promise<void>;
  let inAppHandler: (event: any, opts?: any) => Promise<void>;
  let emailCreatedHandler: (event: any) => Promise<void>;
  let inAppCreatedHandler: (event: any, opts?: any) => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketStatusChanged: emailHandler, handleTicketCreated: emailCreatedHandler } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
    ({ internalNotificationSubscriberTestHarness: { handleTicketStatusChanged: inAppHandler, handleTicketCreated: inAppCreatedHandler } } = await import(
      '../../lib/eventBus/subscribers/internalNotificationSubscriber'
    ));

    // The accumulator is "in play": ready, so a handler that routed through it would enqueue.
    const { NotificationAccumulator } = await import('../../lib/notifications/NotificationAccumulator');
    const instance = NotificationAccumulator.getInstance();
    vi.spyOn(instance, 'isReady').mockReturnValue(true);
    accumulate = vi.spyOn(instance, 'accumulate').mockResolvedValue(undefined as any);

    tenant = await createTenant(testDb, `StatusRule ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    users = {
      actor: await createUser(testDb, tenant, { email: 'actor@example.com' }),
      assignee: await createUser(testDb, tenant, { email: 'assignee@example.com' }),
      agent: await createUser(testDb, tenant, { email: 'agent@example.com' }),
      techA: await createUser(testDb, tenant, { email: 'a@example.com' }),
      techB: await createUser(testDb, tenant, { email: 'b@example.com' }),
      member1: await createUser(testDb, tenant, { email: 'm1@example.com' }),
      member2: await createUser(testDb, tenant, { email: 'm2@example.com' }),
      gone: await createUser(testDb, tenant, { email: 'gone@example.com', is_inactive: true }),
      watcher: await createUser(testDb, tenant, { email: 'watcher@example.com' }),
    };
    ruleTeamId = uuidv4();
    await scoped.table('teams').insert({ tenant, team_id: ruleTeamId, team_name: 'Rule team', manager_id: users.techA });
    await scoped.table('team_members').insert([
      { tenant, team_id: ruleTeamId, user_id: users.member1 },
      { tenant, team_id: ruleTeamId, user_id: users.member2 },
      { tenant, team_id: ruleTeamId, user_id: users.gone },
    ]);

    boardId = uuidv4();
    newStatusId = uuidv4();
    triggerStatusId = uuidv4();
    otherStatusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Helpdesk Queue', is_default: true });
    await scoped.table('statuses').insert([
      { tenant, status_id: newStatusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
      { tenant, status_id: triggerStatusId, board_id: boardId, name: 'Escalated', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: false },
      { tenant, status_id: otherStatusId, board_id: boardId, name: 'Waiting', status_type: 'ticket', item_type: 'ticket', order_number: 3, is_default: false, is_closed: false },
    ]);
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: users.techA });

    // Rule 1 (status trigger only): techA, techB, rule team. Rule 2 overlaps (techA, member1) to
    // prove cross-rule dedupe.
    ruleId = uuidv4();
    const rule2 = uuidv4();
    await scoped.table('board_notification_rules').insert([
      { tenant, rule_id: ruleId, board_id: boardId, notify_on_create: false },
      { tenant, rule_id: rule2, board_id: boardId, notify_on_create: false },
    ]);
    await scoped.table('board_notification_rule_statuses').insert([
      { tenant, rule_id: ruleId, status_id: triggerStatusId },
      { tenant, rule_id: rule2, status_id: triggerStatusId },
    ]);
    await scoped.table('board_notification_rule_recipients').insert([
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techA },
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techB },
      { tenant, rule_id: ruleId, recipient_type: 'team', team_id: ruleTeamId },
      { tenant, rule_id: rule2, recipient_type: 'user', user_id: users.techA },
      { tenant, rule_id: rule2, recipient_type: 'user', user_id: users.member1 },
    ]);
  }, 900_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await testDb?.destroy();
  });

  beforeEach(async () => {
    sent.length = 0;
    deniedUserIds.clear();
    accumulate.mockClear();
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
      board_id: boardId,
      status_id: triggerStatusId,
      priority_id: priorityId,
      entered_at: new Date(),
      ...extra,
    });
    return ticketId;
  }

  const statusEvent = (ticketId: string, extra: Record<string, unknown> = {}) => ({
    id: uuidv4(),
    eventType: 'TICKET_STATUS_CHANGED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId: tenant,
      ticketId,
      previousStatusId: newStatusId,
      newStatusId: triggerStatusId,
      changedAt: new Date().toISOString(),
      actorType: 'USER',
      actorUserId: users.actor,
      ...extra,
    },
  });

  async function deliver(event: any) {
    await runWithTenant(tenant, () => emailHandler(event));
    await runWithTenant(tenant, () => inAppHandler(event, { propagateErrors: true }));
  }

  async function inApp(): Promise<string[]> {
    const rows = await scoped.table('internal_notifications').where({ template_name: RULE_TEMPLATE });
    return rows.map((row: any) => row.user_id as string).sort();
  }
  const emails = () => sent.filter((email) => email.template === RULE_TEMPLATE).map((email) => email.to).sort();

  const allEmails = ['a@example.com', 'b@example.com', 'm1@example.com', 'm2@example.com'];
  const allUsers = () => [users.techA, users.techB, users.member1, users.member2].sort();

  it('delivers exactly one email and one in-app notification per user/active team member, deduped across rules, without assigning or watching', async () => {
    const ticketId = await createTicketRow();
    await deliver(statusEvent(ticketId));

    expect(emails()).toEqual(allEmails);
    expect(await inApp()).toEqual(allUsers());

    const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.assigned_to).toBeNull();
    expect(ticket.assigned_team_id ?? null).toBeNull();
    expect(ticket.attributes?.watch_list).toBeUndefined();
    const resources = await scoped.table('ticket_resources').where({ ticket_id: ticketId });
    expect(resources).toHaveLength(0);
  });

  it('sends the email immediately and never enqueues into the NotificationAccumulator', async () => {
    const ticketId = await createTicketRow();
    await runWithTenant(tenant, () => emailHandler(statusEvent(ticketId)));
    expect(emails()).toEqual(allEmails);
    expect(accumulate).not.toHaveBeenCalled();
  });

  it('does not fire when the ticket enters a status that is not in the rule', async () => {
    const ticketId = await createTicketRow({ status_id: otherStatusId });
    await deliver(statusEvent(ticketId, { previousStatusId: triggerStatusId, newStatusId: otherStatusId }));
    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });

  it('excludes the actor (actorUserId or legacy userId) on both channels', async () => {
    await scoped.table('board_notification_rule_recipients').insert({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.actor });
    try {
      const ticketId = await createTicketRow();
      await deliver(statusEvent(ticketId));
      expect(emails()).not.toContain('actor@example.com');
      expect(await inApp()).not.toContain(users.actor);

      sent.length = 0;
      await scoped.table('internal_notifications').delete();
      // Actor referenced only by legacy userId.
      await deliver(statusEvent(ticketId, { actorUserId: undefined, userId: users.techA }));
      expect(emails()).toEqual(['actor@example.com', 'b@example.com', 'm1@example.com', 'm2@example.com']);
      expect(await inApp()).toEqual([users.actor, users.techB, users.member1, users.member2].sort());
    } finally {
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId, user_id: users.actor }).delete();
    }
  });

  it('excludes the assignee and additional agents who are rule recipients', async () => {
    const ruleRecipients = [users.assignee, users.agent].map((userId) => ({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: userId }));
    await scoped.table('board_notification_rule_recipients').insert(ruleRecipients);
    try {
      const ticketId = await createTicketRow({ assigned_to: users.assignee });
      await scoped.table('ticket_resources').insert({
        tenant,
        ticket_id: ticketId,
        assigned_to: users.assignee,
        additional_user_id: users.agent,
        role: 'support',
        assigned_at: new Date(),
      });
      await deliver(statusEvent(ticketId));
      expect(emails()).toEqual(allEmails);
      expect(await inApp()).toEqual(allUsers());

      // A rule recipient who is the primary assignee (no resources) is excluded even when listed directly.
      sent.length = 0;
      await scoped.table('internal_notifications').delete();
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId }).whereIn('user_id', [users.assignee, users.agent]).delete();
      const otherTicket = await createTicketRow({ assigned_to: users.techA });
      await deliver(statusEvent(otherTicket));
      expect(emails()).toEqual(['b@example.com', 'm1@example.com', 'm2@example.com']);
      expect(await inApp()).toEqual([users.techB, users.member1, users.member2].sort());
    } finally {
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId }).whereIn('user_id', [users.assignee, users.agent]).delete();
    }
  });

  it('an active internal watcher gets no rule email (in-app still delivered)', async () => {
    await scoped.table('board_notification_rule_recipients').insert({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.watcher });
    try {
      const ticketId = await createTicketRow({
        attributes: JSON.stringify({ watch_list: [{ email: 'watcher@example.com', active: true }] }),
      });
      await deliver(statusEvent(ticketId));
      expect(emails()).toEqual(allEmails);
      expect(emails()).not.toContain('watcher@example.com');
      expect(await inApp()).toContain(users.watcher);
    } finally {
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId, user_id: users.watcher }).delete();
    }
  });

  it('suppressInternalNotifications silences the rule on both channels', async () => {
    const ticketId = await createTicketRow();
    await deliver(statusEvent(ticketId, { suppressInternalNotifications: true }));
    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });

  it('skips a recipient denied by the per-record authorization policy', async () => {
    deniedUserIds.add(users.techB);
    const ticketId = await createTicketRow();
    await deliver(statusEvent(ticketId));
    expect(emails()).toEqual(['a@example.com', 'm1@example.com', 'm2@example.com']);
    expect(await inApp()).toEqual([users.techA, users.member1, users.member2].sort());
  });

  it('a TICKET_CREATED does not trigger the status-entered rule (even for a ticket created in a trigger status)', async () => {
    const ticketId = await createTicketRow();
    const created = {
      id: uuidv4(),
      eventType: 'TICKET_CREATED',
      timestamp: new Date().toISOString(),
      payload: { tenantId: tenant, ticketId, occurredAt: new Date().toISOString(), actorType: 'SYSTEM' },
    };
    await runWithTenant(tenant, () => emailCreatedHandler(created));
    await runWithTenant(tenant, () => inAppCreatedHandler(created, { propagateErrors: true }));
    expect(emails()).toEqual([]);
    expect(await inApp()).toEqual([]);
  });
});
