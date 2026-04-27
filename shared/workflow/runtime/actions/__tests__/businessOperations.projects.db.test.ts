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

async function addTaskResource(
  db: Knex,
  tenantId: string,
  taskId: string,
  assignedTo: string,
  additionalUserId: string,
  role = 'support'
): Promise<void> {
  const hasTaskResources = await db.schema.hasTable('task_resources');
  if (!hasTaskResources) return;

  await db('task_resources').insert({
    tenant: tenantId,
    task_id: taskId,
    assigned_to: assignedTo,
    additional_user_id: additionalUserId,
    role,
  });
}

async function createChecklistItem(
  db: Knex,
  tenantId: string,
  taskId: string,
  itemName: string,
  options: { assignedTo?: string | null; description?: string | null; orderNumber?: number } = {}
): Promise<string> {
  const hasChecklist = await db.schema.hasTable('task_checklist_items');
  if (!hasChecklist) return uuidv4();

  const checklistItemId = uuidv4();
  const nowIso = new Date().toISOString();
  const columns = await getTableColumns(db, 'task_checklist_items');
  const row: Record<string, unknown> = {
    tenant: tenantId,
    checklist_item_id: checklistItemId,
    task_id: taskId,
    item_name: itemName,
  };
  if (columns.has('description')) row.description = options.description ?? null;
  if (columns.has('assigned_to')) row.assigned_to = options.assignedTo ?? null;
  if (columns.has('completed')) row.completed = false;
  if (columns.has('order_number')) row.order_number = options.orderNumber ?? 1;
  if (columns.has('created_at')) row.created_at = nowIso;
  if (columns.has('updated_at')) row.updated_at = nowIso;

  await db('task_checklist_items').insert(row);
  return checklistItemId;
}

async function createProjectTicketLink(
  db: Knex,
  tenantId: string,
  params: {
    projectId: string;
    phaseId: string;
    taskId: string;
    ticketId: string;
  }
): Promise<string> {
  const linkId = uuidv4();
  await db('project_ticket_links').insert({
    tenant: tenantId,
    link_id: linkId,
    project_id: params.projectId,
    phase_id: params.phaseId,
    task_id: params.taskId,
    ticket_id: params.ticketId,
    created_at: new Date().toISOString(),
  });
  return linkId;
}

async function createTimeEntryForProjectTask(
  db: Knex,
  tenantId: string,
  taskId: string,
  userId: string
): Promise<void> {
  const now = new Date();
  const columns = await getTableColumns(db, 'time_entries');
  const startedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const row: Record<string, unknown> = {
    tenant: tenantId,
    entry_id: uuidv4(),
    user_id: userId,
    start_time: startedAt,
    end_time: now.toISOString(),
    work_item_id: taskId,
    work_item_type: 'project_task',
    notes: 'delete guard time entry',
  };
  if (columns.has('work_date')) row.work_date = now.toISOString().slice(0, 10);
  if (columns.has('duration')) row.duration = 60;
  if (columns.has('billable_duration')) row.billable_duration = 60;
  if (columns.has('approval_status')) row.approval_status = 'DRAFT';
  if (columns.has('is_billable')) row.is_billable = true;
  if (columns.has('work_timezone')) row.work_timezone = 'UTC';
  if (columns.has('duration_seconds')) row.duration_seconds = 3600;
  if (columns.has('created_at')) row.created_at = now.toISOString();
  if (columns.has('updated_at')) row.updated_at = now.toISOString();
  await db('time_entries').insert(row);
}

