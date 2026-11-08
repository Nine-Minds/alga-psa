import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { getSecret } from '../../../lib/utils/getSecret';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ProjectService } from '@/lib/api/services/ProjectService';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from '../helpers/closeRulesFixture';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

let db: Knex;
const databaseName = `ticket_project_links_test_${uuidv4().replaceAll('-', '')}`;

const table = (tenantId: string, name: string) => tenantDb(db, tenantId).table(name);

/** A tenant with project statuses and numbering, plus a board, client and contact for tickets. */
async function createTenant(): Promise<CloseRulesFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  await tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates tenant rows').insert({
    tenant: tenantId,
    client_name: `Ticket Project Links ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `ticket-project-links-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });
  await table(tenantId, 'next_number').insert({
    tenant: tenantId, entity_type: 'PROJECT', last_number: 0, initial_value: 1, prefix: 'PRJ', padding_length: 4,
  });
  await table(tenantId, 'statuses').insert({
    tenant: tenantId, status_id: uuidv4(), name: 'Planning', status_type: 'project', item_type: null,
    is_default: true, is_closed: false, order_number: 1, created_by: userId,
  });
  return createCloseRulesFixture(db, tenantId, userId);
}

async function createTask(service: ProjectService, fixture: CloseRulesFixture, projectName: string, taskName: string) {
  const context = { tenant: fixture.tenantId, userId: fixture.userId };
  const project = await service.createProject({ project_name: projectName, client_id: fixture.clientId } as any, context);
  const mappings = await table(fixture.tenantId, 'project_status_mappings')
    .where({ project_id: project.project_id })
    .orderBy('display_order');
  const phase = await service.createPhase(project.project_id, { phase_name: 'Backlog phase' } as any, context);
  const task = await service.createTask(phase.phase_id, {
    task_name: taskName, project_status_mapping_id: mappings[0].project_status_mapping_id, task_type_key: 'task',
  } as any, context);
  return { project, phase, task, mappings };
}

async function link(fixture: CloseRulesFixture, ticketId: string, t: Awaited<ReturnType<typeof createTask>>) {
  await table(fixture.tenantId, 'project_ticket_links').insert({
    tenant: fixture.tenantId,
    link_id: uuidv4(),
    project_id: t.project.project_id,
    phase_id: t.phase.phase_id,
    task_id: t.task.task_id,
    ticket_id: ticketId,
    created_at: db.fn.now(),
  });
}

describe('ProjectService.getTicketProjectLinks', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName });
  }, 180_000);

  afterAll(async () => {
    if (db) await db.destroy();
    const admin = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
    }, pool: { min: 0, max: 1 } });
    try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
    finally { await admin.destroy(); }
  });

  it("lists the ticket's linked tasks with their resolved status, following status changes", async () => {
    const fixture = await createTenant();
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const ticketId = await insertTicket(db, fixture);
    const otherTicketId = await insertTicket(db, fixture);
    const exports = await createTask(service, fixture, 'Exports', 'CSV export of invoices');
    const portal = await createTask(service, fixture, 'Portal', 'Portal branding');
    await link(fixture, ticketId, exports);
    await link(fixture, otherTicketId, portal);

    const [only] = await service.getTicketProjectLinks(ticketId, { tenant: fixture.tenantId, userId: fixture.userId });
    expect(only).toMatchObject({
      project_id: exports.project.project_id,
      project_name: 'Exports',
      project_number: exports.project.project_number,
      phase_id: exports.phase.phase_id,
      phase_name: 'Backlog phase',
      task_id: exports.task.task_id,
      task_name: 'CSV export of invoices',
      project_status_mapping_id: exports.mappings[0].project_status_mapping_id,
      is_closed: false,
      project_client_id: fixture.clientId,
    });
    expect(only.status_name).toBeTruthy();
    expect(only.task_updated_at).toBeTruthy();
    expect(await service.getTicketProjectLinks(ticketId, { tenant: fixture.tenantId, userId: fixture.userId })).toHaveLength(1);

    // A custom name on the mapping wins, and a closed status reads as closed.
    const closed = exports.mappings.find((m: any) => m.is_closed) ?? exports.mappings[exports.mappings.length - 1];
    await table(fixture.tenantId, 'project_status_mappings')
      .where({ project_status_mapping_id: closed.project_status_mapping_id })
      .update({ custom_name: 'Shipped' });
    await table(fixture.tenantId, 'project_tasks')
      .where({ task_id: exports.task.task_id })
      .update({ project_status_mapping_id: closed.project_status_mapping_id });
    const [moved] = await service.getTicketProjectLinks(ticketId, { tenant: fixture.tenantId, userId: fixture.userId });
    expect(moved).toMatchObject({ status_name: 'Shipped', project_status_mapping_id: closed.project_status_mapping_id });
    expect(moved.is_closed).toBe(Boolean(closed.is_closed));
  });

  it("does not return another tenant's links", async () => {
    const fixture = await createTenant();
    const other = await createTenant();
    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: fixture.tenantId });
    const ticketId = await insertTicket(db, fixture);
    await link(fixture, ticketId, await createTask(service, fixture, 'Mine', 'My task'));

    expect(await service.getTicketProjectLinks(ticketId, { tenant: other.tenantId, userId: other.userId })).toEqual([]);
    expect(await service.getTicketProjectLinks(uuidv4(), { tenant: fixture.tenantId, userId: fixture.userId })).toEqual([]);
  });
});
