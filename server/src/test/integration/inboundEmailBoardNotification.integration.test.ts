import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Board notification rules, end to end through the durable inbound email path:
 *   processInboundEmailInApp (durableExecution + InboundEmailOutboxEventPublisher)
 *   -> inbound_email_outbox row -> processInboundOutboxJob / processInboundOutboxRepublishJob
 *   -> publishEvent (captured) -> the real handleTicketCreated handlers (email + in-app)
 *   -> consumer delivery ledger (inbound_email_event_deliveries) dedupes redelivery.
 */
const sent: Array<{ to: string; template: string }> = [];
let testDb: Knex;

// Events handed to the event bus by the outbox dispatcher; the test delivers them to the handlers.
const published: Array<{ id: string; eventType: string; payload: Record<string, any>; force: boolean }> = [];

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));

vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!testDb) throw new Error('Test DB not initialized');
    return testDb;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

vi.mock('../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: { to: string; template: string }) => {
    sent.push({ to: params.to, template: params.template });
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async (event: { eventType: string; payload: Record<string, any> }, options?: { eventId?: string; force?: boolean }) => {
    published.push({ id: options?.eventId ?? uuidv4(), eventType: event.eventType, payload: event.payload, force: Boolean(options?.force) });
  }),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => null),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async () => null,
  })),
}));

vi.mock('@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider', () => ({
  resolveInboundReplyAcknowledgementDecider: vi.fn(async () => ({
    decide: async () => ({ decision: 'NOT_ACK', source: 'default', attempted: false, reason: 'test', model: null, rawOutput: null, error: null }),
  })),
}));

// Visibility filter dependencies for the rule recipients.
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
  authorizeTicketRecordAccess: vi.fn(async () => ({})),
}));

