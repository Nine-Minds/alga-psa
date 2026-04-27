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
        nodePath: ctx?.stepPath ?? 'steps.project-action',
        at: new Date().toISOString(),
      };
    },
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerProjectActions } from '../businessOperations/projects';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.project-action',
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

async function getTableColumns(db: Knex, tableName: string): Promise<Set<string>> {
  const rows = await db('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: tableName });
  return new Set(rows.map((row: { column_name: string }) => row.column_name));
}

async function createClientOrCompany(db: Knex, tenantId: string): Promise<{ clientId: string; companyId: string }> {
  const nowIso = new Date().toISOString();
  const id = uuidv4();

  const hasClients = await db.schema.hasTable('clients');
  if (hasClients) {
    const clientColumns = await getTableColumns(db, 'clients');
    const row: Record<string, unknown> = {
      tenant: tenantId,
      client_id: id,
      client_name: `Client ${id.slice(0, 6)}`,
      created_at: nowIso,
      updated_at: nowIso,
    };
    if (clientColumns.has('billing_cycle')) row.billing_cycle = 'monthly';
    if (clientColumns.has('is_tax_exempt')) row.is_tax_exempt = false;
    if (clientColumns.has('url')) row.url = '';
    if (clientColumns.has('is_inactive')) row.is_inactive = false;
    if (clientColumns.has('credit_balance')) row.credit_balance = 0;
    if (clientColumns.has('properties')) row.properties = {};

    await db('clients').insert(row);
    return { clientId: id, companyId: id };
  }

  const companyColumns = await getTableColumns(db, 'companies');
  const companyRow: Record<string, unknown> = {
    tenant: tenantId,
    company_id: id,
    company_name: `Company ${id.slice(0, 6)}`,
    created_at: nowIso,
    updated_at: nowIso,
  };
  if (companyColumns.has('url')) companyRow.url = '';
  if (companyColumns.has('properties')) companyRow.properties = {};

  await db('companies').insert(companyRow);
  return { clientId: id, companyId: id };
}

async function ensureStatusId(
  db: Knex,
  tenantId: string,
  statusType: 'project' | 'project_task',
  fallbackName: string,
  createdByUserId: string
): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: statusType })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const statusId = uuidv4();
  const statusColumns = await getTableColumns(db, 'statuses');
  const row: Record<string, unknown> = {
    tenant: tenantId,
    status_id: statusId,
    status_type: statusType,
    created_at: new Date().toISOString(),
  };
  if (statusColumns.has('status_name')) row.status_name = fallbackName;
  if (statusColumns.has('name')) row.name = fallbackName;
  if (statusColumns.has('order_number')) row.order_number = 1;
  if (statusColumns.has('display_order')) row.display_order = 1;
  if (statusColumns.has('created_by')) row.created_by = createdByUserId;
  if (statusColumns.has('updated_at')) row.updated_at = new Date().toISOString();
  if (statusColumns.has('is_closed')) row.is_closed = false;
  if (statusColumns.has('is_default')) row.is_default = true;
  if (statusColumns.has('is_inactive')) row.is_inactive = false;

  await db('statuses').insert(row);
  return statusId;
}

async function createProject(
  db: Knex,
  tenantId: string,
  options: {
    name: string;
    clientOrCompanyId: string;
    assignedTo?: string | null;
    description?: string | null;
    wbsCode?: string;
    createdByUserId?: string;
  }
): Promise<string> {
  const projectId = uuidv4();
  const nowIso = new Date().toISOString();
  const columns = await getTableColumns(db, 'projects');

  const row: Record<string, unknown> = {
    tenant: tenantId,
    project_id: projectId,
    project_name: options.name,
    description: options.description ?? null,
    wbs_code: options.wbsCode ?? `P-${projectId.slice(0, 4)}`,
    updated_at: nowIso,
    created_at: nowIso,
  };

  if (columns.has('client_id')) row.client_id = options.clientOrCompanyId;
  if (columns.has('company_id')) row.company_id = options.clientOrCompanyId;
  if (columns.has('status')) {
    const createdByUserId = options.createdByUserId ?? runtimeState.actorUserId;
    row.status = await ensureStatusId(db, tenantId, 'project', 'Open', createdByUserId);
    if (!createdByUserId) {
      throw new Error('createdByUserId is required to build project status fixtures');
    }
  }
  if (columns.has('assigned_to')) row.assigned_to = options.assignedTo ?? null;
  if (columns.has('project_number')) row.project_number = `PRJ-${projectId.slice(0, 8).toUpperCase()}`;
  if (columns.has('is_inactive')) row.is_inactive = false;
  if (columns.has('client_portal_config')) row.client_portal_config = JSON.stringify({});

  await db('projects').insert(row);
  return projectId;
}

