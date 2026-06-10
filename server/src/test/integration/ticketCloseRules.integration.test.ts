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

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import {
  evaluateTicketCloseRules,
  enforceTicketCloseRules,
  TicketCloseValidationError,
} from '../../../../packages/tickets/src/lib/validateTicketClosure';
import {
  getBoardCloseRules,
  upsertBoardCloseRules,
  createBoardAutoCloseRule,
  checkTicketClosure,
} from '../../../../packages/tickets/src/actions/close-rules/closeRuleActions';
import { updateTicketInTransaction } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { bulkUpdateTicketStatus, updateTicket } from '../../../../packages/tickets/src/actions/ticketActions';
import { auditCloseRulesBypassIfGated } from '@alga-psa/shared/lib/ticketCloseRules';
import { updateTicketStatus as portalUpdateTicketStatus } from '../../../../packages/client-portal/src/actions/client-portal-actions/client-tickets';
import {
  createCloseRulesFixture,
  insertTicket,
  insertChecklistItem,
  setBoardCloseRules,
  clearBoardCloseRules,
  insertTicketTimeEntry,
  insertResolutionComment,
  type CloseRulesFixture,
} from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;

function ticketShape(ticketId: string) {
  return {
    ticket_id: ticketId,
    board_id: fixture.boardId,
    category_id: null,
    subcategory_id: null,
    priority_id: fixture.priorityId,
    assigned_to: null,
  };
}

const userActor = () => ({ actorType: 'user' as const, userId: fixture.userId });

