import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const sendNotificationMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

// The job handler resolves its connection through the server-local db module.
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('@alga-psa/notifications', () => ({
  getEmailNotificationService: () => ({ sendNotification: sendNotificationMock }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import { autoCloseTicketsHandler } from '@alga-psa/jobs/handlers/autoCloseTicketsHandler';
import {
  createCloseRulesFixture,
  createSecondaryTenant,
  insertTicket,
  setBoardCloseRules,
  type CloseRulesFixture,
} from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Knex;
let fixture: CloseRulesFixture;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

async function insertAutoCloseRule(
  targetFixture: CloseRulesFixture,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  const ruleId = uuidv4();
  await db('board_auto_close_rules').insert({
    tenant: targetFixture.tenantId,
    rule_id: ruleId,
    board_id: targetFixture.boardId,
    trigger_status_id: targetFixture.waitingStatusId,
    inactivity_days: 5,
    warning_days_before: null,
    close_to_status_id: targetFixture.closedStatusId,
    is_enabled: true,
    ...overrides,
  });
  return ruleId;
}

async function insertStaleTicket(
  targetFixture: CloseRulesFixture,
  idleDays: number,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  return insertTicket(db, targetFixture, {
    status_id: targetFixture.waitingStatusId,
    entered_at: daysAgo(idleDays),
    updated_at: daysAgo(idleDays),
    ...overrides,
  });
}

function getState(targetFixture: CloseRulesFixture, ticketId: string) {
  return db('ticket_auto_close_state')
    .where({ tenant: targetFixture.tenantId, ticket_id: ticketId })
    .first();
}

describe('auto-close engine', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await db('users').where({ user_type: 'internal' }).first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };

    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    sendNotificationMock.mockClear();
    publishWorkflowEventMock.mockClear();
    // Each test installs its own rules/tickets on the shared board.
    await db('ticket_auto_close_state').where({ tenant: fixture.tenantId }).del();
    // Park tickets left in the trigger status by earlier tests (suite order is
    // shuffled) so each test's match set is exactly its own.
    await db('tickets')
      .where({ tenant: fixture.tenantId, board_id: fixture.boardId, status_id: fixture.waitingStatusId })
      .update({ status_id: fixture.openStatusId });
    await db('board_auto_close_rules').where({ tenant: fixture.tenantId, board_id: fixture.boardId }).del();
    await db('board_close_rules').where({ tenant: fixture.tenantId, board_id: fixture.boardId }).del();
  });

  it('T030: the scan tracks, recomputes, and clears pending closes from current state', async () => {
    const ruleId = await insertAutoCloseRule(fixture);
    const ticketId = await insertStaleTicket(fixture, 3); // idle 3d of 5d

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    let state = await getState(fixture, ticketId);
    expect(state).toBeTruthy();
    expect(state.rule_id).toBe(ruleId);
    const initialScheduled = new Date(state.scheduled_close_at).getTime();
    expect(initialScheduled).toBeGreaterThan(Date.now());
    expect(initialScheduled).toBeLessThan(Date.now() + 3 * DAY_MS);

    // New activity (a fresh audit row) pushes the schedule back
    await db('ticket_audit_logs').insert({
      tenant: fixture.tenantId,
      ticket_id: ticketId,
      event_type: 'TICKET_COMMENT_ADDED',
      entity_type: 'comment',
      actor_type: 'contact',
      source: 'client_portal',
      occurred_at: db.fn.now(),
      changes: '{}',
      details: '{}',
    });
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    state = await getState(fixture, ticketId);
    expect(new Date(state.scheduled_close_at).getTime()).toBeGreaterThan(initialScheduled);

    // Moving out of the trigger status clears the pending close
    await db('tickets')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId })
      .update({ status_id: fixture.openStatusId });
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    expect(await getState(fixture, ticketId)).toBeUndefined();

    // Back in the trigger status but with the rule disabled: still clear
    await db('tickets')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId })
      .update({ status_id: fixture.waitingStatusId });
    await db('board_auto_close_rules')
      .where({ tenant: fixture.tenantId, rule_id: ruleId })
      .update({ is_enabled: false });
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    expect(await getState(fixture, ticketId)).toBeUndefined();
  });

  it('T031: the warning sends once inside the window with audit and stamp', async () => {
    await insertAutoCloseRule(fixture, { warning_days_before: 2 });
    const warnTicket = await insertStaleTicket(fixture, 4); // closes in ~1d → inside 2d warning window
    const earlyTicket = await insertStaleTicket(fixture, 1); // closes in ~4d → outside window

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendNotificationMock.mock.calls[0][0];
    expect(sendArgs.templateName).toBe('ticket-auto-close-warning');
    expect(sendArgs.emailAddress).toContain('@example.com');
    expect(sendArgs.data.ticket.scheduledCloseDate).toBeTruthy();

    const warnState = await getState(fixture, warnTicket);
    expect(warnState.warning_sent_at).not.toBeNull();
    const earlyState = await getState(fixture, earlyTicket);
    expect(earlyState.warning_sent_at).toBeNull();

    const audit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: warnTicket, event_type: 'TICKET_AUTO_CLOSE_WARNING_SENT' })
      .first();
    expect(audit).toBeTruthy();

    // Second run: not resent
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('T031b: no warning configured means no send', async () => {
    await insertAutoCloseRule(fixture, { warning_days_before: null });
    await insertStaleTicket(fixture, 4);

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('T032+T034: a due ticket closes through the normal path with system attribution and gated bypass audit', async () => {
    await insertAutoCloseRule(fixture);
    // Board has gates the abandoned ticket can't satisfy — the engine bypasses them.
    await setBoardCloseRules(db, fixture, { require_time_entry: true });
    const ticketId = await insertStaleTicket(fixture, 10); // due

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.status_id).toBe(fixture.closedStatusId);
    expect(ticket.is_closed).toBe(true);
    expect(ticket.closed_at).not.toBeNull();
    expect(ticket.closed_by).toBeNull();

    // TicketModel maps the system author onto the 'internal' enum value; the
    // auto-close provenance lives in the comment metadata.
    const comment = await db('comments')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId })
      .whereRaw("metadata->>'source' = 'auto_close'")
      .first();
    expect(comment).toBeTruthy();
    expect(comment.note).toContain('Closed automatically after 5 days of inactivity');
    expect(comment.metadata.closes_ticket).toBe(true);

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents.length).toBe(1);
    expect(closedEvents[0][0].ctx.actor.actorType).toBe('SYSTEM');
    expect(closedEvents[0][0].payload.closedByUserId).toBeUndefined();

    const bypassAudit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
      .first();
    expect(bypassAudit).toBeTruthy();
    expect(bypassAudit.details.bypass_source).toBe('auto_close');

    const closedAudit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSED' })
      .first();
    expect(closedAudit.actor_type).toBe('system');
    expect(closedAudit.source).toBe('system');

    expect(await getState(fixture, ticketId)).toBeUndefined();
  });

  it('T033: activity racing the scan prevents the close, and re-runs are idempotent', async () => {
    const ruleId = await insertAutoCloseRule(fixture);
    const ticketId = await insertStaleTicket(fixture, 1); // NOT actually due

    // Simulate a stale snapshot: a state row that claims the close is overdue
    // even though the ticket has fresh activity.
    await db('ticket_auto_close_state').insert({
      tenant: fixture.tenantId,
      ticket_id: ticketId,
      rule_id: ruleId,
      scheduled_close_at: daysAgo(1),
    });

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(false);
    const state = await getState(fixture, ticketId);
    expect(new Date(state.scheduled_close_at).getTime()).toBeGreaterThan(Date.now());

    // Idempotency after a real close: run the sweep twice, one close only.
    const dueTicket = await insertStaleTicket(fixture, 10);
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });
    const comments = await db('comments')
      .where({ tenant: fixture.tenantId, ticket_id: dueTicket })
      .whereRaw("metadata->>'source' = 'auto_close'")
      .select('comment_id');
    expect(comments.length).toBe(1);
  });

  it('T035: one failing ticket never stalls the sweep', async () => {
    // Board A: rule whose target status gets corrupted (no longer closed)
    const boardA = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    await insertAutoCloseRule(boardA);
    const failingTicket = await insertStaleTicket(boardA, 10);
    await db('statuses')
      .where({ tenant: boardA.tenantId, status_id: boardA.closedStatusId })
      .update({ is_closed: false });

    // Board B: healthy rule
    const boardB = await createCloseRulesFixture(db, fixture.tenantId, fixture.userId);
    await insertAutoCloseRule(boardB);
    const healthyTicket = await insertStaleTicket(boardB, 10);

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    const failing = await db('tickets').where({ tenant: boardA.tenantId, ticket_id: failingTicket }).first();
    expect(failing.is_closed).toBe(false);

    const healthy = await db('tickets').where({ tenant: boardB.tenantId, ticket_id: healthyTicket }).first();
    expect(healthy.is_closed).toBe(true);
  });

  it('T037: the scan is strictly tenant-scoped', async () => {
    const secondary = await createSecondaryTenant(db);
    const secondaryFixture = await createCloseRulesFixture(db, secondary.tenantId, secondary.userId);

    // Rule only in the PRIMARY tenant; stale tickets in both.
    await insertAutoCloseRule(fixture);
    const primaryTicket = await insertStaleTicket(fixture, 10);
    const secondaryTicket = await insertStaleTicket(secondaryFixture, 10);

    await autoCloseTicketsHandler({ tenantId: fixture.tenantId });

    const primary = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: primaryTicket }).first();
    expect(primary.is_closed).toBe(true);

    const other = await db('tickets').where({ tenant: secondary.tenantId, ticket_id: secondaryTicket }).first();
    expect(other.is_closed).toBe(false);
    expect(await db('ticket_auto_close_state').where({ tenant: secondary.tenantId }).first()).toBeUndefined();

    // Running for the secondary tenant (no rules) changes nothing.
    await autoCloseTicketsHandler({ tenantId: secondary.tenantId });
    const otherAfter = await db('tickets').where({ tenant: secondary.tenantId, ticket_id: secondaryTicket }).first();
    expect(otherAfter.is_closed).toBe(false);
  });
});
