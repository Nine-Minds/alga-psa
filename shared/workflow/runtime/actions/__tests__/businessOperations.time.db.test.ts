import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';
import {
  createBucketOverlayForPlan,
  createFixedPlanAssignment,
} from '../../../../../server/test-utils/billingTestHelpers';

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
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
        nodePath: ctx?.stepPath ?? 'steps.time-action',
        at: new Date().toISOString(),
      };
    },
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTimeActions } from '../businessOperations/time';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.time-action',
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

async function createClient(db: Knex, tenantId: string, name = 'Test Client'): Promise<string> {
  const clientId = uuidv4();
  const now = new Date().toISOString();

  await db('clients').insert({
    client_id: clientId,
    client_name: name,
    tenant: tenantId,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    url: '',
    created_at: now,
    updated_at: now,
    is_inactive: false,
    credit_balance: 0,
  });

  return clientId;
}

async function createTicketStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const [inserted] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');

  return inserted.status_id;
}

async function createProjectStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: 'project' })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const [inserted] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Project Open',
      status_type: 'project',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');

  return inserted.status_id;
}

async function createProjectTaskStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: 'project_task' })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const [inserted] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Task Open',
      status_type: 'project_task',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');

  return inserted.status_id;
}

async function createTicket(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    title?: string;
  }
): Promise<string> {
  const ticketId = uuidv4();
  const statusId = await createTicketStatusId(db, params.tenantId, params.actorUserId);

  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: params.tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: params.title ?? 'Workflow Time Ticket',
    status_id: statusId,
    client_id: params.clientId,
    entered_by: params.actorUserId,
  });

  return ticketId;
}

async function createService(db: Knex, tenantId: string): Promise<string> {
  const existingType = await db('service_types').where({ tenant: tenantId }).first();
  const serviceTypeId = existingType?.id ?? uuidv4();

  if (!existingType) {
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: 'Workflow Time Service Type',
      billing_method: 'hourly',
      is_active: true,
      order_number: 1,
    });
  }

  const serviceId = uuidv4();
  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: 'Workflow Time Service',
    billing_method: 'hourly',
    custom_service_type_id: serviceTypeId,
    item_kind: 'service',
    default_rate: 10000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return serviceId;
}

async function createProjectTask(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
  }
): Promise<string> {
  const projectStatusId = await createProjectStatusId(db, params.tenantId, params.actorUserId);
  const taskStatusId = await createProjectTaskStatusId(db, params.tenantId, params.actorUserId);
  const projectId = uuidv4();
  const phaseId = uuidv4();
  const taskId = uuidv4();

  await db('projects').insert({
    project_id: projectId,
    tenant: params.tenantId,
    project_name: 'Workflow Time Project',
    client_id: params.clientId,
    status: projectStatusId,
    wbs_code: 'WF',
    project_number: `P-${Date.now()}`,
  });

  await db('project_phases').insert({
    phase_id: phaseId,
    tenant: params.tenantId,
    project_id: projectId,
    phase_name: 'Workflow Phase',
    order_number: 1,
    status: 'active',
    wbs_code: '1',
  });

  const [mapping] = await db('project_status_mappings')
    .insert({
      tenant: params.tenantId,
      project_id: projectId,
      status_id: taskStatusId,
      display_order: 1,
      is_standard: false,
    })
    .returning('project_status_mapping_id');

  await db('project_tasks').insert({
    task_id: taskId,
    tenant: params.tenantId,
    phase_id: phaseId,
    task_name: 'Workflow Task',
    project_status_mapping_id: mapping.project_status_mapping_id,
    estimated_hours: 240,
    actual_hours: 0,
    wbs_code: '1.1',
    task_type_key: 'task',
    created_at: new Date(),
    updated_at: new Date(),
  });

  return taskId;
}

