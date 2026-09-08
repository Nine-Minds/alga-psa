import type { Knex } from 'knex';

/** One work row per owner/type/id. Native work and retained MSP evidence use
 * identical billing columns, without reading another tenant during invoicing.
 * This is a billing loader, not authorization to browse the live source. */
export function joinTimeEntryBillingWorkContext(db: Knex, tenant: string, query: Knex.QueryBuilder, entryAlias = 'time_entries') {
  const work = db.raw(`(
    SELECT t.tenant, t.ticket_id AS work_item_id, 'ticket'::text AS work_item_type,
      t.client_id, t.billing_profile_id, t.ticket_number::text, t.title AS ticket_title,
      t.attributes->>'description' AS ticket_description, NULL::text AS project_task_name,
      NULL::uuid AS project_phase_id, NULL::uuid AS project_id, t.title AS work_item_name,
      t.tenant AS source_tenant, 'ticket'::text AS source_kind, t.ticket_id AS source_id, NULL::uuid AS relationship_id
    FROM tickets t WHERE t.tenant = ?
    UNION ALL
    SELECT task.tenant, task.task_id, 'project_task', p.client_id, p.billing_profile_id,
      NULL::text, NULL::text, NULL::text, task.task_name, phase.phase_id, p.project_id, task.task_name,
      task.tenant, 'project_task', task.task_id, NULL::uuid
    FROM project_tasks task JOIN project_phases phase ON phase.tenant = task.tenant AND phase.phase_id = task.phase_id
      JOIN projects p ON p.tenant = phase.tenant AND p.project_id = phase.project_id WHERE task.tenant = ?
    UNION ALL
    SELECT r.tenant, r.reference_id, 'co_managed', r.client_id, r.billing_profile_id,
      r.ticket_number, CASE WHEN r.source_kind = 'ticket' THEN r.title END,
      CASE WHEN r.source_kind = 'ticket' THEN r.description END,
      CASE WHEN r.source_kind = 'project_task' THEN r.title END, NULL::uuid, NULL::uuid, r.title,
      r.customer_tenant, r.source_kind, r.source_id, r.relationship_id
    FROM co_managed_time_work_references r WHERE r.tenant = ?
  ) AS billing_work`, [tenant, tenant, tenant]);
  query.join(work, function() {
    this.on('billing_work.tenant', '=', `${entryAlias}.tenant`)
      .andOn('billing_work.work_item_id', '=', `${entryAlias}.work_item_id`)
      .andOn('billing_work.work_item_type', '=', `${entryAlias}.work_item_type`);
  });
  return query;
}

export const timeEntryBillingWorkColumns = [
  'billing_work.ticket_number', 'billing_work.ticket_title', 'billing_work.ticket_description',
  'billing_work.project_task_name', 'billing_work.project_phase_id', 'billing_work.project_id',
  'billing_work.work_item_name', 'billing_work.billing_profile_id as work_item_billing_profile_id',
  'billing_work.source_tenant as work_source_tenant', 'billing_work.source_kind as work_source_kind',
  'billing_work.source_id as work_source_id', 'billing_work.relationship_id as work_relationship_id',
];
