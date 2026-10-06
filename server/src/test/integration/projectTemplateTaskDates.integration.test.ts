import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { applyProjectTemplate } from '@alga-psa/projects/services/applyProjectTemplate';

type Fixture = {
  tenantId: string;
  clientId: string;
  projectStatusId: string;
  templateId: string;
  templatePhaseId: string;
  mappingId: string;
};

async function createFixture(trx: Knex.Transaction): Promise<Fixture> {
  const tenantId = uuidv4();
  const tag = tenantId.slice(0, 8);
  await trx('tenants').insert({
    tenant: tenantId,
    client_name: `Template dates fixture ${tag}`,
    email: `template-dates-${tag}@example.com`,
    billing_source: 'internal',
  });

  const clientId = uuidv4();
  await trx('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tag}`,
    client_type: 'company',
    is_tax_exempt: false,
  });

  const projectStatusId = uuidv4();
  await trx('statuses').insert({
    tenant: tenantId,
    status_id: projectStatusId,
    name: 'Planned Project Status',
    status_type: 'project',
    item_type: 'project',
    is_closed: false,
    order_number: 1,
  });

  const taskStatusId = uuidv4();
  await trx('statuses').insert({
    tenant: tenantId,
    status_id: taskStatusId,
    name: 'Tenant Task Status',
    status_type: 'project_task',
    item_type: 'project_task',
    is_closed: false,
    order_number: 1,
  });

  const templateId = uuidv4();
  await trx('project_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Template ${tag}`,
    use_count: 0,
  });

  const mappingId = uuidv4();
  await trx('project_template_status_mappings').insert({
    tenant: tenantId,
    template_status_mapping_id: mappingId,
    template_id: templateId,
    status_id: taskStatusId,
    status_source: 'tenant',
    display_order: 0,
  });

  // The phase itself starts 2 days into the project.
  const templatePhaseId = uuidv4();
  await trx('project_template_phases').insert({
    tenant: tenantId,
    template_phase_id: templatePhaseId,
    template_id: templateId,
    phase_name: 'Build',
    start_offset_days: 2,
    duration_days: 20,
    order_key: 'a0',
  });

  return { tenantId, clientId, projectStatusId, templateId, templatePhaseId, mappingId };
}

async function addTemplateTask(
  trx: Knex.Transaction,
  fixture: Fixture,
  task: { task_name: string; duration_days: number | null; start_offset_days: number | null; order_key: string },
): Promise<void> {
  await trx('project_template_tasks').insert({
    tenant: fixture.tenantId,
    template_task_id: uuidv4(),
    template_phase_id: fixture.templatePhaseId,
    template_status_mapping_id: fixture.mappingId,
    task_type_key: 'task',
    ...task,
  });
}

const isoDay = (value: unknown) => (value ? new Date(value as string).toISOString().slice(0, 10) : null);

describe('applyProjectTemplate task start dates (integration)', () => {
  let db: Knex;

  beforeAll(async () => {
    // Also proves the start_offset_days migration applies cleanly.
    db = await createTestDbConnection({ runSeeds: true });
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  }, 120_000);

  async function withRollback(run: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
    const trx = await db.transaction();
    let testError: unknown;
    try {
      await run(trx);
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }
    if (testError) throw testError;
  }

  async function applyAndLoadTasks(trx: Knex.Transaction, fixture: Fixture, startDate?: string) {
    const projectId = await applyProjectTemplate(trx, fixture.tenantId, fixture.templateId, {
      project_name: 'Applied Project',
      client_id: fixture.clientId,
      status_id: fixture.projectStatusId,
      start_date: startDate,
      options: {
        copyPhases: true,
        copyStatuses: true,
        copyTasks: true,
        copyDependencies: false,
        copyChecklists: false,
        copyServices: false,
        assignmentOption: 'none',
      },
    });
    const rows = await trx('project_tasks as pt')
      .join('project_phases as pp', function joinPhases() {
        this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
      })
      .where({ 'pt.tenant': fixture.tenantId, 'pp.project_id': projectId })
      .select('pt.task_name', 'pt.start_date', 'pt.due_date');
    return Object.fromEntries(rows.map((row) => [row.task_name, { start: isoDay(row.start_date), due: isoDay(row.due_date) }]));
  }

  it('stores start_offset_days on template tasks', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addTemplateTask(trx, fixture, { task_name: 'Offset', duration_days: 5, start_offset_days: 0, order_key: 'a0' });
      const stored = await trx('project_template_tasks')
        .where({ tenant: fixture.tenantId, template_phase_id: fixture.templatePhaseId })
        .first('start_offset_days');
      // Zero survives as zero rather than being read back as "unset".
      expect(stored.start_offset_days).toBe(0);
    });
  });

  it('dates each task from its phase start, using the start offset and the duration', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addTemplateTask(trx, fixture, { task_name: 'Both', duration_days: 10, start_offset_days: 3, order_key: 'a0' });
      await addTemplateTask(trx, fixture, { task_name: 'Starts with phase', duration_days: 4, start_offset_days: 0, order_key: 'a1' });
      await addTemplateTask(trx, fixture, { task_name: 'Legacy, no offset', duration_days: 6, start_offset_days: null, order_key: 'a2' });
      await addTemplateTask(trx, fixture, { task_name: 'Start only', duration_days: null, start_offset_days: 5, order_key: 'a3' });
      await addTemplateTask(trx, fixture, { task_name: 'Offset past due', duration_days: 2, start_offset_days: 9, order_key: 'a4' });

      // Project starts 2026-10-05; the phase starts 2 days later, on 2026-10-07.
      const tasks = await applyAndLoadTasks(trx, fixture, '2026-10-05T00:00:00.000Z');

      expect(tasks['Both']).toEqual({ start: '2026-10-10', due: '2026-10-17' });
      expect(tasks['Starts with phase']).toEqual({ start: '2026-10-07', due: '2026-10-11' });
      // Templates saved before the column existed keep producing undated starts.
      expect(tasks['Legacy, no offset']).toEqual({ start: null, due: '2026-10-13' });
      expect(tasks['Start only']).toEqual({ start: '2026-10-12', due: null });
      // A start after the due date is dropped rather than stored inverted.
      expect(tasks['Offset past due']).toEqual({ start: null, due: '2026-10-09' });
    });
  });

  it('leaves tasks undated when the project has no start date', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addTemplateTask(trx, fixture, { task_name: 'Both', duration_days: 10, start_offset_days: 3, order_key: 'a0' });

      const tasks = await applyAndLoadTasks(trx, fixture);

      expect(tasks['Both']).toEqual({ start: null, due: null });
    });
  });
});
