import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';

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

async function grantWorkflowTimeTestPermissions(db: Knex, tenantId: string, userId: string): Promise<void> {
  const roleId = uuidv4();
  await db('roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: `Workflow Time Test Role ${userId}`,
    description: 'Grants workflow time action permissions for DB-backed tests',
    msp: true,
    client: false,
  });

  const permissions = [
    ['timeentry', 'create'],
    ['timeentry', 'read'],
    ['timeentry', 'update'],
    ['timeentry', 'delete'],
    ['timesheet', 'read'],
    ['timesheet', 'read_all'],
    ['timesheet', 'submit'],
    ['timesheet', 'approve'],
    ['timesheet', 'reverse'],
  ] as const;

  for (const [resource, action] of permissions) {
    let permission = await db('permissions')
      .where({ tenant: tenantId, resource, action, msp: true })
      .first('permission_id');

    if (!permission?.permission_id) {
      [permission] = await db('permissions')
        .insert({
          tenant: tenantId,
          permission_id: uuidv4(),
          resource,
          action,
          msp: true,
          client: false,
        })
        .returning('permission_id');
    }

    await db('role_permissions').insert({
      tenant: tenantId,
      role_id: roleId,
      permission_id: permission.permission_id,
    });
  }

  await db('user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: roleId,
  });
}

type BillingFixtureContext = {
  db: Knex;
  tenantId: string;
  clientId: string;
  userId?: string;
};

type FixedPlanFixtureOptions = {
  clientId?: string;
  startDate?: string;
  endDate?: string | null;
  billingFrequency?: string;
  planName?: string;
  quantity?: number;
  baseRateCents?: number;
};

type BucketOverlayFixtureOptions = {
  serviceId?: string;
  totalMinutes?: number;
  totalHours?: number;
  overageRateCents?: number;
  allowRollover?: boolean;
  billingPeriod?: string;
  configId?: string;
};

async function createFixedPlanAssignment(
  context: BillingFixtureContext,
  serviceId: string,
  options: FixedPlanFixtureOptions = {}
): Promise<{ contractLineId: string; clientContractLineId: string; contractId: string; clientContractId: string }> {
  const contractLineId = uuidv4();
  const clientContractLineId = uuidv4();
  const contractId = uuidv4();
  const clientContractId = uuidv4();
  const configId = uuidv4();
  const targetClientId = options.clientId ?? context.clientId;
  const startDate = options.startDate ?? '2025-02-01';
  const endDate = options.endDate ?? null;
  const billingFrequency = options.billingFrequency ?? 'monthly';
  const planName = options.planName ?? 'Workflow Time Test Contract Line';
  const quantity = options.quantity ?? 1;
  const baseRateDollars = (options.baseRateCents ?? 1000) / 100;
  const now = context.db.fn.now();

  await context.db('contracts').insert({
    tenant: context.tenantId,
    contract_id: contractId,
    contract_name: planName,
    contract_description: `${planName} fixture`,
    billing_frequency: billingFrequency,
    is_active: true,
    status: 'Active',
    is_template: false,
    currency_code: 'USD',
    owner_client_id: targetClientId,
    created_at: now,
    updated_at: now,
  });

  await context.db('client_contracts').insert({
    tenant: context.tenantId,
    client_contract_id: clientContractId,
    client_id: targetClientId,
    contract_id: contractId,
    start_date: startDate,
    end_date: endDate,
    is_active: true,
    status: 'pending',
    po_number: null,
    po_amount: null,
    po_required: false,
    template_contract_id: null,
    created_at: now,
    updated_at: now,
  });

  await context.db('contract_lines').insert({
    contract_line_id: contractLineId,
    tenant: context.tenantId,
    contract_id: contractId,
    contract_line_name: planName,
    billing_frequency: billingFrequency,
    is_custom: false,
    contract_line_type: 'Fixed',
    custom_rate: baseRateDollars,
    enable_proration: false,
    billing_cycle_alignment: 'start',
    billing_timing: 'arrears',
    cadence_owner: 'client',
  });

  await context.db('contract_line_services').insert({
    tenant: context.tenantId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    quantity,
    custom_rate: null,
  });

  await context.db('contract_line_service_configuration').insert({
    config_id: configId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    configuration_type: 'Fixed',
    custom_rate: null,
    quantity,
    tenant: context.tenantId,
  });

  await context.db('contract_line_service_fixed_config').insert({
    config_id: configId,
    tenant: context.tenantId,
    base_rate: baseRateDollars,
  });

  await context.db('client_contract_lines').insert({
    tenant: context.tenantId,
    client_contract_line_id: clientContractLineId,
    client_id: targetClientId,
    contract_line_id: contractLineId,
    start_date: startDate,
    end_date: endDate,
    is_active: true,
  });

  return { contractLineId, clientContractLineId, contractId, clientContractId };
}

