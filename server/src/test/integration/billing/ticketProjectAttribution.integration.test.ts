import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  ticketProjectAttributionJoin,
  ticketProjectIdExpression,
} from '@alga-psa/shared/billingClients/ticketProjectAttribution';
import { ProjectService } from '@/lib/api/services/ProjectService';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 300_000;

/**
 * Ticket time → project attribution against the migrated schema
 * (alga-2026-0002622): the column and its index exist, existing links are
 * backfilled to true, the resolver collapses a ticket's links into one row and
 * attributes nothing when they disagree, and the REST link path carries the
 * flag and rejects duplicates.
 */
describe('ticket time project attribution', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let userId: string;
  let boardId: string;
  let ticketStatusId: string;
  let projectStatusId: string;
  // Project A takes the attributed ticket time; project B only exists to make
  // one ticket ambiguous.
  let projectAId: string;
  let projectBId: string;
  let phaseAId: string;
  let phaseBId: string;
  let taskA1Id: string;
  let taskA2Id: string;
  let taskBId: string;
  let serviceId: string;

  const table = (name: string) => tenantDb(db, tenant).table(name);

  async function createTicket(key: string, title: string): Promise<string> {
    const ticketId = uuidv4();
    await table('tickets').insert({
      tenant,
      ticket_id: ticketId,
      ticket_number: `TPA-${key}-${tenant.slice(0, 6)}`,
      title,
      client_id: clientId,
      board_id: boardId,
      status_id: ticketStatusId,
      entered_by: userId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    return ticketId;
  }

  async function logHour(workItemId: string, workItemType: string, overrides: Record<string, unknown> = {}) {
    const entryId = uuidv4();
    await table('time_entries').insert({
      tenant,
      entry_id: entryId,
      work_item_id: workItemId,
      work_item_type: workItemType,
      user_id: userId,
      service_id: serviceId,
      start_time: '2026-07-10T09:00:00Z',
      end_time: '2026-07-10T10:00:00Z',
      work_date: '2026-07-10',
      work_timezone: 'UTC',
      billable_duration: 60,
      approval_status: 'APPROVED',
      invoiced: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      ...overrides,
    });
    return entryId;
  }

  /** The resolver, exactly as every consumer joins it. */
  async function attributedProjectIds(): Promise<Array<{ entry_id: string; project_id: string | null; rows_for_entry: number }>> {
    const result = await db.raw(
      `SELECT te.entry_id,
              ${ticketProjectIdExpression('phase')} AS project_id,
              COUNT(*) OVER (PARTITION BY te.entry_id)::int AS rows_for_entry
       FROM time_entries te
       LEFT JOIN project_tasks task
         ON task.tenant = te.tenant
        AND te.work_item_type = 'project_task'
        AND task.task_id = te.work_item_id
       LEFT JOIN project_phases phase
         ON phase.tenant = task.tenant
        AND phase.phase_id = task.phase_id
       ${ticketProjectAttributionJoin('te')}
       WHERE te.tenant = ?
       ORDER BY te.entry_id`,
      [tenant],
    );
    return (result.rows ?? result) as Array<{ entry_id: string; project_id: string | null; rows_for_entry: number }>;
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenant = uuidv4();
    clientId = uuidv4();
    userId = uuidv4();
    boardId = uuidv4();
    ticketStatusId = uuidv4();
    projectStatusId = uuidv4();
    projectAId = uuidv4();
    projectBId = uuidv4();
    phaseAId = uuidv4();
    phaseBId = uuidv4();
    taskA1Id = uuidv4();
    taskA2Id = uuidv4();
    taskBId = uuidv4();

    await tenantDb(db, tenant)
      .unscoped('tenants', 'ticket attribution fixture creates a tenant')
      .insert({
        tenant,
        client_name: `Ticket Attribution ${tenant.slice(0, 8)}`,
        email: `ticket-attribution-${tenant.slice(0, 8)}@example.test`,
      });
    await table('clients').insert({
      tenant,
      client_id: clientId,
      client_name: 'Attribution Client',
      billing_cycle: 'monthly',
    });
    await table('users').insert({
      tenant,
      user_id: userId,
      username: `attribution-${userId.slice(0, 8)}`,
      email: `attribution-${userId.slice(0, 8)}@example.test`,
      hashed_password: 'not-used',
      user_type: 'internal',
      is_inactive: false,
    });
    await table('boards').insert({
      tenant,
      board_id: boardId,
      board_name: 'Support',
      is_default: true,
      is_inactive: false,
    });
    await table('statuses').insert([
      {
        tenant,
        status_id: ticketStatusId,
        board_id: boardId,
        name: 'Open',
        status_type: 'ticket',
        is_closed: false,
        is_default: true,
        order_number: 10,
        created_by: userId,
      },
      {
        tenant,
        status_id: projectStatusId,
        name: 'Planned',
        status_type: 'project',
        item_type: 'project',
        order_number: 1,
      },
    ]);
    await table('projects').insert([
      {
        tenant,
        project_id: projectAId,
        client_id: clientId,
        project_name: 'IT Management',
        project_number: `TPA-${tenant.slice(0, 6)}-A`,
        status: projectStatusId,
        wbs_code: `TPA-${tenant.slice(0, 6)}-A`,
      },
      {
        tenant,
        project_id: projectBId,
        client_id: clientId,
        project_name: 'Second Project',
        project_number: `TPA-${tenant.slice(0, 6)}-B`,
        status: projectStatusId,
        wbs_code: `TPA-${tenant.slice(0, 6)}-B`,
      },
    ]);
    await table('project_phases').insert([
      { tenant, phase_id: phaseAId, project_id: projectAId, phase_name: 'Phase A', wbs_code: `TPA-${tenant.slice(0, 6)}-A.1`, order_number: 1, status: 'active' },
      { tenant, phase_id: phaseBId, project_id: projectBId, phase_name: 'Phase B', wbs_code: `TPA-${tenant.slice(0, 6)}-B.1`, order_number: 1, status: 'active' },
    ]);
    await table('project_tasks').insert([
      { tenant, task_id: taskA1Id, phase_id: phaseAId, task_name: 'Task A1', wbs_code: `TPA-${tenant.slice(0, 6)}-A.1.1` },
      { tenant, task_id: taskA2Id, phase_id: phaseAId, task_name: 'Task A2', wbs_code: `TPA-${tenant.slice(0, 6)}-A.1.2` },
      { tenant, task_id: taskBId, phase_id: phaseBId, task_name: 'Task B1', wbs_code: `TPA-${tenant.slice(0, 6)}-B.1.1` },
    ]);

    const serviceTypeId = uuidv4();
    await table('service_types').insert({
      tenant,
      id: serviceTypeId,
      name: 'Attribution Service Type',
      is_active: true,
      order_number: 1,
    });
    serviceId = uuidv4();
    await table('service_catalog').insert({
      tenant,
      service_id: serviceId,
      service_name: 'Ticket support',
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      default_rate: 12_000,
      unit_of_measure: 'hour',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('adds bill_under_project with a true default, backfills existing links, and indexes the flagged lookup', async () => {
    await expect(db.schema.hasColumn('project_ticket_links', 'bill_under_project')).resolves.toBe(true);

    const column = await db.raw(
      `SELECT is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'project_ticket_links' AND column_name = 'bill_under_project'`,
    );
    expect(column.rows[0]).toMatchObject({
      is_nullable: 'NO',
      column_default: 'true',
      data_type: 'boolean',
    });

    // A link written without the column — the shape every pre-migration row
    // has — reads back as billable.
    const backfilledLinkId = uuidv4();
    await table('project_ticket_links').insert({
      tenant,
      link_id: backfilledLinkId,
      project_id: projectAId,
      phase_id: phaseAId,
      task_id: taskA1Id,
      ticket_id: await createTicket('backfill', 'Pre-migration link'),
    });
    await expect(
      table('project_ticket_links').where({ link_id: backfilledLinkId }).first('bill_under_project'),
    ).resolves.toMatchObject({ bill_under_project: true });

    const indexes = await db.raw(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'project_ticket_links'
         AND indexname = 'idx_project_ticket_links_tenant_ticket_billable'`,
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0].indexdef).toContain('(tenant, ticket_id)');
    expect(indexes.rows[0].indexdef).toContain('WHERE bill_under_project');
  });

  it('attributes one project per ticket, never fans a time entry out, and attributes nothing when links disagree', async () => {
    const oneLink = await createTicket('one', 'Single flagged link');
    const twoTasks = await createTicket('two-tasks', 'Two tasks in one project');
    const twoProjects = await createTicket('two-projects', 'Linked into two projects');
    const flagOff = await createTicket('flag-off', 'Reference-only link');

    await table('project_ticket_links').insert([
      { tenant, link_id: uuidv4(), project_id: projectAId, phase_id: phaseAId, task_id: taskA1Id, ticket_id: oneLink },
      { tenant, link_id: uuidv4(), project_id: projectAId, phase_id: phaseAId, task_id: taskA1Id, ticket_id: twoTasks },
      { tenant, link_id: uuidv4(), project_id: projectAId, phase_id: phaseAId, task_id: taskA2Id, ticket_id: twoTasks },
      { tenant, link_id: uuidv4(), project_id: projectAId, phase_id: phaseAId, task_id: taskA1Id, ticket_id: twoProjects },
      { tenant, link_id: uuidv4(), project_id: projectBId, phase_id: phaseBId, task_id: taskBId, ticket_id: twoProjects },
      {
        tenant,
        link_id: uuidv4(),
        project_id: projectAId,
        phase_id: phaseAId,
        task_id: taskA1Id,
        ticket_id: flagOff,
        bill_under_project: false,
      },
    ]);

    const entries = {
      oneLink: await logHour(oneLink, 'ticket'),
      twoTasks: await logHour(twoTasks, 'ticket'),
      twoProjects: await logHour(twoProjects, 'ticket'),
      flagOff: await logHour(flagOff, 'ticket'),
      projectTask: await logHour(taskA1Id, 'project_task'),
      // Decision e: an invoiced entry is never re-billed, whatever the link
      // says — the loaders only ever read invoiced = false.
      invoiced: await logHour(oneLink, 'ticket', { invoiced: true }),
    };

    const attributed = new Map(
      (await attributedProjectIds()).map((row) => [row.entry_id, row]),
    );

    expect(attributed.get(entries.oneLink)).toMatchObject({ project_id: projectAId, rows_for_entry: 1 });
    // Two links, one project: attributed once, not twice.
    expect(attributed.get(entries.twoTasks)).toMatchObject({ project_id: projectAId, rows_for_entry: 1 });
    expect(attributed.get(entries.twoProjects)).toMatchObject({ project_id: null, rows_for_entry: 1 });
    expect(attributed.get(entries.flagOff)).toMatchObject({ project_id: null, rows_for_entry: 1 });
    expect(attributed.get(entries.projectTask)).toMatchObject({ project_id: projectAId, rows_for_entry: 1 });

    const invoicedRow = await table('time_entries').where({ entry_id: entries.invoiced }).first('invoiced');
    expect(invoicedRow.invoiced).toBe(true);
  });

  it('creates REST links with the flag defaulted to true, honours an explicit opt-out, and rejects duplicates', async () => {
    const defaulted = await createTicket('rest-default', 'REST link without the flag');
    const optedOut = await createTicket('rest-opt-out', 'REST link opting out');

    const service = new ProjectService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    const context = { tenant, userId };

    const created = await service.createTicketLink(
      projectAId,
      { ticket_id: defaulted, phase_id: phaseAId, task_id: taskA1Id, bill_under_project: true },
      context as any,
    );
    expect(created).toMatchObject({ ticket_id: defaulted, bill_under_project: true });

    const reference = await service.createTicketLink(
      projectAId,
      { ticket_id: optedOut, phase_id: phaseAId, task_id: taskA1Id, bill_under_project: false },
      context as any,
    );
    expect(reference).toMatchObject({ ticket_id: optedOut, bill_under_project: false });

    // The table is unique only on (tenant, link_id), so the duplicate guard is
    // the only thing stopping one ticket collecting two identical links.
    await expect(
      service.createTicketLink(
        projectAId,
        { ticket_id: defaulted, phase_id: phaseAId, task_id: taskA1Id, bill_under_project: true },
        context as any,
      ),
    ).rejects.toThrow(/already linked/i);

    const links = await table('project_ticket_links').where({ ticket_id: defaulted });
    expect(links).toHaveLength(1);
  });
});
