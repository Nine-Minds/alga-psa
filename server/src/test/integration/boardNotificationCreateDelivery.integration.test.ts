import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Board notification rule, trigger "created": delivered inside both existing handleTicketCreated
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

// Visibility filter dependencies: load the user from the test DB, grant RBAC read, and let the
// per-record policy (EE board-scoped bundles) deny specific users.
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

describe('board notification rules: create trigger delivery (integration)', () => {
  let tenant: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let scoped: ReturnType<typeof tenantDb>;
  let users: Record<string, string>;
  let ruleTeamId: string;
  let defaultTeamId: string;
  let emailHandler: (event: any) => Promise<void>;
  let inAppHandler: (event: any, opts?: any) => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketCreated: emailHandler } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
    ({ internalNotificationSubscriberTestHarness: { handleTicketCreated: inAppHandler } } = await import(
      '../../lib/eventBus/subscribers/internalNotificationSubscriber'
    ));

    tenant = await createTenant(testDb, `BoardRule ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    users = {
      assignee: await createUser(testDb, tenant, { email: 'assignee@example.com' }),
      techA: await createUser(testDb, tenant, { email: 'a@example.com' }),
      techB: await createUser(testDb, tenant, { email: 'b@example.com' }),
      member1: await createUser(testDb, tenant, { email: 'm1@example.com' }),
      member2: await createUser(testDb, tenant, { email: 'm2@example.com' }),
      gone: await createUser(testDb, tenant, { email: 'gone@example.com', is_inactive: true }),
      dispatcher: await createUser(testDb, tenant, { email: 'dispatch@example.com' }),
      watcher: await createUser(testDb, tenant, { email: 'watcher@example.com' }),
    };
    ruleTeamId = uuidv4();
    defaultTeamId = uuidv4();
    await scoped.table('teams').insert([
      { tenant, team_id: ruleTeamId, team_name: 'Rule team', manager_id: users.techA },
      { tenant, team_id: defaultTeamId, team_name: 'Default team', manager_id: users.techA },
    ]);
    await scoped.table('team_members').insert([
      { tenant, team_id: ruleTeamId, user_id: users.member1 },
      { tenant, team_id: ruleTeamId, user_id: users.member2 },
      { tenant, team_id: ruleTeamId, user_id: users.gone },
      { tenant, team_id: defaultTeamId, user_id: users.dispatcher },
      { tenant, team_id: defaultTeamId, user_id: users.member1 },
    ]);

    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Helpdesk Queue', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: users.techA });

    const ruleId = uuidv4();
    await scoped.table('board_notification_rules').insert({ tenant, rule_id: ruleId, board_id: boardId, notify_on_create: true });
    await scoped.table('board_notification_rule_recipients').insert([
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techA },
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techB },
      { tenant, rule_id: ruleId, recipient_type: 'team', team_id: ruleTeamId },
    ]);
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
    deniedUserIds.clear();
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
      status_id: statusId,
      priority_id: priorityId,
      ticket_origin: 'inbound_email',
      entered_at: new Date(),
      ...extra,
    });
    return ticketId;
  }

  const event = (ticketId: string, extra: Record<string, unknown> = {}) => ({
    id: uuidv4(),
    eventType: 'TICKET_CREATED',
    timestamp: new Date().toISOString(),
    payload: { tenantId: tenant, ticketId, occurredAt: new Date().toISOString(), actorType: 'SYSTEM', ...extra },
  });

  // internal_notifications is cleared before each scenario, so a template filter is enough.
  async function inAppFor(_ticketId: string, template: string): Promise<string[]> {
    const rows = await scoped.table('internal_notifications').where({ template_name: template });
    return rows.map((row: any) => row.user_id as string);
  }

  async function clearInApp() {
    await scoped.table('internal_notifications').delete();
  }

  const emailsFor = (template: string) => sent.filter((email) => email.template === template).map((email) => email.to).sort();

  it('emails each listed tech and active team member exactly once, without assigning anyone or touching the watch list', async () => {
    const ticketId = await createTicketRow();
    await runWithTenant(tenant, () => emailHandler(event(ticketId)));

    expect(emailsFor('ticket-board-created')).toEqual(['a@example.com', 'b@example.com', 'm1@example.com', 'm2@example.com']);

    const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.assigned_to).toBeNull();
    expect(ticket.assigned_team_id).toBeNull();
    expect(ticket.attributes?.watch_list).toBeUndefined();
  });

  it('creates exactly one in-app notification per listed tech and active team member', async () => {
    await clearInApp();
    const ticketId = await createTicketRow();
    await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));

    const recipients = await inAppFor(ticketId, 'ticket-board-created');
    expect(recipients.sort()).toEqual([users.techA, users.techB, users.member1, users.member2].sort());
    const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.assigned_to).toBeNull();
    expect(ticket.assigned_team_id).toBeNull();
    expect(ticket.attributes?.watch_list).toBeUndefined();
  });

  it('a rule recipient who is the assignee only gets the standard ticket-created (both channels)', async () => {
    await clearInApp();
    const ticketId = await createTicketRow({ assigned_to: users.techA });
    await runWithTenant(tenant, () => emailHandler(event(ticketId)));
    await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));

    expect(emailsFor('ticket-created')).toEqual(['a@example.com']);
    expect(emailsFor('ticket-board-created')).toEqual(['b@example.com', 'm1@example.com', 'm2@example.com']);
    expect(await inAppFor(ticketId, 'ticket-created')).toEqual([users.techA]);
    expect((await inAppFor(ticketId, 'ticket-board-created')).sort()).toEqual([users.techB, users.member1, users.member2].sort());
  });

  it('board default team members already notified in-app are not notified twice; they still get the rule email', async () => {
    await scoped.table('boards').where({ board_id: boardId }).update({ default_assigned_team_id: defaultTeamId });
    try {
      await clearInApp();
      const ticketId = await createTicketRow();
      await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));
      await runWithTenant(tenant, () => emailHandler(event(ticketId)));

      expect((await inAppFor(ticketId, 'ticket-created')).sort()).toEqual([users.dispatcher, users.member1].sort());
      // member1 is in the default team and the rule team: standard in-app only.
      expect((await inAppFor(ticketId, 'ticket-board-created')).sort()).toEqual([users.techA, users.techB, users.member2].sort());
      // The email handler never emails a team, so member1 still receives the rule email once.
      expect(emailsFor('ticket-board-created')).toEqual(['a@example.com', 'b@example.com', 'm1@example.com', 'm2@example.com']);
    } finally {
      await scoped.table('boards').where({ board_id: boardId }).update({ default_assigned_team_id: null });
    }
  });

  it('an active internal watcher who is a rule recipient gets only the standard email (and still the in-app alert)', async () => {
    await clearInApp();
    const ruleId = (await scoped.table('board_notification_rules').where({ board_id: boardId }).first()).rule_id;
    await scoped.table('board_notification_rule_recipients').insert({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.watcher });
    try {
      const ticketId = await createTicketRow({
        attributes: JSON.stringify({ watch_list: [{ email: 'watcher@example.com', active: true }] }),
      });
      await runWithTenant(tenant, () => emailHandler(event(ticketId)));
      await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));

      expect(emailsFor('ticket-created')).toEqual(['watcher@example.com']);
      expect(emailsFor('ticket-board-created')).not.toContain('watcher@example.com');
      expect(sent.filter((email) => email.to === 'watcher@example.com')).toHaveLength(1);
      expect(await inAppFor(ticketId, 'ticket-board-created')).toContain(users.watcher);
    } finally {
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId, user_id: users.watcher }).delete();
    }
  });

  it('suppressInternalNotifications silences the rule on both channels', async () => {
    await clearInApp();
    const ticketId = await createTicketRow();
    await runWithTenant(tenant, () => emailHandler(event(ticketId, { suppressInternalNotifications: true })));
    await runWithTenant(tenant, () => inAppHandler(event(ticketId, { suppressInternalNotifications: true }), { propagateErrors: true }));

    expect(emailsFor('ticket-board-created')).toEqual([]);
    expect(await inAppFor(ticketId, 'ticket-board-created')).toEqual([]);
  });

  it('skips a recipient denied by the per-record authorization policy (EE board-scoped bundle)', async () => {
    await clearInApp();
    deniedUserIds.add(users.techB);
    const ticketId = await createTicketRow();
    await runWithTenant(tenant, () => emailHandler(event(ticketId)));
    await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));

    expect(emailsFor('ticket-board-created')).toEqual(['a@example.com', 'm1@example.com', 'm2@example.com']);
    expect((await inAppFor(ticketId, 'ticket-board-created')).sort()).toEqual([users.techA, users.member1, users.member2].sort());
  });

  it('does not fire for a ticket on a board without a create rule', async () => {
    await clearInApp();
    const otherBoard = uuidv4();
    const otherStatus = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: otherBoard, board_name: 'Other', is_default: false });
    await scoped.table('statuses').insert({ tenant, status_id: otherStatus, board_id: otherBoard, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    const ticketId = await createTicketRow({ board_id: otherBoard, status_id: otherStatus, assigned_to: users.assignee });
    await runWithTenant(tenant, () => emailHandler(event(ticketId)));
    await runWithTenant(tenant, () => inAppHandler(event(ticketId), { propagateErrors: true }));

    expect(emailsFor('ticket-board-created')).toEqual([]);
    expect(await inAppFor(ticketId, 'ticket-board-created')).toEqual([]);
    expect(emailsFor('ticket-created')).toEqual(['assignee@example.com']);
  });
});