async function createPhase(
  db: Knex,
  tenantId: string,
  projectId: string,
  options: { name: string; orderNumber?: number; orderKey?: string; status?: string }
): Promise<string> {
  const phaseId = uuidv4();
  const nowIso = new Date().toISOString();
  const columns = await getTableColumns(db, 'project_phases');

  const row: Record<string, unknown> = {
    tenant: tenantId,
    phase_id: phaseId,
    project_id: projectId,
    phase_name: options.name,
    description: null,
    wbs_code: `1.${Math.max(options.orderNumber ?? 1, 1)}`,
    created_at: nowIso,
    updated_at: nowIso,
  };

  if (columns.has('status')) row.status = options.status ?? 'planned';
  if (columns.has('order_number')) row.order_number = options.orderNumber ?? 1;
  if (columns.has('order_key')) row.order_key = options.orderKey ?? `a${Math.max((options.orderNumber ?? 1) - 1, 0)}`;

  await db('project_phases').insert(row);
  return phaseId;
}

async function createTask(
  db: Knex,
  tenantId: string,
  phaseId: string,
  projectId: string,
  options: {
    taskName: string;
    assignedTo?: string | null;
    statusId?: string | null;
    projectStatusMappingId?: string | null;
    orderKey?: string;
  }
): Promise<string> {
  const taskId = uuidv4();
  const nowIso = new Date().toISOString();
  const columns = await getTableColumns(db, 'project_tasks');

  const row: Record<string, unknown> = {
    tenant: tenantId,
    task_id: taskId,
    phase_id: phaseId,
    task_name: options.taskName,
    description: null,
    assigned_to: options.assignedTo ?? null,
    wbs_code: `1.1.${taskId.slice(0, 2)}`,
    created_at: nowIso,
    updated_at: nowIso,
  };

  if (columns.has('status_id')) row.status_id = options.statusId ?? null;
  if (columns.has('project_status_mapping_id')) row.project_status_mapping_id = options.projectStatusMappingId ?? null;
  if (columns.has('order_key')) row.order_key = options.orderKey ?? 'a0';

  await db('project_tasks').insert(row);

  if (columns.has('project_status_mapping_id') && !options.projectStatusMappingId) {
    const statusMappingId = uuidv4();
    const projectTaskStatusId = options.statusId ?? await ensureStatusId(db, tenantId, 'project_task', 'To Do', runtimeState.actorUserId);
    await db('project_status_mappings').insert({
      tenant: tenantId,
      project_status_mapping_id: statusMappingId,
      project_id: projectId,
      status_id: projectTaskStatusId,
      standard_status_id: null,
      custom_name: 'Open',
      display_order: 1,
      is_visible: true,
      is_standard: false,
    });
    const updatePayload: Record<string, unknown> = { project_status_mapping_id: statusMappingId };
    if (columns.has('status_id') && !options.statusId) {
      updatePayload.status_id = projectTaskStatusId;
    }
    await db('project_tasks').where({ tenant: tenantId, task_id: taskId }).update(updatePayload);
  }

  return taskId;
}

