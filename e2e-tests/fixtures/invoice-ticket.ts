import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createInvoiceTicketSourceFixture } from '../../server/test-utils/invoiceTicketProductionFixtures';
import { buildRecurringServicePeriodPeriodKey, buildRecurringServicePeriodScheduleKey } from '../../shared/billingClients/recurringServicePeriodKeys';

/** Seed due source periods without loading server actions into standalone Playwright. */
export async function createBrowserInvoiceTicketSourceFixture(db: Knex, identity: { tenant: string; userId: string }) {
  const ids = await createInvoiceTicketSourceFixture(db, identity, undefined, { materializeServicePeriods: false });
  await db.transaction(async (tx) => {
    for (const [lineId, chargeFamily] of [[ids.lineId, 'hourly'], [ids.usageLineId, 'usage']] as const) {
      await tx('recurring_service_periods').insert({
        tenant: identity.tenant, record_id: randomUUID(),
        schedule_key: buildRecurringServicePeriodScheduleKey({ tenant: identity.tenant,
          obligationType: 'client_contract_line', obligationId: lineId, cadenceOwner: 'client', duePosition: 'arrears' }),
        period_key: buildRecurringServicePeriodPeriodKey({ start: '2026-08-01', end: '2026-09-01' }),
        revision: 1, obligation_id: lineId, obligation_type: 'client_contract_line', charge_family: chargeFamily,
        cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'generated',
        service_period_start: '2026-08-01T00:00:00Z', service_period_end: '2026-09-01T00:00:00Z',
        invoice_window_start: '2026-09-01T00:00:00Z', invoice_window_end: '2026-10-01T00:00:00Z',
        provenance_kind: 'generated', source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
        reason_code: 'backfill_materialization', source_run_key: `browser-invoice-ticket:${ids.clientId}`,
      });
    }
  });
  return ids;
}

/** Owned project/task source rows; invoice snapshots are produced by the app. */
export async function addBrowserInvoiceTaskSources(db: Knex, ids: Awaited<ReturnType<typeof createBrowserInvoiceTicketSourceFixture>>) {
  const { tenant, userId, clientId, lineId, serviceId, profileId } = ids;
  const projectId = randomUUID(), phaseId = randomUUID(), statusId = randomUUID();
  const secondServiceId = randomUUID(), configId = randomUUID();
  const taskIds: string[] = [];
  await db.transaction(async tx => {
    await tx('statuses').insert({ tenant, status_id: statusId, name: 'Invoice task source',
      status_type: 'project', order_number: 1, created_by: userId, is_closed: false });
    await tx('projects').insert({ tenant, project_id: projectId, client_id: clientId,
      project_name: 'Owned invoice task identities', project_number: `TASK-${projectId.slice(0, 8)}`,
      status: statusId, wbs_code: `TASK-${projectId}`, billing_profile_id: profileId });
    await tx('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId,
      phase_name: 'Invoice task source', status: 'In Progress', order_number: 1, wbs_code: '1' });
    const service = await tx('service_catalog').where({ tenant, service_id: serviceId }).first();
    await tx('service_catalog').insert({ ...service, service_id: secondServiceId,
      service_name: 'Second task service', default_rate: 18000 });
    await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: secondServiceId, currency_code: 'USD', rate: 18000 });
    await tx('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: secondServiceId, quantity: 1, custom_rate: 18000 });
    await tx('contract_line_service_configuration').insert({ tenant, config_id: configId,
      contract_line_id: lineId, service_id: secondServiceId, configuration_type: 'Hourly', custom_rate: 18000, quantity: 1 });
    await tx('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
    const source = await tx('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 60 }).first();
    if (!source) throw new Error('Task identity source requires approved billable time');
    for (let index = 0; index < 3; index++) {
      const taskId = randomUUID();
      taskIds.push(taskId);
      await tx('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId,
        task_name: index < 2 ? 'Same public task name' : '', description: null, wbs_code: `1.${index + 1}` });
      for (let entry = 0; entry < (index === 0 ? 2 : 1); entry++) {
        await tx('time_entries').insert({ ...source, entry_id: randomUUID(), work_item_type: 'project_task',
          work_item_id: taskId, service_id: entry ? secondServiceId : serviceId });
      }
    }
  });
  return { projectId, taskIds, secondServiceId };
}