async function createBucketOverlayForPlan(
  context: BillingFixtureContext,
  contractLineId: string,
  options: BucketOverlayFixtureOptions = {}
): Promise<{ configId: string; serviceId: string }> {
  const baseConfig = options.serviceId
    ? await context.db('contract_line_service_configuration')
      .where({
        tenant: context.tenantId,
        contract_line_id: contractLineId,
        service_id: options.serviceId,
      })
      .whereNot('configuration_type', 'Bucket')
      .first()
    : await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .whereNot('configuration_type', 'Bucket')
      .first();

  const serviceId = options.serviceId ?? baseConfig?.service_id;
  if (!serviceId) {
    throw new Error(`Unable to determine service for bucket overlay on contract line ${contractLineId}`);
  }

  const configId = options.configId ?? uuidv4();
  const totalMinutes = options.totalMinutes ?? Math.round((options.totalHours ?? 40) * 60);
  const bucketColumns = await context.db('contract_line_service_bucket_config').columnInfo();
  const totalColumn = bucketColumns.total_minutes ? 'total_minutes' : bucketColumns.total_hours ? 'total_hours' : null;
  if (!totalColumn) {
    throw new Error('Unable to determine total capacity column for contract bucket config');
  }

  await context.db('contract_line_services')
    .insert({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: baseConfig?.quantity ?? null,
      custom_rate: baseConfig?.custom_rate ?? null,
    })
    .onConflict(['tenant', 'service_id', 'contract_line_id'])
    .merge({ quantity: baseConfig?.quantity ?? null, custom_rate: baseConfig?.custom_rate ?? null });

  await context.db('contract_line_service_configuration').insert({
    config_id: configId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    configuration_type: 'Bucket',
    custom_rate: null,
    quantity: null,
    tenant: context.tenantId,
  });

  const bucketConfig: Record<string, unknown> = {
    config_id: configId,
    tenant: context.tenantId,
    billing_period: options.billingPeriod ?? 'monthly',
    overage_rate: options.overageRateCents ?? 0,
    allow_rollover: options.allowRollover ?? false,
  };
  bucketConfig[totalColumn] = totalColumn === 'total_minutes' ? totalMinutes : Math.round(totalMinutes / 60);

  await context.db('contract_line_service_bucket_config').insert(bucketConfig);

  return { configId, serviceId };
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
    await grantWorkflowTimeTestPermissions(db, runtimeState.tenantId, runtimeState.actorUserId);

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

  it('T004: update and delete reject invoiced time entries and leave billing/project side effects unchanged', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Invoiced',
      last_name: 'Guard',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Invoiced Guard Client');
    const taskId = await createProjectTask(db, {
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
      totalMinutes: 180,
      allowRollover: false,
      billingPeriod: 'monthly',
    });

    const created = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-04T10:00:00.000Z',
      duration_minutes: 60,
      billable: true,
      service_id: serviceId,
      link: {
        type: 'project_task',
        id: taskId,
      },
    });

    await db('time_entries')
      .where({ tenant: runtimeState.tenantId, entry_id: created.time_entry.entry_id })
      .update({ invoiced: true });

    const beforeTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('actual_hours');
    const beforeUsage = await db('bucket_usage')
      .where({
        tenant: runtimeState.tenantId,
        client_id: clientId,
        contract_line_id: assignment.contractLineId,
        service_catalog_id: serviceId,
      })
      .first('minutes_used');

    await expect(invokeAction('time.update_entry', {
      entry_id: created.time_entry.entry_id,
      duration_minutes: 30,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await expect(invokeAction('time.delete_entry', {
      entry_id: created.time_entry.entry_id,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const afterTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('actual_hours');
    const afterUsage = await db('bucket_usage')
      .where({
        tenant: runtimeState.tenantId,
        client_id: clientId,
        contract_line_id: assignment.contractLineId,
        service_catalog_id: serviceId,
      })
      .first('minutes_used');

    expect(Number(afterTask.actual_hours ?? 0)).toBe(Number(beforeTask.actual_hours ?? 0));
    expect(Number(afterUsage.minutes_used ?? 0)).toBe(Number(beforeUsage.minutes_used ?? 0));
  });

  it('T005: find/get time entry actions return tenant-scoped normalized data and bounded aggregate counts for representative filters', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Read',
      last_name: 'Scope',
      timezone: 'America/New_York',
    });

    const clientId = await createClient(db, runtimeState.tenantId, 'Find/Get Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const first = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-04T14:00:00.000Z',
      duration_minutes: 45,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
      notes: 'Find test billable',
    });

    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-04T15:00:00.000Z',
      duration_minutes: 30,
      billable: false,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
      notes: 'Find test non billable',
    });

    const fetched = await invokeAction('time.get_entry', {
      entry_id: first.time_entry.entry_id,
    });
    expect(fetched.time_entry.entry_id).toBe(first.time_entry.entry_id);
    expect(fetched.time_entry.total_minutes).toBe(45);
    expect(fetched.time_entry.billable_minutes).toBe(45);

    const found = await invokeAction('time.find_entries', {
      user_id: entryUserId,
      client_id: clientId,
      work_date_from: '2026-04-04',
      work_date_to: '2026-04-04',
      limit: 20,
    });

    expect(found.entries).toHaveLength(2);
    expect(found.summary.total_count).toBe(2);
    expect(found.summary.total_minutes).toBe(75);
    expect(found.summary.billable_minutes).toBe(45);

    const otherTenantId = await createTenant(db, `Workflow Time Other Tenant ${Date.now()}`);
    const otherUserId = await createUser(db, otherTenantId, {
      user_type: 'internal',
      first_name: 'Other',
      last_name: 'Tenant',
      timezone: 'America/New_York',
    });
    const otherServiceId = await createService(db, otherTenantId);
    const otherEntryId = uuidv4();

    await db('time_entries').insert({
      tenant: otherTenantId,
      entry_id: otherEntryId,
      user_id: otherUserId,
      work_item_id: null,
      work_item_type: null,
      service_id: otherServiceId,
      contract_line_id: null,
      start_time: '2026-04-04T12:00:00.000Z',
      end_time: '2026-04-04T12:30:00.000Z',
      work_date: '2026-04-04',
      work_timezone: 'America/New_York',
      billable_duration: 30,
      notes: 'Other tenant entry',
      approval_status: 'DRAFT',
      time_sheet_id: null,
      invoiced: false,
      created_by: otherUserId,
      updated_by: otherUserId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await expect(invokeAction('time.get_entry', { entry_id: otherEntryId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('T006: entry approval actions move entries through submitted/approved/changes-requested states and create change-request records when comments are supplied', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Approval',
      last_name: 'Flow',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Approval Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const first = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-05T12:00:00.000Z',
      duration_minutes: 30,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    const second = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-05T13:00:00.000Z',
      duration_minutes: 20,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    const submitted = await invokeAction('time.set_entry_approval_status', {
      entry_id: first.time_entry.entry_id,
      approval_status: 'SUBMITTED',
    });
    expect(submitted.entry.approval_status).toBe('SUBMITTED');

    const approved = await invokeAction('time.set_entry_approval_status', {
      entry_id: first.time_entry.entry_id,
      approval_status: 'APPROVED',
    });
    expect(approved.entry.approval_status).toBe('APPROVED');

    const changesRequested = await invokeAction('time.set_entry_approval_status', {
      entry_id: first.time_entry.entry_id,
      approval_status: 'CHANGES_REQUESTED',
      change_request_comment: 'Please adjust notes and duration',
    });
    expect(changesRequested.entry.approval_status).toBe('CHANGES_REQUESTED');
    expect(changesRequested.entry.change_request_id).toBeTruthy();

    const requestResult = await invokeAction('time.request_entry_changes', {
      entry_ids: [first.time_entry.entry_id, second.time_entry.entry_id],
      comment: 'Bulk review requested changes',
    });
    expect(requestResult.entries).toHaveLength(2);
    expect(requestResult.entries.every((entry: any) => entry.approval_status === 'CHANGES_REQUESTED')).toBe(true);

    const changedRows = await db('time_entries')
      .where({
        tenant: runtimeState.tenantId,
        approval_status: 'CHANGES_REQUESTED',
      })
      .whereIn('entry_id', [first.time_entry.entry_id, second.time_entry.entry_id])
      .select('entry_id');
    expect(changedRows).toHaveLength(2);

    const changeRequests = await db('time_entry_change_requests')
      .where({ tenant: runtimeState.tenantId })
      .whereIn('time_entry_id', [first.time_entry.entry_id, second.time_entry.entry_id]);
    expect(changeRequests.length).toBeGreaterThanOrEqual(2);
  });

  it('T007: find-or-create/get/find timesheet actions return sheet, period, comments, and summary fields for representative user/date/status filters', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Timesheet',
      last_name: 'Reader',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Timesheet Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);

    const periodA = await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-08', '2026-04-15');

    const createdSheet = await invokeAction('time.find_or_create_timesheet', {
      user_id: entryUserId,
      period_id: periodA,
    });

    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-03T12:00:00.000Z',
      duration_minutes: 40,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
      time_sheet_id: createdSheet.time_sheet.time_sheet_id,
    });
    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-03T13:00:00.000Z',
      duration_minutes: 20,
      billable: false,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
      time_sheet_id: createdSheet.time_sheet.time_sheet_id,
    });

    await db('time_sheet_comments').insert({
      comment_id: uuidv4(),
      time_sheet_id: createdSheet.time_sheet.time_sheet_id,
      user_id: runtimeState.actorUserId,
      comment: 'Manager note for review',
      is_approver: true,
      created_at: new Date().toISOString(),
      tenant: runtimeState.tenantId,
    });

    const fetched = await invokeAction('time.get_timesheet', {
      time_sheet_id: createdSheet.time_sheet.time_sheet_id,
    });
    expect(fetched.time_sheet.time_sheet_id).toBe(createdSheet.time_sheet.time_sheet_id);
    expect(fetched.time_sheet.entry_count).toBe(2);
    expect(fetched.time_sheet.total_minutes).toBe(60);
    expect(fetched.time_sheet.billable_minutes).toBe(40);
    expect(fetched.comments.length).toBeGreaterThanOrEqual(1);

    const found = await invokeAction('time.find_timesheets', {
      user_ids: [entryUserId],
      approval_status: 'DRAFT',
      period_start_from: '2026-04-01',
      period_end_to: '2026-04-15',
      limit: 20,
    });
    expect(found.time_sheets.length).toBeGreaterThanOrEqual(1);
    expect(found.time_sheets[0].user_id).toBe(entryUserId);
    expect(found.summary.total_count).toBeGreaterThanOrEqual(1);
  });

  it('T008: submit timesheet updates the sheet and all associated entries to SUBMITTED using canonical submit behavior', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Submit',
      last_name: 'Sheet',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Submit Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const first = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-06T12:00:00.000Z',
      duration_minutes: 25,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });
    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-06T13:00:00.000Z',
      duration_minutes: 35,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    const submitted = await invokeAction('time.submit_timesheet', {
      time_sheet_id: first.time_entry.time_sheet_id,
    });
    expect(submitted.time_sheet.approval_status).toBe('SUBMITTED');

    const entryStatuses = await db('time_entries')
      .where({
        tenant: runtimeState.tenantId,
        time_sheet_id: first.time_entry.time_sheet_id,
      })
      .select('approval_status');
    expect(entryStatuses.length).toBe(2);
    expect(entryStatuses.every((row) => row.approval_status === 'SUBMITTED')).toBe(true);
  });

  it('T009: approve/request-changes/reverse timesheet actions enforce state transitions, comments, associated entry statuses, and invoiced-entry reopen guard', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Approve',
      last_name: 'Sheet',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Approve Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const created = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-06T15:00:00.000Z',
      duration_minutes: 60,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });
    const timeSheetId = created.time_entry.time_sheet_id;

    await invokeAction('time.submit_timesheet', { time_sheet_id: timeSheetId });

    const approved = await invokeAction('time.approve_timesheet', {
      time_sheet_id: timeSheetId,
      comment: 'Looks good',
    });
    expect(approved.time_sheet.approval_status).toBe('APPROVED');
    expect(approved.time_sheet.approved_by).toBe(runtimeState.actorUserId);

    const commentAdded = await invokeAction('time.add_timesheet_comment', {
      time_sheet_id: timeSheetId,
      comment: 'Follow-up approver note',
      is_approver: true,
    });
    expect(commentAdded.comment.is_approver).toBe(true);

    const changesRequested = await invokeAction('time.request_timesheet_changes', {
      time_sheet_id: timeSheetId,
      comment: 'Need minor corrections',
    });
    expect(changesRequested.time_sheet.approval_status).toBe('CHANGES_REQUESTED');

    const changedStatuses = await db('time_entries')
      .where({ tenant: runtimeState.tenantId, time_sheet_id: timeSheetId })
      .select('approval_status');
    expect(changedStatuses.every((row) => row.approval_status === 'CHANGES_REQUESTED')).toBe(true);

    await invokeAction('time.submit_timesheet', { time_sheet_id: timeSheetId });
    await invokeAction('time.approve_timesheet', { time_sheet_id: timeSheetId });

    await db('time_entries')
      .where({ tenant: runtimeState.tenantId, time_sheet_id: timeSheetId })
      .limit(1)
      .update({ invoiced: true });

    await expect(invokeAction('time.reverse_timesheet_approval', {
      time_sheet_id: timeSheetId,
      reason: 'Reopen after invoicing',
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('T010: readiness helper detects representative billing blockers and returns categories, counts, matching entry IDs, and human-readable explanations without mutating invoices', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Blocker',
      last_name: 'User',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Blocker Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const entryA = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-07T12:00:00.000Z',
      duration_minutes: 30,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    const entryB = uuidv4();
    await db('time_entries').insert({
      tenant: runtimeState.tenantId,
      entry_id: entryB,
      user_id: entryUserId,
      work_item_id: null,
      work_item_type: null,
      service_id: serviceId,
      contract_line_id: null,
      start_time: '2026-04-07T14:00:00.000Z',
      end_time: '2026-04-07T14:00:00.000Z',
      work_date: '2026-04-07',
      work_timezone: 'America/New_York',
      billable_duration: 0,
      notes: 'Invalid duration entry',
      approval_status: 'DRAFT',
      time_sheet_id: null,
      invoiced: false,
      created_by: runtimeState.actorUserId,
      updated_by: runtimeState.actorUserId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const blockers = await invokeAction('time.find_billing_blockers', {
      entry_ids: [entryA.time_entry.entry_id, entryB],
      require_timesheet: true,
      limit: 100,
    });

    const categories = blockers.blockers.map((blocker: any) => blocker.category);
    expect(categories).toContain('status_draft');
    expect(categories).toContain('missing_contract_line');
    expect(categories).toContain('invalid_duration');
    expect(categories).toContain('missing_work_item');
    expect(categories).toContain('missing_timesheet');

    const validation = await invokeAction('time.validate_entries', {
      entry_ids: [entryA.time_entry.entry_id, entryB],
      require_timesheet: true,
      limit: 100,
    });
    expect(validation.valid).toBe(false);
    expect(validation.blocker_count).toBeGreaterThan(0);
  });

  it('T011: summarize entries returns correct totals and grouped minutes for representative user/client/service/status/date filters', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Summary',
      last_name: 'User',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Summary Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-07T09:00:00.000Z',
      duration_minutes: 40,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });
    await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-07T10:00:00.000Z',
      duration_minutes: 20,
      billable: false,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    const summary = await invokeAction('time.summarize_entries', {
      user_id: entryUserId,
      client_id: clientId,
      work_date_from: '2026-04-07',
      work_date_to: '2026-04-07',
      group_by: ['user_id', 'billable'],
      limit: 100,
    });

    expect(summary.totals.entry_count).toBe(2);
    expect(summary.totals.total_minutes).toBe(60);
    expect(summary.totals.billable_minutes).toBe(40);
    expect(summary.totals.non_billable_minutes).toBe(20);
    expect(summary.groups).toHaveLength(2);
  });

  it('T012: workflow actor without required timeentry/timesheet permissions receives structured permission-denied action errors for read and mutation actions', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Permission',
      last_name: 'Denied',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Permission Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    runtimeState.deniedPermissions.add('timeentry:create');
    await expect(invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-08T09:00:00.000Z',
      duration_minutes: 15,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    runtimeState.deniedPermissions.delete('timeentry:create');

    const created = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-08T10:00:00.000Z',
      duration_minutes: 15,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    });

    runtimeState.deniedPermissions.add('timeentry:read');
    await expect(invokeAction('time.get_entry', {
      entry_id: created.time_entry.entry_id,
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    runtimeState.deniedPermissions.delete('timeentry:read');

    runtimeState.deniedPermissions.add('timesheet:approve');
    await expect(invokeAction('time.set_entry_approval_status', {
      entry_id: created.time_entry.entry_id,
      approval_status: 'SUBMITTED',
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('T015: mutating time actions write workflow run audit rows with action metadata and key changed entity IDs', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Audit',
      last_name: 'Trail',
      timezone: 'America/New_York',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Audit Client');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
    });
    const serviceId = await createService(db, runtimeState.tenantId);
    await createTimePeriod(db, runtimeState.tenantId, '2026-04-01', '2026-04-08');

    const runIdCreate = uuidv4();
    const created = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-08T14:00:00.000Z',
      duration_minutes: 20,
      billable: true,
      service_id: serviceId,
      link: { type: 'ticket', id: ticketId },
    }, { runId: runIdCreate });

    const createAudit = await db('audit_logs')
      .where({
        tenant: runtimeState.tenantId,
        record_id: runIdCreate,
        operation: 'workflow_action:time.create_entry',
      })
      .first();
    expect(createAudit).toBeTruthy();
    expect(createAudit.details.action_id).toBe('time.create_entry');
    expect(createAudit.changed_data.entry_id).toBe(created.time_entry.entry_id);

    const runIdSubmit = uuidv4();
    const submitted = await invokeAction('time.submit_timesheet', {
      time_sheet_id: created.time_entry.time_sheet_id,
    }, { runId: runIdSubmit });

    const submitAudit = await db('audit_logs')
      .where({
        tenant: runtimeState.tenantId,
        record_id: runIdSubmit,
        operation: 'workflow_action:time.submit_timesheet',
      })
      .first();
    expect(submitAudit).toBeTruthy();
    expect(submitAudit.details.action_id).toBe('time.submit_timesheet');
    expect(submitAudit.changed_data.time_sheet_id).toBe(submitted.time_sheet.time_sheet_id);
  });

  it('T016: existing/migrated time.create_entry input shape follows compatibility decision and enforces canonical service/timesheet/work-date behavior', async () => {
    const entryUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'internal',
      first_name: 'Compat',
      last_name: 'Alias',
      timezone: 'America/Los_Angeles',
    });
    const clientId = await createClient(db, runtimeState.tenantId, 'Compatibility Client');
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

    const result = await invokeAction('time.create_entry', {
      user_id: entryUserId,
      start: '2026-04-02T06:30:00.000Z',
      duration_minutes: 60,
      billable: true,
      service_id: serviceId,
      billing_plan_id: assignment.contractLineId,
      link: {
        type: 'ticket',
        id: ticketId,
      },
      notes: 'Compatibility alias test',
    });

    expect(result.time_entry.contract_line_id).toBe(assignment.contractLineId);
    expect(result.time_entry.time_sheet_id).toBeTruthy();
    expect(result.time_entry.work_date).toBe('2026-04-01');
    expect(result.time_entry.work_timezone).toBe('America/Los_Angeles');
  });
});