describe('project business operation db actions', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;

    const registry = getActionRegistryV2();
    if (!registry.get('projects.search_tasks', 1)) {
      registerProjectActions();
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
    runtimeState.tenantId = await createTenant(db, 'Project Test Tenant');
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId, { email: `actor-${Date.now()}@example.com` });
  });

  it('T002: projects.find/search return tenant-scoped results with not-found and pagination metadata', async () => {
    const tenantA = runtimeState.tenantId;
    const tenantB = await createTenant(db, 'Other Project Tenant');
    const tenantBActor = await createUser(db, tenantB, { email: 'tenant-b-actor@example.com' });

    const entityA = await createClientOrCompany(db, tenantA);
    const entityB = await createClientOrCompany(db, tenantB);

    const projectA1 = await createProject(db, tenantA, {
      name: 'Alpha Migration',
      clientOrCompanyId: entityA.clientId,
      assignedTo: runtimeState.actorUserId,
      description: 'Primary alpha project',
      wbsCode: '1',
    });

    await createProject(db, tenantA, {
      name: 'Alpha Follow-up',
      clientOrCompanyId: entityA.clientId,
      description: 'Secondary alpha project',
      wbsCode: '2',
    });

    await createProject(db, tenantB, {
      name: 'Alpha Hidden',
      clientOrCompanyId: entityB.clientId,
      description: 'Should never appear for tenant A',
      wbsCode: '1',
      createdByUserId: tenantBActor,
    });

    const findResult = await invokeAction('projects.find', { project_id: projectA1 });
    expect(findResult.project.project_id).toBe(projectA1);
    expect(findResult.project.project_name).toBe('Alpha Migration');

    const findByName = await invokeAction('projects.find', { name: 'alpha migration' });
    expect(findByName.project.project_id).toBe(projectA1);

    const notFoundResult = await invokeAction('projects.find', { name: 'does-not-exist' });
    expect(notFoundResult.project).toBeNull();

    await expect(invokeAction('projects.find', { name: 'does-not-exist', on_not_found: 'error' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const searchPage1 = await invokeAction('projects.search', {
      query: 'Alpha',
      page: 1,
      page_size: 1,
    });

    expect(searchPage1.total).toBe(2);
    expect(searchPage1.projects).toHaveLength(1);
    expect(searchPage1.first_project.project_name).toMatch(/Alpha/);

    const searchPage2 = await invokeAction('projects.search', {
      query: 'Alpha',
      page: 2,
      page_size: 1,
    });

    expect(searchPage2.total).toBe(2);
    expect(searchPage2.projects).toHaveLength(1);
    expect(searchPage2.projects[0].project_id).not.toBe(searchPage1.projects[0].project_id);
  });

  it('T003: projects.find_phase/search_phases enforce project scope, deterministic ordering, and not-found mode', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Phase Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '9',
    });

    const phaseA = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Planning',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const phaseB = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Execution',
      orderNumber: 2,
      orderKey: 'a1',
    });

    const findById = await invokeAction('projects.find_phase', { phase_id: phaseA });
    expect(findById.phase.phase_id).toBe(phaseA);

    const findByName = await invokeAction('projects.find_phase', {
      project_id: projectId,
      name: 'execution',
    });
    expect(findByName.phase.phase_id).toBe(phaseB);

    await expect(invokeAction('projects.find_phase', {
      project_id: projectId,
      name: 'missing',
      on_not_found: 'error',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const searchResult = await invokeAction('projects.search_phases', {
      project_id: projectId,
      page: 1,
      page_size: 10,
    });

    expect(searchResult.total).toBe(2);
    expect(searchResult.first_phase.phase_id).toBe(phaseA);
    expect(searchResult.phases.map((phase: any) => phase.phase_id)).toEqual([phaseA, phaseB]);
  });

  it('T004: projects.find_task/search_tasks support project/phase/status/assignee filters and pagination metadata', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Task Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '10',
    });

    const phaseA = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Build',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const phaseB = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Deploy',
      orderNumber: 2,
      orderKey: 'a1',
    });

    const assigneeA = await createUser(db, runtimeState.tenantId, { email: 'assignee-a@example.com' });
    const assigneeB = await createUser(db, runtimeState.tenantId, { email: 'assignee-b@example.com' });

    const statusA = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'To Do', runtimeState.actorUserId);
    const statusB = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'In Progress', runtimeState.actorUserId);

    const taskA = await createTask(db, runtimeState.tenantId, phaseA, projectId, {
      taskName: 'Build API endpoint',
      assignedTo: assigneeA,
      statusId: statusA,
      orderKey: 'a0',
    });

    await createTask(db, runtimeState.tenantId, phaseB, projectId, {
      taskName: 'Deploy API endpoint',
      assignedTo: assigneeB,
      statusId: statusB,
      orderKey: 'a1',
    });

    const findResult = await invokeAction('projects.find_task', {
      project_id: projectId,
      phase_id: phaseA,
      name: 'build api endpoint',
    });
    expect(findResult.task.task_id).toBe(taskA);
    expect(findResult.task.phase_id).toBe(phaseA);

    const searchByQuery = await invokeAction('projects.search_tasks', {
      query: 'API endpoint',
      page: 1,
      page_size: 1,
    });
    expect(searchByQuery.total).toBe(2);
    expect(searchByQuery.tasks).toHaveLength(1);
    expect(searchByQuery.first_task.task_name).toContain('API endpoint');

    const byFilters = await invokeAction('projects.search_tasks', {
      filters: {
        project_id: projectId,
        phase_id: phaseA,
        assigned_to: assigneeA,
        status_id: statusA,
      },
      page: 1,
      page_size: 10,
    });

    expect(byFilters.total).toBe(1);
    expect(byFilters.first_task.task_id).toBe(taskA);
    expect(byFilters.tasks[0].assigned_to).toBe(assigneeA);
  });
});