async function createTimePeriod(
  db: Knex,
  tenantId: string,
  startDate: string,
  endDate: string
): Promise<string> {
  const periodId = uuidv4();
  await db('time_periods').insert({
    period_id: periodId,
    tenant: tenantId,
    start_date: startDate,
    end_date: endDate,
    is_closed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return periodId;
}

describe('time workflow runtime DB-backed action handlers', () => {
  let db: Knex;

  beforeAll(async () => {
    process.env.DB_NAME_SERVER = 'test_database';

    if (!getActionRegistryV2().get('time.create_entry', 1)) {
      registerTimeActions();
    }

    db = await createTestDbConnection();
    runtimeState.db = db;
  }, 180000);

  beforeEach(async () => {
    runtimeState.tenantId = await createTenant(db, `Workflow Time Runtime Test ${Date.now()}`);
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Workflow',
      last_name: 'Actor',
      timezone: 'America/New_York',
    });

    runtimeState.deniedPermissions.clear();
  });

  afterAll(async () => {
    runtimeState.db = null;
    await db?.destroy();
  });

  it('T001: workflow-safe create-entry helper creates a ticket time entry with service, user-timezone work date, time-sheet association, and normalized output', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Time',
      last_name: 'Owner',
      timezone: 'America/Los_Angeles',
    });

    const clientId = await createClient(db, runtimeState.tenantId, 'Workflow Time Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);

    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const result = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-02T06:30:00.000Z',
      duration_minutes: 60,
      billable: true,
      service_id: serviceId,
      link: {
        type: 'ticket',
        id: ticketId,
      },
      notes: 'Created by workflow runtime test',
    });

    expect(result.time_entry.user_id).toBe(entryUserId);
    expect(result.time_entry.service_id).toBe(serviceId);
    expect(result.time_entry.work_item_id).toBe(ticketId);
    expect(result.time_entry.work_item_type).toBe('ticket');
    expect(result.time_entry.total_minutes).toBe(60);
    expect(result.time_entry.billable_minutes).toBe(60);
    expect(result.time_entry.work_date).toBe('2026-04-01');
    expect(result.time_entry.work_timezone).toBe('America/Los_Angeles');
    expect(result.time_entry.time_sheet_id).toBeTruthy();

    const stored = await db('time_entries')
      .where({ tenant: runtimeState.tenantId, entry_id: result.time_entry.entry_id })
      .first();

    expect(stored).toBeTruthy();
    expect(stored.user_id).toBe(entryUserId);
    expect(stored.service_id).toBe(serviceId);
    expect(stored.work_item_id).toBe(ticketId);
    expect(stored.work_item_type).toBe('ticket');
    expect(stored.work_date instanceof Date ? stored.work_date.toISOString().slice(0, 10) : String(stored.work_date)).toBe('2026-04-01');
    expect(stored.work_timezone).toBe('America/Los_Angeles');
    expect(stored.billable_duration).toBe(60);
    expect(stored.time_sheet_id).toBe(result.time_entry.time_sheet_id);

    const sheet = await db('time_sheets')
      .where({ tenant: runtimeState.tenantId, id: result.time_entry.time_sheet_id })
      .first();

    expect(sheet).toBeTruthy();
    expect(sheet.user_id).toBe(entryUserId);
  });

  it('T002: create-entry resolves default contract line and updates bucket usage for a representative billable bucket-backed service', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Bucket',
      last_name: 'User',
      timezone: 'America/New_York',
    });

    const clientId = await createClient(db, runtimeState.tenantId, 'Bucket Usage Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const billingContext = {
      db,
      tenantId: runtimeState.tenantId,
      clientId,
      userId: runtimeState.actorUserId,
    } as any;

    const assignment = await createFixedPlanAssignment(billingContext, serviceId, {
      clientId,
      startDate: '2025-01-01',
      billingFrequency: 'monthly',
    });

    await createBucketOverlayForPlan(billingContext, assignment.contractLineId, {
      serviceId,
      totalMinutes: 120,
      allowRollover: false,
      billingPeriod: 'monthly',
    });

    const result = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-02T14:00:00.000Z',
      duration_minutes: 30,
      billable: true,
      service_id: serviceId,
      link: {
        type: 'ticket',
        id: ticketId,
      },
      notes: 'Bucket-backed workflow entry',
    });

    expect(result.time_entry.contract_line_id).toBe(assignment.contractLineId);
    expect(result.time_entry.billable_minutes).toBe(30);

    const usageRecord = await db('bucket_usage')
      .where({
        tenant: runtimeState.tenantId,
        client_id: clientId,
        contract_line_id: assignment.contractLineId,
        service_catalog_id: serviceId,
      })
      .first();

    expect(usageRecord).toBeTruthy();
    expect(Number(usageRecord.minutes_used ?? 0)).toBe(30);
    expect(Number(usageRecord.overage_minutes ?? 0)).toBe(0);
  });

  it('T003: create/update/delete project-task time entries recalculate project task actual hours correctly', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Task',
      last_name: 'Owner',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Project Task Client');
    const taskId = await createProjectTask(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const created = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-03T13:00:00.000Z',
      duration_minutes: 30,
      billable: true,
      service_id: serviceId,
      link: {
        type: 'project_task',
        id: taskId,
      },
      notes: 'Project task entry',
    });

    const afterCreate = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('actual_hours');
    expect(Number(afterCreate.actual_hours ?? 0)).toBe(30);

    const updated = await invokeAction('time.update_entry', {
      entry_id: created.time_entry.entry_id,
      duration_minutes: 90,
    });
    expect(updated.time_entry.total_minutes).toBe(90);
    expect(updated.time_entry.billable_minutes).toBe(90);

    const afterUpdate = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('actual_hours');
    expect(Number(afterUpdate.actual_hours ?? 0)).toBe(90);

    const deleted = await invokeAction('time.delete_entry', {
      entry_id: created.time_entry.entry_id,
    });
    expect(deleted.time_entry.deleted).toBe(true);

    const afterDelete = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('actual_hours');
    expect(Number(afterDelete.actual_hours ?? 0)).toBe(0);
  });
});
