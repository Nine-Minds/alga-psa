import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ProjectService } from '@/lib/api/services/ProjectService';

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
  await tenantTable(tenantId, 'project_ticket_links').del();
  await tenantTable(tenantId, 'task_checklist_items').del();
  await tenantTable(tenantId, 'project_tasks').del();
  await tenantTable(tenantId, 'project_status_mappings').del();
  await tenantTable(tenantId, 'project_phases').del();
  await tenantTable(tenantId, 'projects').del();
  await tenantTable(tenantId, 'next_number').del();
  await tenantTable(tenantId, 'statuses').del();
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
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
  });

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