describe('board notification rules: inbound email durable path (integration)', () => {
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let providerId: string;
  let users: Record<string, string>;
  let ruleTeamId: string;
  let emailHandler: (event: any) => Promise<void>;
  let inAppHandler: (event: any) => Promise<void>;

  const RULE_TEMPLATE = 'ticket-board-created';
  const mailbox = 'support@board-notif.example.com';

  beforeAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketEvent: emailHandler } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
    ({ internalNotificationSubscriberTestHarness: { handleInternalNotificationEvent: inAppHandler } } = await import(
      '../../lib/eventBus/subscribers/internalNotificationSubscriber'
    ));

    tenant = await createTenant(testDb, `InboundBoardRule ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    users = {
      techA: await createUser(testDb, tenant, { email: 'a@board-notif.example.com' }),
      techB: await createUser(testDb, tenant, { email: 'b@board-notif.example.com' }),
      member1: await createUser(testDb, tenant, { email: 'm1@board-notif.example.com' }),
      member2: await createUser(testDb, tenant, { email: 'm2@board-notif.example.com' }),
    };
    ruleTeamId = uuidv4();
    await scoped.table('teams').insert({ tenant, team_id: ruleTeamId, team_name: 'Rule team', manager_id: users.techA });
    await scoped.table('team_members').insert([
      { tenant, team_id: ruleTeamId, user_id: users.member1 },
      { tenant, team_id: ruleTeamId, user_id: users.member2 },
    ]);

    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Inbound Queue', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: users.techA });

    const ruleId = uuidv4();
    await scoped.table('board_notification_rules').insert({ tenant, rule_id: ruleId, board_id: boardId, notify_on_create: true });
    await scoped.table('board_notification_rule_recipients').insert([
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techA },
      { tenant, rule_id: ruleId, recipient_type: 'user', user_id: users.techB },
      { tenant, rule_id: ruleId, recipient_type: 'team', team_id: ruleTeamId },
    ]);

    const defaultsId = uuidv4();
    providerId = uuidv4();
    await scoped.table('inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant,
      short_name: `bn-${defaultsId.slice(0, 6)}`,
      display_name: `Board Notif Defaults ${defaultsId.slice(0, 6)}`,
      description: 'Test defaults',
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      client_id: clientId,
      entered_by: users.techA,
      is_active: true,
      is_default: false,
      created_at: testDb.fn.now(),
      updated_at: testDb.fn.now(),
    });
    await scoped.table('email_providers').insert({
      id: providerId,
      tenant,
      provider_type: 'google',
      provider_name: 'Board Notif Provider',
      mailbox,
      is_active: true,
      status: 'connected',
      inbound_ticket_defaults_id: defaultsId,
      created_at: testDb.fn.now(),
      updated_at: testDb.fn.now(),
    });
  }, 900_000);

  afterAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'off';
    await testDb?.destroy();
  });

  beforeEach(async () => {
    sent.length = 0;
    published.length = 0;
    await scoped.table('internal_notifications').delete();
  });

  function buildEmail(messageId: string, subject: string) {
    return {
      id: messageId,
      provider: 'google',
      providerId,
      tenant,
      receivedAt: new Date().toISOString(),
      from: { email: 'customer@acme-customer.example.com', name: 'Customer' },
      to: [{ email: mailbox, name: 'Support' }],
      subject,
      body: { text: 'My printer is on fire' },
      attachments: [],
    } as any;
  }

  /** The durable commit phase: processInboundEmailInApp inside one transaction with outbox publishers. */
  async function processDurably(emailData: any): Promise<{ inboxId: string; result: any }> {
    const { processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp');
    const { InboundEmailOutboxEventPublisher } = await import('@alga-psa/shared/workflow/adapters/inboundEmailOutboxEventPublisher');
    const inboxId = uuidv4();
    const result = await testDb.transaction(async (trx) => {
      await tenantDb(trx, tenant).table('inbound_email_inbox').insert({
        tenant,
        inbox_id: inboxId,
        provider_id: providerId,
        provider_type: 'google',
        normalized_message_id: `rfc822:${emailData.id}`,
        envelope: JSON.stringify({}),
        legacy_imported: true,
        status: 'skipped',
        outcome_kind: 'skipped',
        outcome_reason: 'test harness row; outbox events are dispatched manually',
        completed_at: testDb.fn.now(),
        created_at: testDb.fn.now(),
        updated_at: testDb.fn.now(),
      });
      const ticketPublisher = new InboundEmailOutboxEventPublisher({ trx, tenantId: tenant, inboxId, suppressCommentEmail: false });
      const commentPublisher = new InboundEmailOutboxEventPublisher({ trx, tenantId: tenant, inboxId, suppressCommentEmail: true });
      return processInboundEmailInApp(
        { tenantId: tenant, providerId, emailData },
        {
          collectDiagnostics: true,
          durableExecution: {
            mode: 'enforce',
            trx,
            inboxId,
            eventPublishers: { ticket: ticketPublisher, comment: commentPublisher, contact: ticketPublisher },
          },
        }
      );
    });
    return { inboxId, result };
  }

  const job = (outboxId: string) => ({ jobId: uuidv4(), tenantId: tenant, recordId: outboxId }) as any;
  const jobCtx = {} as any;

  async function dispatchOutbox(inboxId: string): Promise<void> {
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const rows = await scoped.table('inbound_email_outbox').where({ inbox_id: inboxId }).orderBy('created_at', 'asc');
    for (const row of rows) {
      const disposition = await processInboundOutboxJob(job(row.outbox_id), jobCtx);
      expect(disposition.disposition).toBe('ack');
    }
  }

  async function republishOutbox(inboxId: string): Promise<void> {
    const { processInboundOutboxRepublishJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const rows = await scoped.table('inbound_email_outbox').where({ inbox_id: inboxId });
    for (const row of rows) {
      const disposition = await processInboundOutboxRepublishJob(job(row.outbox_id), jobCtx);
      expect(disposition.disposition).toBe('ack');
    }
  }

  /** Stand-in for the event bus: hand every captured TICKET_CREATED to both real subscriber entry points. */
  async function deliverPublishedTicketCreated(): Promise<number> {
    const batch = published.splice(0);
    let delivered = 0;
    for (const evt of batch) {
      if (evt.eventType !== 'TICKET_CREATED') continue;
      delivered += 1;
      const event = { id: evt.id, eventType: evt.eventType, timestamp: new Date().toISOString(), payload: evt.payload };
      await runWithTenant(tenant, () => emailHandler(event));
      await runWithTenant(tenant, () => inAppHandler(event));
    }
    return delivered;
  }

  const ruleEmails = () => sent.filter((email) => email.template === RULE_TEMPLATE).map((email) => email.to).sort();
  async function ruleInApp(): Promise<string[]> {
    const rows = await scoped.table('internal_notifications').where({ template_name: RULE_TEMPLATE });
    return rows.map((row: any) => row.user_id as string).sort();
  }

  const expectedEmails = [
    'a@board-notif.example.com',
    'b@board-notif.example.com',
    'm1@board-notif.example.com',
    'm2@board-notif.example.com',
  ];

  it('new email ticket: exactly one email and one in-app notification per rule recipient; no assignment or watch-list change; redelivery does not duplicate', async () => {
    const messageId = `board-rule-${uuidv4()}@acme-customer.example.com`;
    const { inboxId, result } = await processDurably(buildEmail(messageId, `Printer fire ${uuidv4().slice(0, 6)}`));
    expect(result.outcome).toBe('created');

    const outbox = await scoped.table('inbound_email_outbox').where({ inbox_id: inboxId, event_type: 'TICKET_CREATED' });
    expect(outbox).toHaveLength(1);

    await dispatchOutbox(inboxId);
    expect(await deliverPublishedTicketCreated()).toBe(1);

    expect(ruleEmails()).toEqual(expectedEmails);
    expect(await ruleInApp()).toEqual([users.techA, users.techB, users.member1, users.member2].sort());

    const ticket = await scoped.table('tickets').where({ ticket_id: result.ticketId }).first();
    expect(ticket.board_id).toBe(boardId);
    expect(ticket.assigned_to).toBeNull();
    expect(ticket.assigned_team_id ?? null).toBeNull();
    const watchEmails = ((ticket.attributes?.watch_list ?? []) as Array<{ email?: string }>).map((entry) => entry.email);
    for (const email of expectedEmails) expect(watchEmails).not.toContain(email);

    // Plain redelivery of the already published event (same id) is also a no-op.
    // (The consumer ledger, not the event bus processed-set, is the guard here.)
    const [original] = await scoped.table('inbound_email_outbox').where({ inbox_id: inboxId, event_type: 'TICKET_CREATED' });
    const redelivered = { id: original.outbox_id, eventType: 'TICKET_CREATED', timestamp: new Date().toISOString(), payload: original.payload };
    await runWithTenant(tenant, () => emailHandler(redelivered));
    await runWithTenant(tenant, () => inAppHandler(redelivered));
    expect(ruleEmails()).toEqual(expectedEmails);
    expect(await ruleInApp()).toHaveLength(4);
  }, 120_000);

  it('re-publishing the same inbound email (force) produces no duplicate emails or notifications', async () => {
    const messageId = `board-rule-force-${uuidv4()}@acme-customer.example.com`;
    const { inboxId, result } = await processDurably(buildEmail(messageId, `Forced republish ${uuidv4().slice(0, 6)}`));
    expect(result.outcome).toBe('created');

    await dispatchOutbox(inboxId);
    expect(await deliverPublishedTicketCreated()).toBe(1);
    expect(ruleEmails()).toEqual(expectedEmails);
    expect(await ruleInApp()).toHaveLength(4);

    // Recovery sweeper path: same outbox_id, force=true, twice.
    for (let i = 0; i < 2; i += 1) {
      await republishOutbox(inboxId);
      expect(published.every((evt) => evt.force)).toBe(true);
      expect(await deliverPublishedTicketCreated()).toBe(1);
    }

    expect(ruleEmails()).toEqual(expectedEmails);
    expect(await ruleInApp()).toEqual([users.techA, users.techB, users.member1, users.member2].sort());
    const ticketRows = await scoped.table('tickets').where({ ticket_id: result.ticketId });
    expect(ticketRows).toHaveLength(1);
  }, 120_000);

  // TODO(board-notification-rules): enable once the TICKET_STATUS_CHANGED handlers (status-entered
  // trigger, plan §5.5/§7) are implemented. Scenario: a rule with status "Open" as trigger; an
  // email ticket exists in a closed status; a customer reply reopens it (reply-reopen moves the
  // ticket to the board's open status and the lifecycle helper publishes TICKET_STATUS_CHANGED
  // through the inbound outbox). Dispatch + force-republish the outbox, deliver to both
  // TICKET_STATUS_CHANGED handlers, and assert each rule recipient gets exactly one email and one
  // in-app notification (template for status-entered), with assigned_to unchanged and the watch
  // list untouched.
  it.skip('reply-reopen firing a status-entered rule notifies each recipient exactly once (needs TICKET_STATUS_CHANGED handlers)', async () => {
    // Intentionally empty until the handlers exist.
  });
});
