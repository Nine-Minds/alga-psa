import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

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

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('project_ticket_links').where({ tenant: tenantId }).del();
  await db('task_checklist_items').where({ tenant: tenantId }).del();
  await db('project_tasks').where({ tenant: tenantId }).del();
  await db('project_status_mappings').where({ tenant: tenantId }).del();
  await db('project_phases').where({ tenant: tenantId }).del();
  await db('projects').where({ tenant: tenantId }).del();
  await db('next_number').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const defaultStatusId = uuidv4();
  const activeStatusId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Project Service Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `project-service-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('next_number').insert({
    tenant: tenantId,
    entity_type: 'PROJECT',
    last_number: 0,
    initial_value: 1,
    prefix: 'PRJ',
    padding_length: 4,
  });

  await db('statuses').insert([
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
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    clientColumns = await db('clients').columnInfo();
    statusColumns = await db('statuses').columnInfo();
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

    const persisted = await db('projects')
      .where({ tenant: fixture.tenantId, project_id: project.project_id })
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

    const persisted = await db('project_phases')
      .where({ tenant: fixture.tenantId, phase_id: phase.phase_id })
      .first();

    expect(persisted).toBeDefined();
    expect(persisted.status).toBe('planning');
  });
});
