import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { serves } from '@alga-psa/core/capability';
import {
  registerTimeEntryWorkContributor,
  type TimeEntryWorkContributor,
} from '@alga-psa/billing/lib/billing/timeEntryWorkContext';

/**
 * The co-managed contributor to the billing work-context seam (packages/billing timeEntryWorkContext).
 *
 * `serves` is the cached durable-participation verdict, so FORCE_CAPABILITIES=co-managed:off and every
 * non-participating tenant get `[]` from the seam and the billing SQL never names a co_managed_* table.
 * The fragment is keyed on the time entry: the retained provenance row carries the qualified source,
 * the customer-visible title/number captured at admission; the billing profile is the live work-level
 * default on the MSP-local routing row.
 */
const FRAGMENT = `SELECT w.tenant, w.entry_id, 'co_managed'::text AS work_item_type, w.client_id,
    COALESCE(tr.billing_profile_id, pr.billing_profile_id) AS billing_profile_id,
    w.ticket_number::text AS ticket_number,
    CASE WHEN w.source_kind = 'ticket' THEN w.title END AS ticket_title,
    CASE WHEN w.source_kind = 'project_task' THEN w.title END AS project_task_name,
    w.title AS work_item_name, w.customer_tenant AS source_tenant, w.source_kind::text AS source_kind,
    w.source_id, w.relationship_id
  FROM co_managed_time_work_references w
    LEFT JOIN co_managed_ticket_references tr ON tr.tenant = w.tenant AND tr.reference_id = w.local_reference_id
    LEFT JOIN co_managed_project_task_references pr ON pr.tenant = w.tenant AND pr.reference_id = w.local_reference_id
  WHERE w.tenant = ?`;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createCoManagedTimeEntryWorkContributor(): TimeEntryWorkContributor {
  return {
    kind: 'co-managed',
    workItemTypes: ['co_managed'],
    serves: async (tenant) => (await serves('co-managed', tenant)).served,
    fragment: (tenant) => ({ sql: FRAGMENT, bindings: [tenant] }),
    async describeEntry(trx: Knex.Transaction, tenant, entryId) {
      const row = await tenantDb(trx, tenant).table('co_managed_time_work_references')
        .where('entry_id', entryId).first('client_id', 'ticket_number', 'title', 'source_kind', 'customer_tenant', 'source_id');
      return row ? { workItemType: 'co_managed', clientId: row.client_id, ticketNumber: row.ticket_number ?? null, title: row.title ?? null,
        sourceKind: row.source_kind, sourceTenant: row.customer_tenant, sourceId: row.source_id } : null;
    },
    /** `id` is the shared ticket (customer tenant ticket id) or the MSP-local routing row id. */
    async resolveWorkItem(db, tenant, id) {
      if (!isUuid(id)) return null;
      const home = tenantDb(db, tenant);
      const row = await home.table('co_managed_ticket_references').where((q: Knex.QueryBuilder) => q.where('reference_id', id).orWhere('ticket_id', id))
        .first('reference_id', 'client_id');
      if (!row) return null;
      // Customer-visible descriptive evidence retained from the latest admitted entry on this work.
      const evidence = await home.table('co_managed_time_work_references').where('local_reference_id', row.reference_id)
        .orderBy('captured_at', 'desc').first('ticket_number', 'title');
      return { workItemType: 'co_managed', workItemId: row.reference_id, clientId: row.client_id,
        ticketNumber: evidence?.ticket_number ?? null, title: evidence?.title ?? null };
    },
  };
}

export function registerCoManagedTimeEntryWorkContributor(): void {
  registerTimeEntryWorkContributor(createCoManagedTimeEntryWorkContributor());
}
