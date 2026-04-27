import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
  publishedEvents: [] as Array<Record<string, unknown>>,
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();

  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) {
        throw new Error('DB unavailable for test runtime state');
      }

      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({
          tenantId: runtimeState.tenantId,
          actorUserId: runtimeState.actorUserId,
          trx,
        });
      });
    },
    requirePermission: async (ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      const key = `${permission.resource}:${permission.action}`;
      if (!runtimeState.deniedPermissions.has(key)) return;
      throw {
        category: 'ActionError',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${key}`,
        details: { permission: key },
        nodePath: ctx?.stepPath ?? 'steps.scheduling-action',
        at: new Date().toISOString(),
      };
    },
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async (event: Record<string, unknown>) => {
    runtimeState.publishedEvents.push(event);
  }),
}));

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerSchedulingActions } from '../businessOperations/scheduling';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.scheduling-action',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
    ...overrides,
  };
}

async function invokeAction(actionId: string, input: Record<string, unknown>, ctxOverrides: Record<string, unknown> = {}) {
  const action = getAction(actionId);
  const parsedInput = action.inputSchema.parse(input);
  return action.handler(parsedInput, actionCtx(ctxOverrides) as any);
}

async function ensureTechnicianRole(db: Knex, tenantId: string, userId: string): Promise<void> {
  const roleId = uuidv4();
  const nowIso = new Date().toISOString();

  const roleColumns = await db('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'roles' });
  const roleColumnSet = new Set(roleColumns.map((row: { column_name: string }) => row.column_name));

  const roleRow: Record<string, unknown> = {
    role_id: roleId,
    role_name: 'Technician',
  };
  if (roleColumnSet.has('tenant')) roleRow.tenant = tenantId;
  if (roleColumnSet.has('msp')) roleRow.msp = true;
  if (roleColumnSet.has('created_at')) roleRow.created_at = nowIso;
  if (roleColumnSet.has('updated_at')) roleRow.updated_at = nowIso;

  await db('roles').insert(roleRow);

  const userRoleColumns = await db('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'user_roles' });
  const userRoleColumnSet = new Set(userRoleColumns.map((row: { column_name: string }) => row.column_name));

  const userRoleRow: Record<string, unknown> = {
    role_id: roleId,
    user_id: userId,
  };
  if (userRoleColumnSet.has('tenant')) userRoleRow.tenant = tenantId;
  if (userRoleColumnSet.has('created_at')) userRoleRow.created_at = nowIso;
  if (userRoleColumnSet.has('updated_at')) userRoleRow.updated_at = nowIso;

  await db('user_roles').insert(userRoleRow);
}

type ScheduleEntryModel = {
  getAll: (knexOrTrx: Knex | Knex.Transaction, tenant: string, start: Date, end: Date) => Promise<Array<Record<string, unknown>>>;
};

let scheduleEntryModelPromise: Promise<ScheduleEntryModel> | null = null;

async function getScheduleEntryModel(): Promise<ScheduleEntryModel> {
  scheduleEntryModelPromise ??= import('../../../../../packages/scheduling/src/models/' + 'scheduleEntry')
    .then((module) => (module as { default: ScheduleEntryModel }).default);
  return scheduleEntryModelPromise;
}

async function createScheduleEntry(
  db: Knex,
  tenantId: string,
  options: {
    title?: string;
    workItemType?: string;
    workItemId?: string;
    status?: string;
    notes?: string | null;
    scheduledStart: string;
    scheduledEnd: string;
    assignedUserIds: string[];
    isRecurring?: boolean;
    recurrencePattern?: Record<string, unknown> | null;
    isPrivate?: boolean;
  }
): Promise<string> {
  const entryId = uuidv4();
  const nowIso = new Date().toISOString();

  await db('schedule_entries').insert({
    tenant: tenantId,
    entry_id: entryId,
    title: options.title ?? 'Test Entry',
    work_item_id: options.workItemId ?? uuidv4(),
    work_item_type: options.workItemType ?? 'ticket',
    scheduled_start: options.scheduledStart,
    scheduled_end: options.scheduledEnd,
    status: options.status ?? 'scheduled',
    notes: options.notes ?? null,
    is_recurring: options.isRecurring ?? false,
    recurrence_pattern: options.recurrencePattern ? JSON.stringify(options.recurrencePattern) : null,
    is_private: options.isPrivate ?? false,
    created_at: nowIso,
    updated_at: nowIso,
  });

  for (const userId of options.assignedUserIds) {
    await db('schedule_entry_assignees').insert({
      tenant: tenantId,
      entry_id: entryId,
      user_id: userId,
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  return entryId;
}

describe('scheduling business operation db actions', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;

    const registry = getActionRegistryV2();
    if (!registry.get('scheduling.complete', 1)) {
      registerSchedulingActions();
    }
  }, 120000);

  afterAll(async () => {
    runtimeState.db = null;
    if (db) {
      await db.destroy();
    }
  });

  beforeEach(async () => {
    runtimeState.deniedPermissions.clear();
    runtimeState.publishedEvents.length = 0;

    runtimeState.tenantId = await createTenant(db, 'Scheduling Test Tenant');
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId, { email: `actor-${Date.now()}@example.com` });
  });

  it('T003: find_entry/search_entries are tenant-scoped with assignee ids and private redaction', async () => {
    const tenantA = runtimeState.tenantId;
    const tenantB = await createTenant(db, 'Other Tenant');
    const assigneeA = await createUser(db, tenantA, { email: 'assignee-a@example.com' });
    const assigneeB = await createUser(db, tenantB, { email: 'assignee-b@example.com' });

    const entryA = await createScheduleEntry(db, tenantA, {
      title: 'Tenant A Private',
      scheduledStart: '2026-05-01T10:00:00.000Z',
      scheduledEnd: '2026-05-01T11:00:00.000Z',
      assignedUserIds: [assigneeA],
      isPrivate: true,
    });

    await createScheduleEntry(db, tenantB, {
      title: 'Tenant B Entry',
      scheduledStart: '2026-05-01T10:00:00.000Z',
      scheduledEnd: '2026-05-01T11:00:00.000Z',
      assignedUserIds: [assigneeB],
    });

    const findResult = await invokeAction('scheduling.find_entry', { entry_id: entryA, include_private_details: false });
    expect(findResult.found).toBe(true);
    expect(findResult.entry.entry_id).toBe(entryA);
    expect(findResult.entry.title).toBe('Busy');
    expect(findResult.entry.assigned_user_ids).toEqual([assigneeA]);

    const ownPrivateEntry = await createScheduleEntry(db, tenantA, {
      title: 'Own Private Details',
      scheduledStart: '2026-05-02T10:00:00.000Z',
      scheduledEnd: '2026-05-02T11:00:00.000Z',
      assignedUserIds: [runtimeState.actorUserId],
      isPrivate: true,
    });
    const ownFindResult = await invokeAction('scheduling.find_entry', { entry_id: ownPrivateEntry, include_private_details: false });
    expect(ownFindResult.found).toBe(true);
    expect(ownFindResult.entry.title).toBe('Own Private Details');

    const hiddenPrivateQuery = await invokeAction('scheduling.search_entries', { query: 'Tenant A Private' });
    expect(hiddenPrivateQuery.entries).toHaveLength(0);

    const ownPrivateQuery = await invokeAction('scheduling.search_entries', { query: 'Own Private Details' });
    expect(ownPrivateQuery.entries).toHaveLength(1);
    expect(ownPrivateQuery.entries[0].entry_id).toBe(ownPrivateEntry);

    const searchResult = await invokeAction('scheduling.search_entries', {
      window: {
        start: '2026-05-01T09:00:00.000Z',
        end: '2026-05-01T12:00:00.000Z',
      },
      limit: 50,
    });

    expect(searchResult.entries).toHaveLength(1);
    expect(searchResult.entries[0].entry_id).toBe(entryA);
  });

  it('T004: find_entry/search_entries require user_schedule:read', async () => {
    runtimeState.deniedPermissions.add('user_schedule:read');

    await expect(invokeAction('scheduling.find_entry', { entry_id: uuidv4() })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });

    await expect(invokeAction('scheduling.search_entries', {
      query: 'anything',
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('T005/T006/T007: reschedule handles happy path, fail, shift, and override modes with audit/conflicts/events', async () => {
    const assigneeId = await createUser(db, runtimeState.tenantId, { email: 'reschedule-assignee@example.com' });

    const targetEntryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Target',
      scheduledStart: '2026-05-01T10:00:00.000Z',
      scheduledEnd: '2026-05-01T11:00:00.000Z',
      assignedUserIds: [assigneeId],
    });

    await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Conflict',
      scheduledStart: '2026-05-01T11:00:00.000Z',
      scheduledEnd: '2026-05-01T12:00:00.000Z',
      assignedUserIds: [assigneeId],
    });

    await expect(invokeAction('scheduling.reschedule', {
      entry_id: targetEntryId,
      window: {
        start: '2026-05-01T11:15:00.000Z',
        end: '2026-05-01T12:15:00.000Z',
      },
      conflict_mode: 'fail',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const shifted = await invokeAction('scheduling.reschedule', {
      entry_id: targetEntryId,
      window: {
        start: '2026-05-01T11:15:00.000Z',
        end: '2026-05-01T12:15:00.000Z',
      },
      conflict_mode: 'shift',
    });

    expect(shifted.new_start).toBe('2026-05-01T12:00:00.000Z');
    expect(shifted.new_end).toBe('2026-05-01T13:00:00.000Z');

    const override = await invokeAction('scheduling.reschedule', {
      entry_id: targetEntryId,
      window: {
        start: '2026-05-01T11:30:00.000Z',
        end: '2026-05-01T12:30:00.000Z',
      },
      conflict_mode: 'override',
      reason: 'dispatcher override',
    });

    expect(override.new_start).toBe('2026-05-01T11:30:00.000Z');

    const conflictRows = await db('schedule_conflicts').where({ tenant: runtimeState.tenantId, entry_id_1: override.updated_entry_id });
    expect(conflictRows.length).toBeGreaterThan(0);

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:scheduling.reschedule' })
      .orderBy('timestamp', 'desc')
      .first();
    expect(audit).toBeDefined();

    const eventTypes = runtimeState.publishedEvents.map((event) => event.eventType);
    expect(eventTypes).toContain('APPOINTMENT_RESCHEDULED');
  });

  it('T008/T009: reassign validates technician eligibility, supports no-op, and emits one event per new assignee', async () => {
    const originalAssignee = await createUser(db, runtimeState.tenantId, { email: 'original-tech@example.com' });
    const replacementA = await createUser(db, runtimeState.tenantId, { email: 'replacement-a@example.com' });
    const replacementB = await createUser(db, runtimeState.tenantId, { email: 'replacement-b@example.com' });

    await ensureTechnicianRole(db, runtimeState.tenantId, originalAssignee);
    await ensureTechnicianRole(db, runtimeState.tenantId, replacementA);
    await ensureTechnicianRole(db, runtimeState.tenantId, replacementB);

    const entryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Reassign Target',
      scheduledStart: '2026-05-03T09:00:00.000Z',
      scheduledEnd: '2026-05-03T10:00:00.000Z',
      assignedUserIds: [originalAssignee],
    });

    const noOp = await invokeAction('scheduling.reassign', {
      entry_id: entryId,
      assigned_user_ids: [originalAssignee],
      mode: 'replace',
      no_op_if_already_assigned: true,
    });

    expect(noOp.changed).toBe(false);

    const replaced = await invokeAction('scheduling.reassign', {
      entry_id: entryId,
      assigned_user_ids: [replacementA, replacementB],
      mode: 'replace',
      no_op_if_already_assigned: true,
      reason: 'Escalation',
    });

    expect(replaced.changed).toBe(true);
    expect(replaced.assigned_user_ids.sort()).toEqual([replacementA, replacementB].sort());
    expect(replaced.events_emitted).toBe(2);

    const assignmentRows = await db('schedule_entry_assignees')
      .where({ tenant: runtimeState.tenantId, entry_id: replaced.updated_entry_id })
      .select('user_id');
    expect(assignmentRows.map((row: { user_id: string }) => row.user_id).sort()).toEqual([replacementA, replacementB].sort());

    const eventTypes = runtimeState.publishedEvents.map((event) => event.eventType);
    expect(eventTypes.filter((value) => value === 'APPOINTMENT_ASSIGNED')).toHaveLength(2);

    const nonTechUser = await createUser(db, runtimeState.tenantId, { email: 'non-tech@example.com' });
    await expect(invokeAction('scheduling.reassign', {
      entry_id: entryId,
      assigned_user_ids: [nonTechUser],
      mode: 'replace',
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('T010/T011: cancel and complete mark status, preserve row, write audit, and emit events', async () => {
    const assigneeId = await createUser(db, runtimeState.tenantId, { email: 'status-assignee@example.com' });

    const entryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Status Target',
      scheduledStart: '2026-05-04T10:00:00.000Z',
      scheduledEnd: '2026-05-04T11:00:00.000Z',
      assignedUserIds: [assigneeId],
    });

    const canceled = await invokeAction('scheduling.cancel', {
      entry_id: entryId,
      reason: 'Customer unavailable',
      note: 'Reschedule next week',
    });

    expect(canceled.status.toLowerCase()).toContain('cancel');
    expect(canceled.event_type).toBe('APPOINTMENT_CANCELED');

    const afterCancel = await db('schedule_entries').where({ tenant: runtimeState.tenantId, entry_id: canceled.updated_entry_id }).first();
    expect(afterCancel).toBeDefined();
    expect(String(afterCancel.status).toLowerCase()).toContain('cancel');

    const completed = await invokeAction('scheduling.complete', {
      entry_id: entryId,
      outcome: 'Work completed successfully',
      note: 'Signed off by customer',
    });

    expect(completed.status.toLowerCase()).toContain('complete');
    expect(completed.event_type).toBe('APPOINTMENT_COMPLETED');

    const afterComplete = await db('schedule_entries').where({ tenant: runtimeState.tenantId, entry_id: completed.updated_entry_id }).first();
    expect(String(afterComplete.status).toLowerCase()).toContain('complete');

    const auditRows = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId })
      .whereIn('operation', ['workflow_action:scheduling.cancel', 'workflow_action:scheduling.complete']);
    expect(auditRows.length).toBeGreaterThanOrEqual(2);

    const eventTypes = runtimeState.publishedEvents.map((event) => event.eventType);
    expect(eventTypes).toContain('APPOINTMENT_CANCELED');
    expect(eventTypes).toContain('APPOINTMENT_COMPLETED');
  });

  it('T012: single-scope virtual recurrence updates only one occurrence and preserves other generated occurrences', async () => {
    const assigneeId = await createUser(db, runtimeState.tenantId, { email: 'recurrence-tech@example.com' });
    await ensureTechnicianRole(db, runtimeState.tenantId, assigneeId);

    const start = new Date('2026-05-10T09:00:00.000Z');
    const end = new Date('2026-05-10T10:00:00.000Z');

    const masterEntryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Recurring Entry',
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      assignedUserIds: [assigneeId],
      isRecurring: true,
      recurrencePattern: {
        frequency: 'daily',
        interval: 1,
        startDate: start.toISOString(),
      },
    });

    const dayTwo = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const dayThree = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
    const dayTwoVirtualId = `${masterEntryId}_${dayTwo.getTime()}`;

    const result = await invokeAction('scheduling.reassign', {
      entry_id: dayTwoVirtualId,
      assigned_user_ids: [assigneeId],
      mode: 'replace',
      recurrence_scope: 'single',
      no_op_if_already_assigned: false,
      reason: 'Pin one occurrence',
    });

    expect(result.updated_entry_id).not.toBe(masterEntryId);

    const ScheduleEntry = await getScheduleEntryModel();
    const inRange = await ScheduleEntry.getAll(
      db,
      runtimeState.tenantId,
      new Date(start.getTime() - 6 * 60 * 60 * 1000),
      new Date(dayThree.getTime() + 6 * 60 * 60 * 1000)
    );

    const dayThreeVirtualId = `${masterEntryId}_${dayThree.getTime()}`;
    expect(inRange.some((entry: { entry_id: string }) => entry.entry_id === dayThreeVirtualId)).toBe(true);
    expect(inRange.some((entry: { entry_id: string }) => entry.entry_id === result.updated_entry_id)).toBe(true);
  });

  it('T012: rescheduling a virtual recurrence extracts the original occurrence only', async () => {
    const assigneeId = await createUser(db, runtimeState.tenantId, { email: 'recurrence-reschedule-tech@example.com' });

    const start = new Date('2026-05-10T09:00:00.000Z');
    const end = new Date('2026-05-10T10:00:00.000Z');

    const masterEntryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Weekly Recurring Entry',
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      assignedUserIds: [assigneeId],
      isRecurring: true,
      recurrencePattern: {
        frequency: 'weekly',
        interval: 1,
        startDate: start.toISOString(),
      },
    });

    const originalOccurrence = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const rescheduledStart = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
    const rescheduledEnd = new Date(rescheduledStart.getTime() + 60 * 60 * 1000);
    const nextOccurrence = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const originalVirtualId = `${masterEntryId}_${originalOccurrence.getTime()}`;

    const result = await invokeAction('scheduling.reschedule', {
      entry_id: originalVirtualId,
      window: {
        start: rescheduledStart.toISOString(),
        end: rescheduledEnd.toISOString(),
      },
      recurrence_scope: 'single',
    });

    expect(result.updated_entry_id).not.toBe(masterEntryId);
    expect(result.new_start).toBe(rescheduledStart.toISOString());

    const ScheduleEntry = await getScheduleEntryModel();
    const inRange = await ScheduleEntry.getAll(
      db,
      runtimeState.tenantId,
      new Date(start.getTime() - 6 * 60 * 60 * 1000),
      new Date(nextOccurrence.getTime() + 6 * 60 * 60 * 1000)
    );

    const entryIds = inRange.map((entry: { entry_id: string }) => entry.entry_id);
    expect(entryIds).not.toContain(originalVirtualId);
    expect(entryIds).toContain(result.updated_entry_id);
    expect(entryIds).toContain(`${masterEntryId}_${nextOccurrence.getTime()}`);
  });

  it('T013: write actions reject missing user_schedule:update and do not mutate schedule data', async () => {
    const assigneeId = await createUser(db, runtimeState.tenantId, { email: 'guard-assignee@example.com' });
    await ensureTechnicianRole(db, runtimeState.tenantId, assigneeId);

    const entryId = await createScheduleEntry(db, runtimeState.tenantId, {
      title: 'Permission Guard',
      scheduledStart: '2026-05-06T10:00:00.000Z',
      scheduledEnd: '2026-05-06T11:00:00.000Z',
      assignedUserIds: [assigneeId],
    });

    runtimeState.deniedPermissions.add('user_schedule:update');

    await expect(invokeAction('scheduling.reschedule', {
      entry_id: entryId,
      window: {
        start: '2026-05-06T12:00:00.000Z',
        end: '2026-05-06T13:00:00.000Z',
      },
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(invokeAction('scheduling.reassign', {
      entry_id: entryId,
      assigned_user_ids: [assigneeId],
      mode: 'replace',
      no_op_if_already_assigned: false,
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(invokeAction('scheduling.cancel', {
      entry_id: entryId,
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(invokeAction('scheduling.complete', {
      entry_id: entryId,
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const row = await db('schedule_entries').where({ tenant: runtimeState.tenantId, entry_id: entryId }).first();
    expect(row.scheduled_start.toISOString()).toBe('2026-05-06T10:00:00.000Z');

    const assignees = await db('schedule_entry_assignees').where({ tenant: runtimeState.tenantId, entry_id: entryId });
    expect(assignees).toHaveLength(1);
  });
});
