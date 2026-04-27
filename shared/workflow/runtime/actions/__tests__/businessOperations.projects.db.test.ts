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

async function createProjectStatusMapping(
  db: Knex,
  tenantId: string,
  projectId: string,
  options: {
    statusId?: string | null;
    customName?: string;
    displayOrder?: number;
    isVisible?: boolean;
  } = {}
): Promise<string> {
  const mappingId = uuidv4();
  await db('project_status_mappings').insert({
    tenant: tenantId,
    project_status_mapping_id: mappingId,
    project_id: projectId,
    status_id: options.statusId ?? null,
    standard_status_id: null,
    custom_name: options.customName ?? 'Workflow Status',
    display_order: options.displayOrder ?? 1,
    is_visible: options.isVisible ?? true,
    is_standard: false,
  });
  return mappingId;
}

async function createTicket(
  db: Knex,
  tenantId: string,
  actorUserId: string,
  options: { clientId?: string } = {}
): Promise<string> {
  const ticketId = uuidv4();
  const nowIso = new Date().toISOString();
  const columns = await getTableColumns(db, 'tickets');
  const row: Record<string, unknown> = {
    tenant: tenantId,
    ticket_id: ticketId,
  };

  if (columns.has('created_at')) row.created_at = nowIso;
  if (columns.has('updated_at')) row.updated_at = nowIso;
  if (columns.has('ticket_number')) row.ticket_number = `T-${ticketId.slice(0, 8)}`;
  if (columns.has('title')) row.title = 'Workflow move task test ticket';
  if (columns.has('description')) row.description = 'Test ticket for project_ticket_links update validation';
  if (columns.has('client_id')) row.client_id = options.clientId ?? null;
  if (columns.has('company_id')) row.company_id = options.clientId ?? null;
  if (columns.has('entered_by')) row.entered_by = actorUserId;
  if (columns.has('opened_by')) row.opened_by = actorUserId;
  if (columns.has('updated_by')) row.updated_by = actorUserId;
  if (columns.has('category')) row.category = 'Incident';
  if (columns.has('urgency')) row.urgency = 'medium';
  if (columns.has('impact')) row.impact = 'medium';
  if (columns.has('is_closed')) row.is_closed = false;
  if (columns.has('is_inactive')) row.is_inactive = false;

  await db('tickets').insert(row);
  return ticketId;
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

  it('T006: projects.update/update_phase/update_task apply name+description changes and write workflow audits', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Initial Project Name',
      clientOrCompanyId: entity.clientId,
      description: 'Initial description',
      wbsCode: '20',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Initial Phase Name',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Initial Task Name',
    });

    const updatedProject = await invokeAction('projects.update', {
      project_id: projectId,
      patch: { project_name: 'Updated Project Name', description: 'Updated project description' },
    });
    expect(updatedProject.no_op).toBe(false);
    expect(updatedProject.changed_fields).toEqual(expect.arrayContaining(['project_name', 'description']));
    expect(updatedProject.project.project_name).toBe('Updated Project Name');
    expect(updatedProject.project.description).toBe('Updated project description');

    const updatedPhase = await invokeAction('projects.update_phase', {
      phase_id: phaseId,
      patch: { phase_name: 'Updated Phase Name', description: 'Updated phase description' },
    });
    expect(updatedPhase.no_op).toBe(false);
    expect(updatedPhase.changed_fields).toEqual(expect.arrayContaining(['phase_name', 'description']));
    expect(updatedPhase.phase.phase_name).toBe('Updated Phase Name');

    const updatedTask = await invokeAction('projects.update_task', {
      task_id: taskId,
      patch: { task_name: 'Updated Task Name', description: 'Updated task description' },
    });
    expect(updatedTask.no_op).toBe(false);
    expect(updatedTask.changed_fields).toEqual(expect.arrayContaining(['task_name', 'description']));
    expect(updatedTask.task.task_name).toBe('Updated Task Name');
    expect(updatedTask.task.description).toBe('Updated task description');

    const audits = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, user_id: runtimeState.actorUserId, table_name: 'workflow_runs' })
      .whereIn('operation', [
        'workflow_action:projects.update',
        'workflow_action:projects.update_phase',
        'workflow_action:projects.update_task',
      ])
      .select('operation');

    const operations = audits.map((audit: { operation: string }) => audit.operation);
    expect(operations).toEqual(expect.arrayContaining([
      'workflow_action:projects.update',
      'workflow_action:projects.update_phase',
      'workflow_action:projects.update_task',
    ]));
  });

  it('T007: update actions reject empty patches, missing targets, and permission-denied updates without mutation', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Validation Project',
      clientOrCompanyId: entity.clientId,
      description: 'Validation project description',
      wbsCode: '21',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Validation Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Validation Task',
    });

    const updateProjectAction = getAction('projects.update');
    const updatePhaseAction = getAction('projects.update_phase');
    const updateTaskAction = getAction('projects.update_task');

    expect(() => updateProjectAction.inputSchema.parse({ project_id: projectId, patch: {} })).toThrow();
    expect(() => updatePhaseAction.inputSchema.parse({ phase_id: phaseId, patch: {} })).toThrow();
    expect(() => updateTaskAction.inputSchema.parse({ task_id: taskId, patch: {} })).toThrow();

    await expect(invokeAction('projects.update', {
      project_id: uuidv4(),
      patch: { project_name: 'Nope' },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(invokeAction('projects.update_phase', {
      phase_id: uuidv4(),
      patch: { phase_name: 'Nope' },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(invokeAction('projects.update_task', {
      task_id: uuidv4(),
      patch: { task_name: 'Nope' },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    runtimeState.deniedPermissions.add('project:update');
    await expect(invokeAction('projects.update', {
      project_id: projectId,
      patch: { project_name: 'Denied Name' },
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    runtimeState.deniedPermissions.clear();

    const projectAfterDenied = await db('projects')
      .where({ tenant: runtimeState.tenantId, project_id: projectId })
      .first('project_name');
    expect(projectAfterDenied?.project_name).toBe('Validation Project');
  });

  it('T008: projects.move_task same-project move remaps status mapping, updates WBS/order metadata, and audits', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Move Same Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '30',
    });
    const phaseSource = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Source Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const phaseTarget = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Target Phase',
      orderNumber: 2,
      orderKey: 'a1',
    });

    const sourceStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Source To Do', runtimeState.actorUserId);
    const targetStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Target In Progress', runtimeState.actorUserId);
    const sourceMapping = await createProjectStatusMapping(db, runtimeState.tenantId, projectId, {
      statusId: sourceStatusId,
      customName: 'Source Mapping',
      displayOrder: 2,
    });
    const targetMapping = await createProjectStatusMapping(db, runtimeState.tenantId, projectId, {
      statusId: targetStatusId,
      customName: 'Target Mapping',
      displayOrder: 1,
    });

    const taskId = await createTask(db, runtimeState.tenantId, phaseSource, projectId, {
      taskName: 'Move Same Task',
      statusId: sourceStatusId,
      projectStatusMappingId: sourceMapping,
      orderKey: 'a0',
    });

    const beforeTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('wbs_code', 'order_key', 'phase_id');

    const moved = await invokeAction('projects.move_task', {
      task_id: taskId,
      target_phase_id: phaseTarget,
    });

    expect(moved.previous_phase_id).toBe(phaseSource);
    expect(moved.current_phase_id).toBe(phaseTarget);
    expect(moved.current_project_id).toBe(projectId);
    expect(moved.current_project_status_mapping_id).toBeTruthy();
    expect(moved.current_status_id).toBeTruthy();
    expect(moved.wbs_code).not.toBe(beforeTask?.wbs_code ?? null);
    expect(moved.order_key).not.toBe(beforeTask?.order_key ?? null);

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:projects.move_task' })
      .orderBy('timestamp', 'desc')
      .first('details');
    expect(audit).toBeDefined();
  });

  it('T009: projects.move_task cross-project move remaps status mapping and updates project_ticket_links context', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const sourceProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Source Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '31',
    });
    const targetProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Target Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '32',
    });

    const sourcePhase = await createPhase(db, runtimeState.tenantId, sourceProjectId, {
      name: 'Source Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const targetPhase = await createPhase(db, runtimeState.tenantId, targetProjectId, {
      name: 'Target Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });

    const sourceStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Source Status', runtimeState.actorUserId);
    const targetStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Target Status', runtimeState.actorUserId);

    await createProjectStatusMapping(db, runtimeState.tenantId, sourceProjectId, {
      statusId: sourceStatusId,
      customName: 'Source Map',
      displayOrder: 1,
    });
    const targetMapping = await createProjectStatusMapping(db, runtimeState.tenantId, targetProjectId, {
      statusId: targetStatusId,
      customName: 'Target Map',
      displayOrder: 1,
    });

    const taskId = await createTask(db, runtimeState.tenantId, sourcePhase, sourceProjectId, {
      taskName: 'Cross Project Task',
      statusId: sourceStatusId,
      orderKey: 'a0',
    });

    const linkId = uuidv4();
    const ticketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    await db('project_ticket_links').insert({
      tenant: runtimeState.tenantId,
      link_id: linkId,
      project_id: sourceProjectId,
      phase_id: sourcePhase,
      task_id: taskId,
      ticket_id: ticketId,
      created_at: new Date().toISOString(),
    });

    const moved = await invokeAction('projects.move_task', {
      task_id: taskId,
      target_phase_id: targetPhase,
      target_project_id: targetProjectId,
    });

    expect(moved.current_project_id).toBe(targetProjectId);
    expect(moved.current_phase_id).toBe(targetPhase);
    expect(moved.current_project_status_mapping_id).toBe(targetMapping);

    const updatedLink = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, link_id: linkId })
      .first('project_id', 'phase_id');
    expect(updatedLink?.project_id).toBe(targetProjectId);
    expect(updatedLink?.phase_id).toBe(targetPhase);
  });

  it('T010: projects.move_task rejects missing task, missing phase, and invalid explicit status mapping', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Move Validation Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '33',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Validation Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Validation Move Task',
    });

    await expect(invokeAction('projects.move_task', {
      task_id: uuidv4(),
      target_phase_id: phaseId,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(invokeAction('projects.move_task', {
      task_id: taskId,
      target_phase_id: uuidv4(),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(invokeAction('projects.move_task', {
      task_id: taskId,
      target_phase_id: phaseId,
      target_project_status_mapping_id: uuidv4(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