describe('ticket close rules', () => {
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
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();
    await clearBoardCloseRules(db, fixture);
  });

  // T001/T003 — schema artifacts exist after the migration chain ran in beforeAll
  it('T001: migration created the close-rules tables with their constraints', async () => {
    for (const table of [
      'board_close_rules',
      'ticket_checklist_items',
      'checklist_templates',
      'checklist_template_items',
      'checklist_template_apply_rules',
      'board_auto_close_rules',
      'ticket_auto_close_state',
    ]) {
      expect(await db.schema.hasTable(table), table).toBe(true);
    }

    const constraints = await db.raw(`
      SELECT conname FROM pg_constraint WHERE conname IN (
        'board_auto_close_rules_board_status_uq',
        'board_auto_close_rules_inactivity_check',
        'board_auto_close_rules_warning_check',
        'ticket_checklist_items_source_check',
        'ticket_checklist_items_ticket_fkey'
      )`);
    expect(constraints.rows.length).toBe(5);

    const item = await db('ticket_checklist_items').columnInfo();
    expect(item.is_required.defaultValue).toContain('true');
    expect(item.completed.defaultValue).toContain('false');
    expect(item.source.defaultValue).toContain('manual');
  });

  it('T002: close_override permission exists and is granted to Admin', async () => {
    const permission = await db('permissions')
      .where({ tenant: fixture.tenantId, resource: 'ticket', action: 'close_override' })
      .first();
    expect(permission).toBeTruthy();
    expect(permission.msp).toBe(true);
    expect(permission.client).toBe(false);

    const adminGrant = await db('role_permissions as rp')
      .join('roles as r', function joinRoles() {
        this.on('r.role_id', 'rp.role_id').andOn('r.tenant', 'rp.tenant');
      })
      .where({ 'rp.tenant': fixture.tenantId, 'rp.permission_id': permission.permission_id })
      .whereRaw("lower(r.role_name) = 'admin'")
      .first();
    expect(adminGrant).toBeTruthy();
  });

  it('T003: auto-close warning subtype and template are seeded and aligned', async () => {
    const subtype = await db('notification_subtypes')
      .where({ name: 'Ticket Auto-Close Warning' })
      .first();
    expect(subtype).toBeTruthy();

    const templates = await db('system_email_templates')
      .where({ name: 'ticket-auto-close-warning' })
      .select('notification_subtype_id');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t: any) => t.notification_subtype_id === subtype.id)).toBe(true);
  });

  it('T004: board close rules round-trip with defaults and field validation', async () => {
    const defaults = await getBoardCloseRules(fixture.boardId);
    expect(defaults.require_time_entry).toBe(false);
    expect(defaults.required_fields).toEqual([]);

    const saved = await upsertBoardCloseRules(fixture.boardId, {
      require_time_entry: true,
      required_fields: ['category_id', 'assigned_to'],
    });
    expect(saved.require_time_entry).toBe(true);
    expect(saved.required_fields.sort()).toEqual(['assigned_to', 'category_id']);

    const reloaded = await getBoardCloseRules(fixture.boardId);
    expect(reloaded.require_time_entry).toBe(true);

    await expect(
      upsertBoardCloseRules(fixture.boardId, { required_fields: ['nonsense_field'] })
    ).rejects.toThrow(/Invalid required fields/);
  });

  it('T005: auto-close rule validation rejects bad configurations', async () => {
    await expect(
      createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId,
        inactivity_days: 7,
        close_to_status_id: fixture.openStatusId, // not a closed status
      })
    ).rejects.toThrow(/closed status/);

    await expect(
      createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.closedStatusId, // closed trigger
        inactivity_days: 7,
        close_to_status_id: fixture.closedStatusId,
      })
    ).rejects.toThrow(/open status/);

    await expect(
      createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId,
        inactivity_days: 5,
        warning_days_before: 5, // must be < inactivity
        close_to_status_id: fixture.closedStatusId,
      })
    ).rejects.toThrow(/Warning lead time/);

    const created = await createBoardAutoCloseRule(fixture.boardId, {
      trigger_status_id: fixture.waitingStatusId,
      inactivity_days: 5,
      warning_days_before: 2,
      close_to_status_id: fixture.closedStatusId,
    });
    expect(created.rule_id).toBeTruthy();

    await expect(
      createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId, // duplicate
        inactivity_days: 9,
        close_to_status_id: fixture.closedStatusId,
      })
    ).rejects.toThrow(/already exists/);

    await db('board_auto_close_rules').where({ tenant: fixture.tenantId, rule_id: created.rule_id }).del();
  });

  it('T006: no rules row or disabled rules allow closure', async () => {
    const ticketId = await insertTicket(db, fixture);

    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);

    await setBoardCloseRules(db, fixture, { require_time_entry: true, is_enabled: false });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);
  });

  it('T007: resolution-comment gate accepts either resolution marker', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_resolution_comment: true });

    let failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule)).toEqual(['resolution_comment']);

    // Comment on a DIFFERENT ticket doesn't count
    const otherTicketId = await insertTicket(db, fixture);
    await insertResolutionComment(db, fixture, otherTicketId, { note: 'resolved elsewhere' });
    failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.length).toBe(1);

    // is_resolution marker passes
    const commentId = await insertResolutionComment(db, fixture, ticketId, { note: 'resolved' });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);

    // metadata closes_ticket marker also passes
    await db('comments').where({ tenant: fixture.tenantId, comment_id: commentId }).update({ is_resolution: false, metadata: JSON.stringify({ closes_ticket: true }) });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);
  });

  it('T008: time-entry gate requires a ticket-linked time entry', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    let failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule)).toEqual(['time_entry']);

    // A non-ticket work item doesn't count
    await db('time_entries').insert({
      tenant: fixture.tenantId,
      entry_id: uuidv4(),
      work_item_id: ticketId,
      work_item_type: 'project_task',
      user_id: fixture.userId,
      start_time: db.fn.now(),
      end_time: db.fn.now(),
      work_date: db.fn.now(),
      work_timezone: 'UTC',
      billable_duration: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.length).toBe(1);

    await insertTicketTimeEntry(db, fixture, ticketId);
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);
  });

  it('T009: checklist gate counts only incomplete REQUIRED items', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_checklist_complete: true });

    // No checklist at all passes
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);

    const requiredItem = await insertChecklistItem(db, fixture, ticketId, { is_required: true });
    await insertChecklistItem(db, fixture, ticketId, { is_required: false });

    const failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule)).toEqual(['checklist_incomplete']);
    expect(failures[0].meta?.incomplete_count).toBe(1);

    // Completing the required item passes even though the optional one is open
    await db('ticket_checklist_items')
      .where({ tenant: fixture.tenantId, checklist_item_id: requiredItem })
      .update({ completed: true, completed_by: fixture.userId, completed_at: db.fn.now() });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);
  });

  it('T010: open-children gate blocks bundle masters with open children', async () => {
    const masterId = await insertTicket(db, fixture);
    const childId = await insertTicket(db, fixture, { master_ticket_id: masterId });
    await setBoardCloseRules(db, fixture, { require_no_open_children: true });

    const failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(masterId));
    expect(failures.map((f) => f.rule)).toEqual(['open_children']);

    // Non-master tickets pass
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(childId))).toEqual([]);

    await db('tickets')
      .where({ tenant: fixture.tenantId, ticket_id: childId })
      .update({ closed_at: db.fn.now(), is_closed: true });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(masterId))).toEqual([]);
  });

  it('T011: required-fields gate lists each missing configured field', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { required_fields: ['category_id', 'assigned_to'] });

    const failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule)).toEqual(['required_fields']);
    expect((failures[0].meta?.missing_fields as string[]).sort()).toEqual(['assigned_to', 'category_id']);

    const satisfied = await evaluateTicketCloseRules(db, fixture.tenantId, {
      ...ticketShape(ticketId),
      category_id: uuidv4(),
      assigned_to: fixture.userId,
    });
    expect(satisfied).toEqual([]);
  });

  it('T012: multiple failing gates report one failure per gate', async () => {
    const ticketId = await insertTicket(db, fixture);
    await insertChecklistItem(db, fixture, ticketId);
    await setBoardCloseRules(db, fixture, {
      require_resolution_comment: true,
      require_time_entry: true,
      require_checklist_complete: true,
      required_fields: ['assigned_to'],
    });

    const failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule).sort()).toEqual([
      'checklist_incomplete',
      'required_fields',
      'resolution_comment',
      'time_entry',
    ]);
  });

  it('T013: override is honored only with the close_override permission and is audited', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    // Without permission the override request is refused
    hasPermissionMock.mockResolvedValue(false);
    await expect(
      db.transaction((trx) =>
        enforceTicketCloseRules(trx, fixture.tenantId, {
          ticket: ticketShape(ticketId),
          override: { requested: true, reason: 'spam ticket', user: userRef.user },
          actor: userActor(),
          source: 'ui',
        })
      )
    ).rejects.toThrow(TicketCloseValidationError);

    // With permission the override succeeds and writes the audit row
    hasPermissionMock.mockResolvedValue(true);
    const result = await db.transaction((trx) =>
      enforceTicketCloseRules(trx, fixture.tenantId, {
        ticket: ticketShape(ticketId),
        override: { requested: true, reason: 'spam ticket', user: userRef.user },
        actor: userActor(),
        source: 'ui',
      })
    );
    expect(result.overridden).toBe(true);

    const audit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_OVERRIDDEN' })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.details.reason).toBe('spam ticket');
    expect(audit.details.failures.map((f: any) => f.rule)).toEqual(['time_entry']);
  });

  it('T014: bypass skips evaluation and is audited only on gated boards', async () => {
    const ticketId = await insertTicket(db, fixture);

    // Ungated board: no audit noise
    let result = await db.transaction((trx) =>
      auditCloseRulesBypassIfGated(trx, fixture.tenantId, ticketId, fixture.boardId, 'workflow', userActor(), 'workflow')
    );
    expect(result).toBe(false);

    await setBoardCloseRules(db, fixture, { require_time_entry: true });
    result = await db.transaction((trx) =>
      auditCloseRulesBypassIfGated(trx, fixture.tenantId, ticketId, fixture.boardId, 'workflow', userActor(), 'workflow')
    );
    expect(result).toBe(true);

    const audits = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
      .select('details');
    expect(audits.length).toBe(1);
    expect(audits[0].details.bypass_source).toBe('workflow');
  });

  it('T015: updateTicket blocks a gated close and honors the override option', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    await expect(
      updateTicket(ticketId, { status_id: fixture.closedStatusId })
    ).rejects.toThrow(/cannot be closed/i);

    let ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.status_id).toBe(fixture.openStatusId);
    expect(ticket.is_closed).toBe(false);

    // Same action with the override option (permission mocked as granted)
    await updateTicket(ticketId, { status_id: fixture.closedStatusId }, {
      overrideCloseRules: true,
      overrideCloseRulesReason: 'duplicate ticket',
    });
    ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);

    const overrideAudit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_OVERRIDDEN' })
      .first();
    expect(overrideAudit.details.reason).toBe('duplicate ticket');
  });

  it('T017: blocked close aborts the transaction with no closure writes or events', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    await expect(
      db.transaction((trx) =>
        updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
          status_id: fixture.closedStatusId,
        })
      )
    ).rejects.toThrow(TicketCloseValidationError);

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.status_id).toBe(fixture.openStatusId);
    expect(ticket.is_closed).toBe(false);
    expect(ticket.closed_at).toBeNull();
    expect(ticket.closed_by).toBeNull();

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents.length).toBe(0);
  });

  it('T016: close succeeds once gates pass — closure fields, event, audit row', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });
    await insertTicketTimeEntry(db, fixture, ticketId);

    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.closedStatusId,
      })
    );

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);
    expect(ticket.closed_at).not.toBeNull();
    expect(ticket.closed_by).toBe(fixture.userId);

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents.length).toBe(1);

    const audit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSED' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('T018: bulk close reports per-ticket close-rule failures without aborting the batch', async () => {
    const passingId = await insertTicket(db, fixture);
    const failingId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });
    await insertTicketTimeEntry(db, fixture, passingId);

    const result = await bulkUpdateTicketStatus([passingId, failingId], fixture.closedStatusId);

    expect(result.updatedIds).toEqual([passingId]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].ticketId).toBe(failingId);
    expect(result.failed[0].closeRuleFailures?.map((f) => f.rule)).toEqual(['time_entry']);

    const failing = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: failingId }).first();
    expect(failing.is_closed).toBe(false);
  });

  it('T019: checkTicketClosure returns structured failures and override capability', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    hasPermissionMock.mockResolvedValue(true);
    let check = await checkTicketClosure(ticketId, fixture.closedStatusId);
    expect(check.wouldClose).toBe(true);
    expect(check.allowed).toBe(false);
    expect(check.failures.map((f) => f.rule)).toEqual(['time_entry']);
    expect(check.canOverride).toBe(true);

    hasPermissionMock.mockResolvedValue(false);
    check = await checkTicketClosure(ticketId, fixture.closedStatusId);
    expect(check.canOverride).toBe(false);

    // A non-closing status change is always allowed
    check = await checkTicketClosure(ticketId, fixture.waitingStatusId);
    expect(check.wouldClose).toBe(false);
    expect(check.allowed).toBe(true);
  });

  it('T020: exempt sources bypass with an audited trail through the shared helper', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    const result = await db.transaction((trx) =>
      enforceTicketCloseRules(trx, fixture.tenantId, {
        ticket: ticketShape(ticketId),
        bypass: { source: 'import' },
        actor: userActor(),
        source: 'ui',
      })
    );
    expect(result.bypassed).toBe(true);

    const audit = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
      .first();
    expect(audit.details.bypass_source).toBe('import');
  });

  it('T021: portal status changes apply full closure semantics without gate blocks', async () => {
    const ticketId = await insertTicket(db, fixture);
    // Gates the customer cannot satisfy must NOT block the portal path.
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    const portalUserId = uuidv4();
    await db('users').insert({
      tenant: fixture.tenantId,
      user_id: portalUserId,
      username: `portal-${portalUserId.slice(0, 8)}`,
      hashed_password: 'not-used',
      first_name: 'Portal',
      last_name: 'Customer',
      email: `portal-${portalUserId.slice(0, 8)}@example.com`,
      user_type: 'client',
      contact_id: fixture.contactId,
      created_at: db.fn.now(),
    });

    const mspUser = userRef.user;
    userRef.user = {
      user_id: portalUserId,
      user_type: 'client',
      email: `portal-${portalUserId.slice(0, 8)}@example.com`,
    };
    try {
      await portalUpdateTicketStatus(ticketId, fixture.closedStatusId);

      const closed = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
      expect(closed.is_closed).toBe(true);
      expect(closed.closed_at).not.toBeNull();
      expect(closed.closed_by).toBe(portalUserId);

      const closedEvents = publishWorkflowEventMock.mock.calls.filter(
        ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
      );
      expect(closedEvents.length).toBe(1);

      const bypassAudit = await db('ticket_audit_logs')
        .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
        .first();
      expect(bypassAudit.details.bypass_source).toBe('client_portal');

      const closedActivity = await db('ticket_audit_logs')
        .where({ tenant: fixture.tenantId, ticket_id: ticketId, event_type: 'TICKET_CLOSED' })
        .first();
      expect(closedActivity.source).toBe('client_portal');

      // Reopening from the portal clears the closure fields and publishes TICKET_REOPENED
      await portalUpdateTicketStatus(ticketId, fixture.openStatusId);
      const reopened = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
      expect(reopened.is_closed).toBe(false);
      expect(reopened.closed_at).toBeNull();
      expect(reopened.closed_by).toBeNull();

      const reopenedEvents = publishWorkflowEventMock.mock.calls.filter(
        ([params]: any[]) => params.eventType === 'TICKET_REOPENED'
      );
      expect(reopenedEvents.length).toBe(1);
    } finally {
      userRef.user = mspUser;
    }
  });

  it('T046: closing on an ungated board behaves exactly as before', async () => {
    const ticketId = await insertTicket(db, fixture);

    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.closedStatusId,
      })
    );

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);
    expect(ticket.closed_by).toBe(fixture.userId);

    const ruleAudits = await db('ticket_audit_logs')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId })
      .whereIn('event_type', ['TICKET_CLOSE_RULES_BYPASSED', 'TICKET_CLOSE_RULES_OVERRIDDEN'])
      .select('audit_id');
    expect(ruleAudits.length).toBe(0);

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents.length).toBe(1);
  });

  it('T047: reopening clears closure fields and publishes TICKET_REOPENED', async () => {
    const ticketId = await insertTicket(db, fixture);

    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.closedStatusId,
      })
    );
    publishWorkflowEventMock.mockClear();

    await db.transaction((trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.openStatusId,
      })
    );

    const ticket = await db('tickets').where({ tenant: fixture.tenantId, ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(false);
    expect(ticket.closed_at).toBeNull();
    expect(ticket.closed_by).toBeNull();

    const reopenedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_REOPENED'
    );
    expect(reopenedEvents.length).toBeGreaterThanOrEqual(1);
  });
});