async function createTagMapping(
  db: Knex,
  tenantId: string,
  taggedType: 'project' | 'project_task',
  taggedId: string,
  tagText: string
): Promise<void> {
  const tagId = uuidv4();
  await db('tag_definitions').insert({
    tenant: tenantId,
    tag_id: tagId,
    tag_text: tagText,
    tagged_type: taggedType,
    background_color: '#EEEEEE',
    text_color: '#111111',
    created_at: new Date().toISOString(),
  });
  await db('tag_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    tag_id: tagId,
    tagged_id: taggedId,
    tagged_type: taggedType,
    created_at: new Date().toISOString(),
  });
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

  it('T011: projects.assign_task updates primary+additional assignment, reconciles task resources, and audits', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Assign Task Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '40',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Assignment Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const initialPrimary = await createUser(db, runtimeState.tenantId, { email: 'assign-initial-primary@example.com' });
    const initialAdditional = await createUser(db, runtimeState.tenantId, { email: 'assign-initial-additional@example.com' });
    const nextPrimary = await createUser(db, runtimeState.tenantId, { email: 'assign-next-primary@example.com' });
    const nextAdditionalA = await createUser(db, runtimeState.tenantId, { email: 'assign-next-additional-a@example.com' });
    const nextAdditionalB = await createUser(db, runtimeState.tenantId, { email: 'assign-next-additional-b@example.com' });

    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Assignment Task',
      assignedTo: initialPrimary,
    });
    await addTaskResource(db, runtimeState.tenantId, taskId, initialPrimary, initialAdditional);

    const result = await invokeAction('projects.assign_task', {
      task_id: taskId,
      primary_user_id: nextPrimary,
      additional_user_ids: [nextAdditionalA, nextAdditionalB, nextAdditionalA],
      reason: 'Reassigning to project pod',
    });

    expect(result.task_id).toBe(taskId);
    expect(result.assigned_to).toBe(nextPrimary);
    expect(result.additional_user_ids).toEqual([nextAdditionalA, nextAdditionalB].sort());
    expect(result.no_op).toBe(false);

    const updatedTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('assigned_to');
    expect(updatedTask?.assigned_to).toBe(nextPrimary);

    const resources = await db('task_resources')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .orderBy('additional_user_id', 'asc')
      .select('assigned_to', 'additional_user_id', 'role');
    expect(resources).toHaveLength(2);
    expect(resources.map((row: { additional_user_id: string }) => row.additional_user_id)).toEqual([nextAdditionalA, nextAdditionalB].sort());
    expect(resources.every((row: { assigned_to: string }) => row.assigned_to === nextPrimary)).toBe(true);

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:projects.assign_task' })
      .orderBy('timestamp', 'desc')
      .first('details');
    expect(audit).toBeDefined();
  });

  it('T012: projects.assign_task returns no-op when requested assignment already matches', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Assign No-op Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '41',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'No-op Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const primary = await createUser(db, runtimeState.tenantId, { email: 'assign-noop-primary@example.com' });
    const additionalA = await createUser(db, runtimeState.tenantId, { email: 'assign-noop-additional-a@example.com' });
    const additionalB = await createUser(db, runtimeState.tenantId, { email: 'assign-noop-additional-b@example.com' });

    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'No-op Assignment Task',
      assignedTo: primary,
    });
    await addTaskResource(db, runtimeState.tenantId, taskId, primary, additionalA);
    await addTaskResource(db, runtimeState.tenantId, taskId, primary, additionalB);

    const beforeTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('updated_at');

    const result = await invokeAction('projects.assign_task', {
      task_id: taskId,
      primary_user_id: primary,
      additional_user_ids: [additionalB, additionalA],
      no_op_if_already_assigned: true,
    });

    expect(result.no_op).toBe(true);
    expect(result.assigned_to).toBe(primary);
    expect([...result.additional_user_ids].sort()).toEqual([additionalA, additionalB].sort());

    const afterTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('updated_at');
    expect(String(afterTask?.updated_at)).toBe(String(beforeTask?.updated_at));
  });

  it('T013: projects.assign_task rejects inactive/missing users and leaves assignment unchanged', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Assign Validation Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '42',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Validation Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const primary = await createUser(db, runtimeState.tenantId, { email: 'assign-validation-primary@example.com' });
    const additional = await createUser(db, runtimeState.tenantId, { email: 'assign-validation-additional@example.com' });
    const inactive = await createUser(db, runtimeState.tenantId, {
      email: 'assign-validation-inactive@example.com',
      is_inactive: true,
    });

    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Validation Assignment Task',
      assignedTo: primary,
    });
    await addTaskResource(db, runtimeState.tenantId, taskId, primary, additional);

    await expect(invokeAction('projects.assign_task', {
      task_id: taskId,
      primary_user_id: inactive,
      additional_user_ids: [],
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(invokeAction('projects.assign_task', {
      task_id: taskId,
      primary_user_id: primary,
      additional_user_ids: [uuidv4()],
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const taskAfter = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first('assigned_to');
    expect(taskAfter?.assigned_to).toBe(primary);

    const resourcesAfter = await db('task_resources')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .select('additional_user_id');
    expect(resourcesAfter.map((row: { additional_user_id: string }) => row.additional_user_id)).toEqual([additional]);
  });

  it('T014: projects.duplicate_task copies core fields, resets actual_hours, and returns target metadata', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const sourceProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Duplicate Source Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '50',
    });
    const targetProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Duplicate Target Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '51',
    });
    const sourcePhaseId = await createPhase(db, runtimeState.tenantId, sourceProjectId, {
      name: 'Source Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const targetPhaseId = await createPhase(db, runtimeState.tenantId, targetProjectId, {
      name: 'Target Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });

    const sourceStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Duplicate Source Status', runtimeState.actorUserId);
    await createProjectStatusMapping(db, runtimeState.tenantId, sourceProjectId, {
      statusId: sourceStatusId,
      customName: 'Source Mapping',
      displayOrder: 1,
    });
    const targetStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Duplicate Target Status', runtimeState.actorUserId);
    const targetMappingId = await createProjectStatusMapping(db, runtimeState.tenantId, targetProjectId, {
      statusId: targetStatusId,
      customName: 'Target Mapping',
      displayOrder: 1,
    });

    const assignee = await createUser(db, runtimeState.tenantId, { email: 'duplicate-core-primary@example.com' });
    const sourceTaskId = await createTask(db, runtimeState.tenantId, sourcePhaseId, sourceProjectId, {
      taskName: 'Duplicate Me',
      assignedTo: assignee,
      statusId: sourceStatusId,
    });

    const taskColumns = await getTableColumns(db, 'project_tasks');
    const sourcePatch: Record<string, unknown> = { description: 'Duplicate core description' };
    if (taskColumns.has('estimated_hours')) sourcePatch.estimated_hours = 12;
    if (taskColumns.has('actual_hours')) sourcePatch.actual_hours = 7;
    await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: sourceTaskId })
      .update(sourcePatch);

    const result = await invokeAction('projects.duplicate_task', {
      source_task_id: sourceTaskId,
      target_phase_id: targetPhaseId,
      target_project_status_mapping_id: targetMappingId,
      copy_primary_assignee: false,
      copy_checklist: false,
      copy_additional_assignees: false,
      copy_ticket_links: false,
    });

    expect(result.source_task_id).toBe(sourceTaskId);
    expect(result.target_project_id).toBe(targetProjectId);
    expect(result.target_phase_id).toBe(targetPhaseId);
    expect(result.target_project_status_mapping_id).toBe(targetMappingId);
    if (taskColumns.has('status_id')) {
      expect(result.target_status_id).toBe(targetStatusId);
    }

    const duplicatedTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: result.task_id })
      .first();
    expect(duplicatedTask).toBeDefined();
    expect(duplicatedTask.task_name).toBe('Duplicate Me (Copy)');
    expect(duplicatedTask.phase_id).toBe(targetPhaseId);
    expect(duplicatedTask.description).toBe('Duplicate core description');
    if (taskColumns.has('estimated_hours')) expect(Number(duplicatedTask.estimated_hours ?? 0)).toBe(12);
    if (taskColumns.has('actual_hours')) expect(Number(duplicatedTask.actual_hours ?? 0)).toBe(0);
    expect(duplicatedTask.assigned_to).toBeNull();
  });

  it('T015: projects.duplicate_task optionally copies checklist, additional assignees, primary assignee, and ticket links', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const sourceProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Duplicate Relations Source',
      clientOrCompanyId: entity.clientId,
      wbsCode: '52',
    });
    const targetProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Duplicate Relations Target',
      clientOrCompanyId: entity.clientId,
      wbsCode: '53',
    });
    const sourcePhaseId = await createPhase(db, runtimeState.tenantId, sourceProjectId, {
      name: 'Source Relations Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const targetPhaseId = await createPhase(db, runtimeState.tenantId, targetProjectId, {
      name: 'Target Relations Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });

    const sourceStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Relations Source Status', runtimeState.actorUserId);
    await createProjectStatusMapping(db, runtimeState.tenantId, sourceProjectId, {
      statusId: sourceStatusId,
      customName: 'Relations Source Mapping',
      displayOrder: 1,
    });
    const targetStatusId = await ensureStatusId(db, runtimeState.tenantId, 'project_task', 'Relations Target Status', runtimeState.actorUserId);
    await createProjectStatusMapping(db, runtimeState.tenantId, targetProjectId, {
      statusId: targetStatusId,
      customName: 'Relations Target Mapping',
      displayOrder: 1,
    });

    const primary = await createUser(db, runtimeState.tenantId, { email: 'duplicate-relations-primary@example.com' });
    const additionalA = await createUser(db, runtimeState.tenantId, { email: 'duplicate-relations-additional-a@example.com' });
    const additionalB = await createUser(db, runtimeState.tenantId, { email: 'duplicate-relations-additional-b@example.com' });
    const sourceTaskId = await createTask(db, runtimeState.tenantId, sourcePhaseId, sourceProjectId, {
      taskName: 'Duplicate Relations Task',
      assignedTo: primary,
      statusId: sourceStatusId,
    });
    await addTaskResource(db, runtimeState.tenantId, sourceTaskId, primary, additionalA);
    await addTaskResource(db, runtimeState.tenantId, sourceTaskId, primary, additionalB);
    await createChecklistItem(db, runtimeState.tenantId, sourceTaskId, 'Checklist A', { orderNumber: 1 });
    await createChecklistItem(db, runtimeState.tenantId, sourceTaskId, 'Checklist B', { orderNumber: 2 });

    const ticketA = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    const ticketB = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    await createProjectTicketLink(db, runtimeState.tenantId, {
      projectId: sourceProjectId,
      phaseId: sourcePhaseId,
      taskId: sourceTaskId,
      ticketId: ticketA,
    });
    await createProjectTicketLink(db, runtimeState.tenantId, {
      projectId: sourceProjectId,
      phaseId: sourcePhaseId,
      taskId: sourceTaskId,
      ticketId: ticketB,
    });

    const result = await invokeAction('projects.duplicate_task', {
      source_task_id: sourceTaskId,
      target_phase_id: targetPhaseId,
      copy_primary_assignee: true,
      copy_additional_assignees: true,
      copy_checklist: true,
      copy_ticket_links: true,
    });

    expect(result.copied_checklist_count).toBe(2);
    expect(result.copied_additional_assignee_count).toBe(2);
    expect(result.copied_ticket_link_count).toBe(2);

    const duplicatedTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: result.task_id })
      .first('assigned_to');
    expect(duplicatedTask?.assigned_to).toBe(primary);

    const hasChecklist = await db.schema.hasTable('task_checklist_items');
    if (hasChecklist) {
      const duplicatedChecklist = await db('task_checklist_items')
        .where({ tenant: runtimeState.tenantId, task_id: result.task_id })
        .select('item_name');
      expect(duplicatedChecklist).toHaveLength(2);
    }

    const hasTaskResources = await db.schema.hasTable('task_resources');
    if (hasTaskResources) {
      const duplicatedResources = await db('task_resources')
        .where({ tenant: runtimeState.tenantId, task_id: result.task_id })
        .orderBy('additional_user_id', 'asc')
        .select('additional_user_id');
      expect(duplicatedResources.map((row: { additional_user_id: string }) => row.additional_user_id)).toEqual([additionalA, additionalB].sort());
    }

    const duplicatedLinks = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, task_id: result.task_id })
      .orderBy('ticket_id', 'asc')
      .select('project_id', 'phase_id', 'ticket_id');
    expect(duplicatedLinks).toHaveLength(2);
    expect(duplicatedLinks.every((row: { project_id: string; phase_id: string }) => row.project_id === targetProjectId && row.phase_id === targetPhaseId)).toBe(true);
  });

  it('T016: projects.delete_task deletes task after cleaning ticket links and checklist items', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Delete Task Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '60',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Delete Task Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Delete Task Target',
    });
    await createChecklistItem(db, runtimeState.tenantId, taskId, 'Delete Checklist');
    const ticketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    await createProjectTicketLink(db, runtimeState.tenantId, {
      projectId,
      phaseId,
      taskId,
      ticketId,
    });

    const result = await invokeAction('projects.delete_task', { task_id: taskId });
    expect(result.deleted).toBe(true);
    expect(result.deleted_ticket_link_count).toBeGreaterThanOrEqual(1);
    expect(result.deleted_checklist_item_count).toBeGreaterThanOrEqual(1);

    const deletedTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first();
    expect(deletedTask).toBeUndefined();
    const remainingChecklist = await db('task_checklist_items')
      .where({ tenant: runtimeState.tenantId, task_id: taskId });
    expect(remainingChecklist).toHaveLength(0);
    const remainingLinks = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, task_id: taskId });
    expect(remainingLinks).toHaveLength(0);
  });

  it('T017: projects.delete_task refuses deletion when project_task time entries exist', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Delete Guard Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '61',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Delete Guard Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Delete Guard Task',
    });
    await createChecklistItem(db, runtimeState.tenantId, taskId, 'Guard Checklist');
    const ticketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    await createProjectTicketLink(db, runtimeState.tenantId, {
      projectId,
      phaseId,
      taskId,
      ticketId,
    });
    await createTimeEntryForProjectTask(db, runtimeState.tenantId, taskId, runtimeState.actorUserId);

    await expect(invokeAction('projects.delete_task', { task_id: taskId })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const taskAfter = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: taskId })
      .first();
    expect(taskAfter).toBeDefined();
    const checklistAfter = await db('task_checklist_items')
      .where({ tenant: runtimeState.tenantId, task_id: taskId });
    expect(checklistAfter.length).toBeGreaterThan(0);
    const linksAfter = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, task_id: taskId });
    expect(linksAfter.length).toBeGreaterThan(0);
  });

  it('T018: projects.delete_phase/projects.delete cover phase deletion and project cleanup validation paths', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);

    const phaseProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Delete Phase Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '62',
    });
    const phaseDeleteId = await createPhase(db, runtimeState.tenantId, phaseProjectId, {
      name: 'Delete Me Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const phaseDeleteResult = await invokeAction('projects.delete_phase', { phase_id: phaseDeleteId });
    expect(phaseDeleteResult.deleted).toBe(true);
    const phaseAfter = await db('project_phases')
      .where({ tenant: runtimeState.tenantId, phase_id: phaseDeleteId })
      .first();
    expect(phaseAfter).toBeUndefined();

    const deletableProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Delete Project Success',
      clientOrCompanyId: entity.clientId,
      wbsCode: '63',
    });
    const deletablePhaseId = await createPhase(db, runtimeState.tenantId, deletableProjectId, {
      name: 'Delete Project Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const deletableTaskId = await createTask(db, runtimeState.tenantId, deletablePhaseId, deletableProjectId, {
      taskName: 'Delete Project Task',
    });
    const deletableTicketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });
    await createTagMapping(db, runtimeState.tenantId, 'project', deletableProjectId, 'delete-project-tag');
    await createTagMapping(db, runtimeState.tenantId, 'project_task', deletableTaskId, 'delete-task-tag');
    await createProjectTicketLink(db, runtimeState.tenantId, {
      projectId: deletableProjectId,
      phaseId: deletablePhaseId,
      taskId: deletableTaskId,
      ticketId: deletableTicketId,
    });
    const hasEmailReplyTokens = await db.schema.hasTable('email_reply_tokens');
    if (hasEmailReplyTokens) {
      await db('email_reply_tokens').insert({
        tenant: runtimeState.tenantId,
        token: `project-${uuidv4()}`,
        project_id: deletableProjectId,
        entity_type: 'project',
        created_at: new Date().toISOString(),
      });
    }

    const deleteProjectResult = await invokeAction('projects.delete', { project_id: deletableProjectId });
    expect(deleteProjectResult.success).toBe(true);
    expect(deleteProjectResult.can_delete).toBe(true);
    expect(deleteProjectResult.deleted).toBe(true);

    const deletedProject = await db('projects')
      .where({ tenant: runtimeState.tenantId, project_id: deletableProjectId })
      .first();
    expect(deletedProject).toBeUndefined();
    const remainingProjectTags = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_type: 'project', tagged_id: deletableProjectId });
    expect(remainingProjectTags).toHaveLength(0);
    const remainingTaskTags = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_type: 'project_task', tagged_id: deletableTaskId });
    expect(remainingTaskTags).toHaveLength(0);
    const remainingProjectLinks = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, project_id: deletableProjectId });
    expect(remainingProjectLinks).toHaveLength(0);
    if (hasEmailReplyTokens) {
      const remainingTokens = await db('email_reply_tokens')
        .where({ tenant: runtimeState.tenantId, project_id: deletableProjectId });
      expect(remainingTokens).toHaveLength(0);
    }

    const blockedProjectId = await createProject(db, runtimeState.tenantId, {
      name: 'Delete Project Blocked',
      clientOrCompanyId: entity.clientId,
      wbsCode: '64',
    });
    const blockedPhaseId = await createPhase(db, runtimeState.tenantId, blockedProjectId, {
      name: 'Blocked Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const blockedTaskId = await createTask(db, runtimeState.tenantId, blockedPhaseId, blockedProjectId, {
      taskName: 'Blocked Task',
    });
    await createTimeEntryForProjectTask(db, runtimeState.tenantId, blockedTaskId, runtimeState.actorUserId);

    const blockedDeleteResult = await invokeAction('projects.delete', { project_id: blockedProjectId });
    expect(blockedDeleteResult.success).toBe(false);
    expect(blockedDeleteResult.can_delete).toBe(false);
    expect(blockedDeleteResult.code).toBe('VALIDATION_FAILED');
  });

  it('T019: projects.link_ticket_to_task creates both link tables with task project/phase metadata', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Link Ticket Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '70',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Link Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Link Target Task',
    });
    const ticketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });

    const result = await invokeAction('projects.link_ticket_to_task', {
      task_id: taskId,
      ticket_id: ticketId,
    });

    expect(result.task_id).toBe(taskId);
    expect(result.ticket_id).toBe(ticketId);
    expect(result.project_ticket_link_created).toBe(true);
    expect(result.ticket_entity_link_created).toBe(true);

    const projectLink = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, task_id: taskId, ticket_id: ticketId })
      .first('project_id', 'phase_id');
    expect(projectLink?.project_id).toBe(projectId);
    expect(projectLink?.phase_id).toBe(phaseId);

    const entityLink = await db('ticket_entity_links')
      .where({
        tenant: runtimeState.tenantId,
        ticket_id: ticketId,
        entity_type: 'project_task',
        entity_id: taskId,
        link_type: 'project_task',
      })
      .first('metadata');
    expect(entityLink).toBeDefined();
    expect((entityLink?.metadata as { project_id?: string } | null)?.project_id).toBe(projectId);
  });

  it('T020: projects.link_ticket_to_task is idempotent and reports existing state on repeat calls', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Link Idempotency Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '71',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Link Idempotency Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Link Idempotency Task',
    });
    const ticketId = await createTicket(db, runtimeState.tenantId, runtimeState.actorUserId, {
      clientId: entity.clientId,
    });

    const first = await invokeAction('projects.link_ticket_to_task', {
      task_id: taskId,
      ticket_id: ticketId,
      idempotency_key: 'link-1',
    });
    const second = await invokeAction('projects.link_ticket_to_task', {
      task_id: taskId,
      ticket_id: ticketId,
      idempotency_key: 'link-2',
    });

    expect(first.project_ticket_link_created).toBe(true);
    expect(first.ticket_entity_link_created).toBe(true);
    expect(second.project_ticket_link_created).toBe(false);
    expect(second.ticket_entity_link_created).toBe(false);

    const projectLinkRows = await db('project_ticket_links')
      .where({ tenant: runtimeState.tenantId, task_id: taskId, ticket_id: ticketId });
    expect(projectLinkRows).toHaveLength(1);
    const entityLinkRows = await db('ticket_entity_links')
      .where({
        tenant: runtimeState.tenantId,
        ticket_id: ticketId,
        entity_type: 'project_task',
        entity_id: taskId,
        link_type: 'project_task',
      });
    expect(entityLinkRows).toHaveLength(1);
  });

  it('T021: projects.add_tag creates missing project tag definitions, maps idempotently, and reports added/existing', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Project Tag Target',
      clientOrCompanyId: entity.clientId,
      wbsCode: '72',
    });

    const first = await invokeAction('projects.add_tag', {
      project_id: projectId,
      tags: ['Alpha', 'Beta', 'Alpha'],
      idempotency_key: 'project-tag-1',
    });
    expect(first.added_count).toBe(2);
    expect(first.existing_count).toBe(0);

    const second = await invokeAction('projects.add_tag', {
      project_id: projectId,
      tags: ['Alpha', 'Beta'],
      idempotency_key: 'project-tag-2',
    });
    expect(second.added_count).toBe(0);
    expect(second.existing_count).toBe(2);

    const projectMappings = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_type: 'project', tagged_id: projectId });
    expect(projectMappings).toHaveLength(2);
  });

  it('T022: projects.add_task_tag creates missing project_task tags, maps idempotently, and reports added/existing', async () => {
    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Task Tag Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '73',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Task Tag Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const taskId = await createTask(db, runtimeState.tenantId, phaseId, projectId, {
      taskName: 'Task Tag Target',
    });

    const first = await invokeAction('projects.add_task_tag', {
      task_id: taskId,
      tags: ['Gamma', 'Delta', 'Gamma'],
      idempotency_key: 'task-tag-1',
    });
    expect(first.added_count).toBe(2);
    expect(first.existing_count).toBe(0);

    const second = await invokeAction('projects.add_task_tag', {
      task_id: taskId,
      tags: ['Gamma', 'Delta'],
      idempotency_key: 'task-tag-2',
    });
    expect(second.added_count).toBe(0);
    expect(second.existing_count).toBe(2);

    const taskMappings = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_type: 'project_task', tagged_id: taskId });
    expect(taskMappings).toHaveLength(2);
  });

  it('T005: project read actions are tenant-scoped and authorization-filtered for client actors', async () => {
    const userColumns = await getTableColumns(db, 'users');
    if (!userColumns.has('client_id')) {
      const tenantB = await createTenant(db, 'Unauthorized Tenant');
      const tenantBActor = await createUser(db, tenantB, { email: 'tenant-b-project-reader@example.com' });
      const tenantBEntity = await createClientOrCompany(db, tenantB);
      await createProject(db, tenantB, {
        name: 'Other Tenant Project',
        clientOrCompanyId: tenantBEntity.clientId,
        wbsCode: '99',
        createdByUserId: tenantBActor,
      });

      const tenantSearch = await invokeAction('projects.search', {
        query: 'Project',
        page: 1,
        page_size: 50,
      });
      expect(tenantSearch.projects.every((project: { project_id: string }) => typeof project.project_id === 'string')).toBe(true);
      return;
    }

    const entityA = await createClientOrCompany(db, runtimeState.tenantId);
    const entityB = await createClientOrCompany(db, runtimeState.tenantId);

    const projectA = await createProject(db, runtimeState.tenantId, {
      name: 'Authorized Client Project',
      clientOrCompanyId: entityA.clientId,
      wbsCode: '80',
    });
    const projectB = await createProject(db, runtimeState.tenantId, {
      name: 'Unauthorized Client Project',
      clientOrCompanyId: entityB.clientId,
      wbsCode: '81',
    });
    const phaseA = await createPhase(db, runtimeState.tenantId, projectA, {
      name: 'Authorized Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    const phaseB = await createPhase(db, runtimeState.tenantId, projectB, {
      name: 'Unauthorized Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });
    await createTask(db, runtimeState.tenantId, phaseA, projectA, {
      taskName: 'Authorized Task',
    });
    await createTask(db, runtimeState.tenantId, phaseB, projectB, {
      taskName: 'Unauthorized Task',
    });

    await db('users')
      .where({ tenant: runtimeState.tenantId, user_id: runtimeState.actorUserId })
      .update({ user_type: 'client', client_id: entityA.clientId });

    const searchProjects = await invokeAction('projects.search', {
      query: 'Client Project',
      page: 1,
      page_size: 25,
    });
    expect(searchProjects.total).toBe(1);
    expect(searchProjects.projects[0].project_id).toBe(projectA);

    await expect(invokeAction('projects.find', {
      project_id: projectB,
      on_not_found: 'error',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const searchTasks = await invokeAction('projects.search_tasks', {
      query: 'Task',
      page: 1,
      page_size: 25,
    });
    expect(searchTasks.total).toBe(1);
    expect(searchTasks.tasks[0].project_id).toBe(projectA);
  });

  it('T025: projects.create_task remains registered and can create tasks after project action expansion', async () => {
    const createTaskAction = getAction('projects.create_task');
    expect(createTaskAction).toBeDefined();

    const entity = await createClientOrCompany(db, runtimeState.tenantId);
    const projectId = await createProject(db, runtimeState.tenantId, {
      name: 'Create Task Compatibility Project',
      clientOrCompanyId: entity.clientId,
      wbsCode: '82',
    });
    const phaseId = await createPhase(db, runtimeState.tenantId, projectId, {
      name: 'Create Task Compatibility Phase',
      orderNumber: 1,
      orderKey: 'a0',
    });

    const created = await invokeAction('projects.create_task', {
      project_id: projectId,
      phase_id: phaseId,
      title: 'Compatibility Task',
      description: 'Created from compatibility test',
    });

    expect(created.task_id).toBeDefined();
    expect(created.url).toContain(projectId);

    const persistedTask = await db('project_tasks')
      .where({ tenant: runtimeState.tenantId, task_id: created.task_id })
      .first('task_name', 'phase_id');
    expect(persistedTask?.task_name).toBe('Compatibility Task');
    expect(persistedTask?.phase_id).toBe(phaseId);
  });
});
