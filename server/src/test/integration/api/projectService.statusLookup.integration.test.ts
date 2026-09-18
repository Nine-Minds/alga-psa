import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../../lib/utils/getSecret';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ProjectService } from '@/lib/api/services/ProjectService';
import { ProjectModel } from '@alga-psa/projects/models';
import { createTestService } from '../../e2e/utils/timeEntryTestDataFactory';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

type Fixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  defaultStatusId: string;
  activeStatusId: string;
};

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const databaseName = `project_status_test_${uuidv4().replaceAll('-', '')}`;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'project_ticket_links').del();
  await tenantTable(tenantId, 'task_checklist_items').del();
  await tenantTable(tenantId, 'project_tasks').del();
  await tenantTable(tenantId, 'project_status_mappings').del();
  await tenantTable(tenantId, 'project_phases').del();
  await tenantTable(tenantId, 'projects').del();
  await tenantTable(tenantId, 'next_number').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'service_catalog').del();
  await tenantTable(tenantId, 'service_types').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const defaultStatusId = uuidv4();
  const activeStatusId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Project Service Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `project-service-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'next_number').insert({
    tenant: tenantId,
    entity_type: 'PROJECT',
    last_number: 0,
    initial_value: 1,
    prefix: 'PRJ',
    padding_length: 4,
  });

  await tenantTable(tenantId, 'statuses').insert([
    {
      tenant: tenantId,
      status_id: defaultStatusId,
      name: 'Planning',
      status_type: 'project',
      item_type: null,
      is_default: true,
      is_closed: false,
      order_number: 1,
      ...(hasColumn(statusColumns, 'created_by') ? { created_by: userId } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      status_id: activeStatusId,
      name: 'Active',
      status_type: 'project',
      item_type: null,
      is_default: false,
      is_closed: false,
      order_number: 2,
      ...(hasColumn(statusColumns, 'created_by') ? { created_by: userId } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  return {
    tenantId,
    userId,
    clientId,
    defaultStatusId,
    activeStatusId,
  };
}

describe('project service status lookup integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
  }, 180_000);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
    const admin = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
    }, pool: { min: 0, max: 1 } });
    try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
    finally { await admin.destroy(); }
  });

  it('creates a project when project statuses only populate status_type', async () => {
    const fixture = await createFixture();
    const service = new ProjectService();

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });

    const project = await service.createProject(
      {
        project_name: 'Status Type Default Project',
        client_id: fixture.clientId,
      } as any,
      {
        tenant: fixture.tenantId,
        userId: fixture.userId,
      },
    );

    expect(project.project_id).toBeTruthy();
    expect(project.status).toBe(fixture.defaultStatusId);

    const persisted = await tenantTable(fixture.tenantId, 'projects')
      .where({ project_id: project.project_id })
      .first();

    expect(persisted).toBeDefined();
    expect(persisted.status).toBe(fixture.defaultStatusId);
  });

  it.each([false, true])('creates usable task mappings, preferring tenant statuses when present (%s)', async (custom) => {
    const fixture = await createFixture();
    const context = { tenant: fixture.tenantId, userId: fixture.userId };
    // Standard statuses are global reference data in the migrated schema.
    const standards = await db('standard_statuses').where({ item_type: 'project_task' }).orderBy('display_order');
    expect(standards.length).toBeGreaterThan(0);
    const customIds = [uuidv4(), uuidv4()];
    if (custom) {
      await tenantTable(fixture.tenantId, 'statuses').insert(customIds.map((statusId, index) => ({
        tenant: fixture.tenantId, status_id: statusId, name: `Task status ${index}`,
        status_type: 'project_task', item_type: null, order_number: index + 1,
        is_default: index === 0, is_closed: index === 1, created_by: fixture.userId,
      })));
    }
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const project = await service.createProject({
      project_name: 'Project ready for tasks', client_id: fixture.clientId,
    } as any, context);
    const mappings = await tenantTable(fixture.tenantId, 'project_status_mappings')
      .where({ project_id: project.project_id }).orderBy('display_order');
    expect(mappings.map(row => row.is_standard ? row.standard_status_id : row.status_id))
      .toEqual(custom ? customIds : standards.map(row => row.standard_status_id));
    expect(mappings.map(row => row.display_order)).toEqual(Array.from({ length: custom ? 2 : standards.length }, (_, index) => index + 1));
    expect(mappings.every(row => row.is_visible && row.is_standard === !custom)).toBe(true);
    const phase = await service.createPhase(project.project_id, { phase_name: 'Execution' } as any, context);
    const task = await service.createTask(phase.phase_id, {
      task_name: 'First task', project_status_mapping_id: mappings[0].project_status_mapping_id,
      estimated_hours: 60, task_type_key: 'task',
    } as any, context);
    expect(await tenantTable(fixture.tenantId, 'project_tasks').where({ task_id: task.task_id }).first())
      .toMatchObject({ phase_id: phase.phase_id, project_status_mapping_id: mappings[0].project_status_mapping_id });
    const neighbor = await service.createProject({ project_name: 'Keep this project', client_id: fixture.clientId } as any, context);
    await service.delete(project.project_id, context);
    expect(await tenantTable(fixture.tenantId, 'projects').where({ project_id: project.project_id }).first()).toBeUndefined();
    expect(await tenantTable(fixture.tenantId, 'project_phases').where({ project_id: project.project_id })).toEqual([]);
    expect(await tenantTable(fixture.tenantId, 'project_status_mappings').where({ project_id: project.project_id })).toEqual([]);
    expect(await tenantTable(fixture.tenantId, 'project_tasks').where({ task_id: task.task_id }).first()).toBeUndefined();
    expect(await tenantTable(fixture.tenantId, 'projects').where({ project_id: neighbor.project_id }).first()).toBeDefined();
    expect(await tenantTable(fixture.tenantId, 'project_status_mappings').where({ project_id: neighbor.project_id })).toHaveLength(mappings.length);
  });

  it('returns 409 for project task time entries and preserves the project graph', async () => {
    const fixture = await createFixture();
    const context = { tenant: fixture.tenantId, userId: fixture.userId };
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const project = await service.createProject({ project_name: 'Tracked work', client_id: fixture.clientId } as any, context);
    const mapping = await tenantTable(fixture.tenantId, 'project_status_mappings').where({ project_id: project.project_id }).first();
    const phase = await service.createPhase(project.project_id, { phase_name: 'Tracked phase' } as any, context);
    const task = await service.createTask(phase.phase_id, { task_name: 'Tracked task', project_status_mapping_id: mapping.project_status_mapping_id } as any, context);
    const billingService = await createTestService(db, fixture.tenantId);
    const entryId = uuidv4();
    await tenantTable(fixture.tenantId, 'time_entries').insert({
      tenant: fixture.tenantId, entry_id: entryId, user_id: fixture.userId,
      work_item_type: 'project_task', work_item_id: task.task_id, service_id: billingService.service_id,
      start_time: '2026-09-07T10:00:00Z', end_time: '2026-09-07T11:00:00Z',
      work_date: '2026-09-07', work_timezone: 'UTC', billable_duration: 60, approval_status: 'DRAFT',
    });
    await expect(service.delete(project.project_id, context)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.delete(project.project_id, { ...context, tenant: uuidv4() })).rejects.toMatchObject({ statusCode: 404 });
    expect(await tenantTable(fixture.tenantId, 'projects').where({ project_id: project.project_id }).first()).toBeDefined();
    expect(await tenantTable(fixture.tenantId, 'project_phases').where({ phase_id: phase.phase_id }).first()).toBeDefined();
    expect(await tenantTable(fixture.tenantId, 'project_tasks').where({ task_id: task.task_id }).first()).toBeDefined();
    expect(await tenantTable(fixture.tenantId, 'project_status_mappings').where({ project_status_mapping_id: mapping.project_status_mapping_id }).first()).toBeDefined();
    expect(await tenantTable(fixture.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toBeDefined();
  });

  it('rolls project creation and numbering back if status initialization fails', async () => {
    const fixture = await createFixture();
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const failure = vi.spyOn(ProjectModel, 'addProjectStatusMapping').mockRejectedValueOnce(new Error('Injected mapping write failure'));
    try {
      await expect(service.createProject({ project_name: 'Must roll back', client_id: fixture.clientId } as any,
        { tenant: fixture.tenantId, userId: fixture.userId })).rejects.toThrow('Injected mapping write failure');
      expect(await tenantTable(fixture.tenantId, 'projects')).toEqual([]);
      expect(await tenantTable(fixture.tenantId, 'project_status_mappings')).toEqual([]);
      expect(Number((await tenantTable(fixture.tenantId, 'next_number').where({ entity_type: 'PROJECT' }).first()).last_number)).toBe(0);
    } finally {
      failure.mockRestore();
    }
  });

  it.each(['in_progress', 'uuid'])('publishes persisted status identity while preserving %s response compatibility', async input => {
    const fixture = await createFixture();
    const context = { tenant: fixture.tenantId, userId: fixture.userId };
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const project = await service.createProject({ project_name: 'Event status identity', client_id: fixture.clientId } as any, context);
    vi.mocked(publishWorkflowEvent).mockClear();
    const status = input === 'uuid' ? fixture.activeStatusId : input;
    const response = await service.update(project.project_id, { status } as any, context);
    expect(response.status).toBe(status);
    expect(await tenantTable(fixture.tenantId, 'projects').where({ project_id: project.project_id }).first())
      .toMatchObject({ status: fixture.activeStatusId });
    const events = vi.mocked(publishWorkflowEvent).mock.calls.map(([event]) => event);
    expect(events.find(event => event.eventType === 'PROJECT_UPDATED')?.payload).toMatchObject({
      changes: { status: { previous: fixture.defaultStatusId, new: fixture.activeStatusId } },
    });
    expect(events.find(event => event.eventType === 'PROJECT_STATUS_CHANGED')?.payload).toMatchObject({
      previousStatus: fixture.defaultStatusId, newStatus: fixture.activeStatusId,
    });
    vi.mocked(publishWorkflowEvent).mockClear();
    const repeated = await service.update(project.project_id, { status } as any, context);
    expect(repeated.status).toBe(status);
    const repeatedEvents = vi.mocked(publishWorkflowEvent).mock.calls.map(([event]) => event);
    expect(repeatedEvents.some(event => event.eventType === 'PROJECT_STATUS_CHANGED')).toBe(false);
    expect(repeatedEvents.find(event => event.eventType === 'PROJECT_UPDATED')?.payload).not.toHaveProperty('changes.status');
  });

  it('resolves named project statuses from status_type rows during create', async () => {
    const fixture = await createFixture();
    const service = new ProjectService();

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });

    const project = await service.createProject(
      {
        project_name: 'Status Type Named Project',
        client_id: fixture.clientId,
        status: 'in_progress',
      } as any,
      {
        tenant: fixture.tenantId,
        userId: fixture.userId,
      },
    );

    expect(project.status).toBe(fixture.activeStatusId);
  });

  it('creates a phase with the default planning status when status is omitted', async () => {
    const fixture = await createFixture();
    const service = new ProjectService();

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });

    const project = await service.createProject(
      {
        project_name: 'Phase Default Status Project',
        client_id: fixture.clientId,
      } as any,
      {
        tenant: fixture.tenantId,
        userId: fixture.userId,
      },
    );

    const phase = await service.createPhase(
      project.project_id,
      {
        phase_name: 'Discovery',
      } as any,
      {
        tenant: fixture.tenantId,
        userId: fixture.userId,
      },
    );

    expect(phase.phase_id).toBeTruthy();
    expect(phase.status).toBe('planning');

    const persisted = await tenantTable(fixture.tenantId, 'project_phases')
      .where({ phase_id: phase.phase_id })
      .first();

    expect(persisted).toBeDefined();
    expect(persisted.status).toBe('planning');
  });
});
