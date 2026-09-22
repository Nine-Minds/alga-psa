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
const publishWorkflowEventMock = vi.hoisted(() =>
  vi.fn<typeof import('server/src/lib/eventBus/publishers').publishWorkflowEvent>(async () => undefined)
);

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

// BaseService (the TicketService base) imports createTenantKnex from the
// internal tenant module, not the @alga-psa/db barrel, so the barrel mock
// above never intercepts it. Mock the same resolved module to point the
// service at the suite's tenant/db handle while keeping real withTransaction.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
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

// TicketService uses the server-local publisher. Capture delivery at that
// boundary so the service still exercises its workflow-event behavior.
vi.mock('server/src/lib/eventBus/publishers', () => ({
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
import { TicketService } from '../../lib/api/services/TicketService';
// Real withTransaction (the @alga-psa/db mock spreads the original): it flushes
// the after-commit hooks that defer TICKET_CLOSED/live-update publishing, so the
// close path must run through it — exactly as the production callers do — for the
// event mocks to observe the publishes.
import { tenantDb, withTransaction } from '@alga-psa/db';
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
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;

function isReturnedActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function expectActionSuccess<T>(result: T | ActionMessageError | ActionPermissionError): T {
  if (isReturnedActionError(result)) {
    throw new Error(getErrorMessage(result));
  }
  return result;
}

function scopedDb() {
  return tenantDb(db, fixture.tenantId);
}

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

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for close rules integration')
      .where({ user_type: 'internal' })
      .first();
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

    const item = await tenantDb(db, '__test_discovery__')
      .unscoped('ticket_checklist_items', 'columnInfo reads schema metadata, not tenant rows')
      .columnInfo();
    expect(item.is_required.defaultValue).toContain('true');
    expect(item.completed.defaultValue).toContain('false');
    expect(item.source.defaultValue).toContain('manual');
  });

  it('T002: close_override permission exists and is granted to Admin', async () => {
    const db = scopedDb();
    const permission = await db.table('permissions')
      .where({ resource: 'ticket', action: 'close_override' })
      .first();
    expect(permission).toBeTruthy();
    expect(permission.msp).toBe(true);
    expect(permission.client).toBe(false);

    const adminGrantQuery = db.table('role_permissions as rp');
    db.tenantJoin(adminGrantQuery, 'roles as r', 'rp.role_id', 'r.role_id');
    const adminGrant = await adminGrantQuery
      .where({ 'rp.permission_id': permission.permission_id })
      .whereRaw("lower(r.role_name) = 'admin'")
      .first();
    expect(adminGrant).toBeTruthy();
  });

  it('T003: auto-close warning subtype and template are seeded and aligned', async () => {
    const subtype = await tenantDb(db, '__test_discovery__')
      .unscoped('notification_subtypes', 'global notification subtype catalog seed assertion')
      .where({ name: 'Ticket Auto-Close Warning' })
      .first();
    expect(subtype).toBeTruthy();

    const templates = await tenantDb(db, '__test_discovery__')
      .unscoped('system_email_templates', 'global system email template catalog seed assertion')
      .where({ name: 'ticket-auto-close-warning' })
      .select('notification_subtype_id');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t: any) => t.notification_subtype_id === subtype.id)).toBe(true);
  });

  it('T004: board close rules round-trip with defaults and field validation', async () => {
    const defaults = await getBoardCloseRules(fixture.boardId);
    expect(defaults.require_time_entry).toBe(false);
    expect(defaults.required_fields).toEqual([]);

    const saved = expectActionSuccess(await upsertBoardCloseRules(fixture.boardId, {
      require_time_entry: true,
      required_fields: ['category_id', 'assigned_to'],
    }));
    expect(saved.require_time_entry).toBe(true);
    expect(saved.required_fields.sort()).toEqual(['assigned_to', 'category_id']);

    const reloaded = await getBoardCloseRules(fixture.boardId);
    expect(reloaded.require_time_entry).toBe(true);

    expect(
      await upsertBoardCloseRules(fixture.boardId, { required_fields: ['nonsense_field'] })
    ).toMatchObject({ actionError: expect.stringMatching(/Invalid required fields/) });
  });

  it('T005: auto-close rule validation rejects bad configurations', async () => {
    expect(
      await createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId,
        inactivity_days: 7,
        close_to_status_id: fixture.openStatusId, // not a closed status
      })
    ).toMatchObject({ actionError: expect.stringMatching(/closed status/) });

    expect(
      await createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.closedStatusId, // closed trigger
        inactivity_days: 7,
        close_to_status_id: fixture.closedStatusId,
      })
    ).toMatchObject({ actionError: expect.stringMatching(/open status/) });

    expect(
      await createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId,
        inactivity_days: 5,
        warning_days_before: 5, // must be < inactivity
        close_to_status_id: fixture.closedStatusId,
      })
    ).toMatchObject({ actionError: expect.stringMatching(/Warning lead time/) });

    const created = expectActionSuccess(await createBoardAutoCloseRule(fixture.boardId, {
      trigger_status_id: fixture.waitingStatusId,
      inactivity_days: 5,
      warning_days_before: 2,
      close_to_status_id: fixture.closedStatusId,
    }));
    expect(created.rule_id).toBeTruthy();

    expect(
      await createBoardAutoCloseRule(fixture.boardId, {
        trigger_status_id: fixture.waitingStatusId, // duplicate
        inactivity_days: 9,
        close_to_status_id: fixture.closedStatusId,
      })
    ).toMatchObject({ actionError: expect.stringMatching(/already exists/) });

    await scopedDb().table('board_auto_close_rules').where({ rule_id: created.rule_id }).del();
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
    await scopedDb().table('comments').where({ comment_id: commentId }).update({ is_resolution: false, metadata: JSON.stringify({ closes_ticket: true }) });
    expect(await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId))).toEqual([]);
  });

  it('T008: time-entry gate requires a ticket-linked time entry', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    let failures = await evaluateTicketCloseRules(db, fixture.tenantId, ticketShape(ticketId));
    expect(failures.map((f) => f.rule)).toEqual(['time_entry']);

    // A non-ticket work item doesn't count
    await scopedDb().table('time_entries').insert({
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
    await scopedDb().table('ticket_checklist_items')
      .where({ checklist_item_id: requiredItem })
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

    await scopedDb().table('tickets')
      .where({ ticket_id: childId })
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

    const audit = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_OVERRIDDEN' })
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

    const audits = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
      .select('details');
    expect(audits.length).toBe(1);
    expect(audits[0].details.bypass_source).toBe('workflow');
  });

  it('T015: updateTicket blocks a gated close and honors the override option', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    const closeResult = await updateTicket(ticketId, { status_id: fixture.closedStatusId });
    expect(closeResult).toMatchObject({
      actionError: expect.stringContaining('Ticket cannot be closed'),
    });

    let ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.status_id).toBe(fixture.openStatusId);
    expect(ticket.is_closed).toBe(false);

    // Same action with the override option (permission mocked as granted)
    await updateTicket(ticketId, { status_id: fixture.closedStatusId }, {
      overrideCloseRules: true,
      overrideCloseRulesReason: 'duplicate ticket',
    });
    ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);

    const overrideAudit = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_OVERRIDDEN' })
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

    const ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
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

    await withTransaction(db, (trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.closedStatusId,
      })
    );

    const ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);
    expect(ticket.closed_at).not.toBeNull();
    expect(ticket.closed_by).toBe(fixture.userId);

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents.length).toBe(1);

    const audit = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSED' })
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

    const failing = await scopedDb().table('tickets').where({ ticket_id: failingId }).first();
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

    const audit = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
      .first();
    expect(audit.details.bypass_source).toBe('import');
  });

  it('T021: portal status changes apply full closure semantics without gate blocks', async () => {
    const ticketId = await insertTicket(db, fixture);
    // Gates the customer cannot satisfy must NOT block the portal path.
    await setBoardCloseRules(db, fixture, { require_time_entry: true });

    const portalUserId = uuidv4();
    await scopedDb().table('users').insert({
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

      const closed = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
      expect(closed.is_closed).toBe(true);
      expect(closed.closed_at).not.toBeNull();
      expect(closed.closed_by).toBe(portalUserId);

      const closedEvents = publishWorkflowEventMock.mock.calls.filter(
        ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
      );
      expect(closedEvents.length).toBe(1);

      const bypassAudit = await scopedDb().table('ticket_audit_logs')
        .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSE_RULES_BYPASSED' })
        .first();
      expect(bypassAudit.details.bypass_source).toBe('client_portal');

      const closedActivity = await scopedDb().table('ticket_audit_logs')
        .where({ ticket_id: ticketId, event_type: 'TICKET_CLOSED' })
        .first();
      expect(closedActivity.source).toBe('client_portal');

      // Reopening from the portal clears the closure fields and publishes TICKET_REOPENED
      await portalUpdateTicketStatus(ticketId, fixture.openStatusId);
      const reopened = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
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

    await withTransaction(db, (trx) =>
      updateTicketInTransaction(trx, userRef.user, fixture.tenantId, ticketId, {
        status_id: fixture.closedStatusId,
      })
    );

    const ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(true);
    expect(ticket.closed_by).toBe(fixture.userId);

    const ruleAudits = await scopedDb().table('ticket_audit_logs')
      .where({ ticket_id: ticketId })
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

    const ticket = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(ticket.is_closed).toBe(false);
    expect(ticket.closed_at).toBeNull();
    expect(ticket.closed_by).toBeNull();

    const reopenedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_REOPENED'
    );
    expect(reopenedEvents.length).toBeGreaterThanOrEqual(1);
  });

  // The REST API's TicketService.update returns the row produced by its write.
  // These assert on that returned value directly (not a re-read) because the
  // defect was a stale snapshot: is_closed/closed_at were denormalized by a
  // follow-up UPDATE after the returned row had already been captured.
  const serviceContext = () =>
    ({ tenant: fixture.tenantId, userId: fixture.userId, user: userRef.user }) as any;

  it('T048: TicketService.update returns final closure state on close', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    // Caller-supplied closure metadata must not win on a close-boundary
    // crossing: the derived actor/timestamp is what the pre-fix code wrote
    // last, and folding into the same UPDATE must preserve that precedence.
    const returned = await service.update(
      ticketId,
      {
        status_id: fixture.closedStatusId,
        closed_at: '2000-01-01T00:00:00.000Z',
        closed_by: uuidv4(),
      },
      serviceContext()
    );

    expect(returned.is_closed).toBe(true);
    expect(returned.closed_at).not.toBeNull();
    expect(new Date(returned.closed_at as unknown as string).toISOString()).not.toBe(
      '2000-01-01T00:00:00.000Z'
    );
    expect(returned.closed_by).toBe(fixture.userId);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.is_closed).toBe(true);
    expect(new Date(returned.closed_at as unknown as string).toISOString()).toBe(
      new Date(persisted.closed_at).toISOString()
    );
    expect(returned.closed_by).toBe(persisted.closed_by);

    const closedEvents = publishWorkflowEventMock.mock.calls.filter(
      ([params]: any[]) => params.eventType === 'TICKET_CLOSED'
    );
    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0][0]).toMatchObject({
      payload: {
        ticketId,
        closedByUserId: fixture.userId,
        closedAt: new Date(persisted.closed_at).toISOString(),
      },
      ctx: {
        tenantId: fixture.tenantId,
        actor: { actorType: 'USER', actorUserId: fixture.userId },
      },
    });
  });

  it('T049: TicketService.update returns cleared closure state on reopen', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    await service.update(ticketId, { status_id: fixture.closedStatusId }, serviceContext());
    const returned = await service.update(
      ticketId,
      { status_id: fixture.openStatusId },
      serviceContext()
    );

    expect(returned.is_closed).toBe(false);
    expect(returned.closed_at).toBeNull();
    expect(returned.closed_by).toBeNull();

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.is_closed).toBe(false);
    expect(persisted.closed_at).toBeNull();
    expect(persisted.closed_by).toBeNull();
  });

  it('T050: TicketService.update general-update path returns final closure state', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    const returned = await service.update(
      ticketId,
      { status_id: fixture.closedStatusId, title: 'Closed via general update' },
      serviceContext()
    );

    expect(returned.title).toBe('Closed via general update');
    expect(returned.is_closed).toBe(true);
    expect(returned.closed_at).not.toBeNull();
    expect(returned.closed_by).toBe(fixture.userId);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.is_closed).toBe(true);
    expect(new Date(returned.closed_at as unknown as string).toISOString()).toBe(
      new Date(persisted.closed_at).toISOString()
    );
    expect(returned.closed_by).toBe(persisted.closed_by);
  });

  async function insertStatus(overrides: Record<string, unknown>): Promise<string> {
    const statusId = uuidv4();
    await scopedDb().table('statuses').insert({
      tenant: fixture.tenantId,
      status_id: statusId,
      board_id: fixture.boardId,
      name: `Status ${statusId.slice(0, 6)}`,
      status_type: 'ticket',
      is_closed: false,
      is_default: false,
      order_number: 90,
      created_by: fixture.userId,
      ...overrides,
    });
    return statusId;
  }

  it('T051: moving between two closed statuses preserves closure metadata', async () => {
    const secondClosedStatusId = await insertStatus({
      name: 'Cancelled',
      is_closed: true,
      order_number: 40,
    });
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    const closed = await service.update(
      ticketId,
      { status_id: fixture.closedStatusId },
      serviceContext()
    );
    const moved = await service.update(
      ticketId,
      { status_id: secondClosedStatusId },
      serviceContext()
    );

    expect(moved.status_id).toBe(secondClosedStatusId);
    expect(moved.is_closed).toBe(true);
    expect(new Date(moved.closed_at as unknown as string).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(moved.closed_by).toBe(closed.closed_by);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.status_id).toBe(secondClosedStatusId);
    expect(persisted.is_closed).toBe(true);
    expect(new Date(persisted.closed_at).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(persisted.closed_by).toBe(closed.closed_by);
  });

  it('T052: repeating the same closed status preserves closure metadata', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    const closed = await service.update(
      ticketId,
      { status_id: fixture.closedStatusId },
      serviceContext()
    );
    const repeated = await service.update(
      ticketId,
      { status_id: fixture.closedStatusId },
      serviceContext()
    );

    expect(repeated.is_closed).toBe(true);
    expect(new Date(repeated.closed_at as unknown as string).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(repeated.closed_by).toBe(closed.closed_by);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.is_closed).toBe(true);
    expect(new Date(persisted.closed_at).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(persisted.closed_by).toBe(closed.closed_by);
  });

  it('T053: an update with no status_id preserves closure state and metadata', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    const closed = await service.update(
      ticketId,
      { status_id: fixture.closedStatusId },
      serviceContext()
    );
    const renamed = await service.update(ticketId, { title: 'Still closed' }, serviceContext());

    expect(renamed.title).toBe('Still closed');
    expect(renamed.is_closed).toBe(true);
    expect(new Date(renamed.closed_at as unknown as string).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(renamed.closed_by).toBe(closed.closed_by);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.title).toBe('Still closed');
    expect(persisted.is_closed).toBe(true);
    expect(new Date(persisted.closed_at).toISOString()).toBe(
      new Date(closed.closed_at as unknown as string).toISOString()
    );
    expect(persisted.closed_by).toBe(closed.closed_by);
  });

  it('T054: open-to-open status change keeps is_closed false and closure metadata null', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();

    const moved = await service.update(
      ticketId,
      { status_id: fixture.waitingStatusId },
      serviceContext()
    );

    expect(moved.status_id).toBe(fixture.waitingStatusId);
    expect(moved.is_closed).toBe(false);
    expect(moved.closed_at).toBeNull();
    expect(moved.closed_by).toBeNull();

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.status_id).toBe(fixture.waitingStatusId);
    expect(persisted.is_closed).toBe(false);
    expect(persisted.closed_at).toBeNull();
    expect(persisted.closed_by).toBeNull();
  });

  it('T055: a close-rule-rejected status change leaves the ticket wholly unchanged', async () => {
    const ticketId = await insertTicket(db, fixture);
    await setBoardCloseRules(db, fixture, { require_time_entry: true });
    const service = new TicketService();

    await expect(
      service.update(ticketId, { status_id: fixture.closedStatusId }, serviceContext())
    ).rejects.toThrow(/close rules/i);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(persisted.status_id).toBe(fixture.openStatusId);
    expect(persisted.is_closed).toBe(false);
    expect(persisted.closed_at).toBeNull();
    expect(persisted.closed_by).toBeNull();
  });

  // Pre-fix precedence: the derived close fields only win when the status
  // crosses the closed boundary. On a status change that stays open, a
  // caller-supplied closed_at/closed_by passed through updateTicketStatusSchema
  // must still reach the row (the follow-up writes only ever touched the
  // boundary cases). This is the silent-regression seam called out in the
  // review: folding must not start clobbering caller metadata.
  it('T056: caller-supplied closure metadata survives a non-boundary status change', async () => {
    const ticketId = await insertTicket(db, fixture);
    const service = new TicketService();
    const callerClosedAt = '2020-05-05T05:05:05.000Z';
    const callerClosedBy = uuidv4();

    const moved = await service.update(
      ticketId,
      {
        status_id: fixture.waitingStatusId,
        closed_at: callerClosedAt,
        closed_by: callerClosedBy,
      },
      serviceContext()
    );

    expect(moved.status_id).toBe(fixture.waitingStatusId);
    expect(moved.is_closed).toBe(false);
    expect(new Date(moved.closed_at as unknown as string).toISOString()).toBe(callerClosedAt);
    expect(moved.closed_by).toBe(callerClosedBy);

    const persisted = await scopedDb().table('tickets').where({ ticket_id: ticketId }).first();
    expect(new Date(persisted.closed_at).toISOString()).toBe(callerClosedAt);
    expect(persisted.closed_by).toBe(callerClosedBy);
  });
});
