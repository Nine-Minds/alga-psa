import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { withCoManagedCustomerTicket, withCoManagedCustomerProject } from './customerWork';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedEffortTotals {
  resource: CoManagedSharedResource;
  customerMinutes: number | null;
  mspMinutes: number | null;
  combinedMinutes: number | null;
}

function visible(context: CoManagedSharedWorkContext, field: keyof Omit<CoManagedEffortTotals, 'resource'>) {
  const names = [`effort_totals.${field}`, field, 'actual_hours', 'actual_minutes', 'time_entries.start_time', 'time_entries.end_time', 'time_entries.duration'];
  return !isCoManagedReadFieldHidden(context.redactedFields, names.flatMap(name => [name, `values.${name}`, `tickets.${name}`, `project_tasks.${name}`, `projects.${name}`]));
}

/** Actual minutes of one completed entry; the same rule on both sides, so a side can never be favoured. */
const entryMinutes = (alias: string) => `GREATEST(ROUND(EXTRACT(EPOCH FROM (${alias}.end_time - ${alias}.start_time)) / 60.0), 0)`;

/**
 * Customer / MSP / combined effort for shared work, each time entry counted once.
 *
 * Customer minutes are the customer's own entries on its own work item (`work_item_id` is indexed;
 * `billing_mode` is only a refinement of that keyed lookup, never a tenant-wide probe). MSP minutes
 * are the sponsor's entries joined through `co_managed_time_work_references`, which is unique on
 * `(tenant, entry_id)`, so an entry visible to both relations is summed once and a duplicate
 * reference cannot double it. Billable minutes never enter: operational rows store 0 billable
 * minutes by design, so effort is measured from the start/end instants alone.
 *
 * Work-level aggregates need work read authority, not private timesheet access; approval, billing,
 * authors and notes never enter this query.
 */
export async function getCoManagedEffortTotals(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource): Promise<CoManagedEffortTotals> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  const resource = { ...inputResource };
  const boundary = actor.tenant !== resource.tenant ? withCoManagedSharedWork
    : resource.kind === 'ticket' ? withCoManagedCustomerTicket : withCoManagedCustomerProject;
  return boundary(db, actor, resource, 'read', async context => {
    const { trx } = context, owner = tenantDb(trx, resource.tenant);
    const relationship = await owner.table('co_management_relationships').where('relationship_id', resource.relationshipId)
      .first('sponsor_tenant', 'sponsor_client_id', 'state', 'ended_at');
    if (!relationship) throw new CoManagedSharedWorkError();
    const customerIds: string[] = [], mspIds: string[] = [];
    // Once the relationship ended, retained customer reads never carry MSP effort.
    const live = relationship.state === 'active' && !relationship.ended_at;
    const shared = live && await hasEffectiveSharedGrant(context.trx, context.resource);
    let combinedVisible = visible(context, 'combinedMinutes');
    const collect = (current: CoManagedSharedWorkContext) => {
      combinedVisible &&= visible(current, 'combinedMinutes');
      if (visible(context, 'customerMinutes') && visible(current, 'customerMinutes')) customerIds.push(current.resource.id);
      if (shared && visible(context, 'mspMinutes') && visible(current, 'mspMinutes')) mspIds.push(current.resource.id);
    };
    let childCount = 0;
    if (resource.kind === 'project') {
      const query = owner.table('project_tasks as task');
      owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
      const tasks = await query.where('phase.project_id', resource.id).orderBy('task.task_id').forShare('task', 'phase').select('task.task_id');
      childCount = tasks.length;
      for (const task of tasks) {
        try { await boundary(trx, actor, { ...resource, kind: 'project_task', id: task.task_id }, 'read', async current => collect(current)); }
        catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
      }
    } else collect(context);
    const sum = (side: string, alias: string) => trx.raw(`?::text AS side, COALESCE(SUM(${entryMinutes(alias)}), 0)::bigint AS minutes`, [side]);
    const sourceKind = resource.kind === 'ticket' ? 'ticket' : 'project_task';
    const customer = owner.table('time_entries as effort').where('effort.work_item_type', sourceKind).whereIn('effort.work_item_id', customerIds).select(sum('customer', 'effort'));
    const mspOwner = tenantDb(trx, relationship.sponsor_tenant), msp = mspOwner.table('time_entries as effort');
    mspOwner.tenantJoin(msp, 'co_managed_time_work_references as reference', 'effort.entry_id', 'reference.entry_id');
    msp.where({ 'effort.work_item_type': 'co_managed', 'reference.customer_tenant': resource.tenant,
      'reference.relationship_id': resource.relationshipId, 'reference.client_id': relationship.sponsor_client_id,
      'reference.source_kind': sourceKind }).whereIn('reference.source_id', mspIds).select(sum('msp', 'effort'));
    // One statement: a consistent snapshot across the two owners.
    const rows = await trx.queryBuilder().unionAll([customer, msp], true) as unknown as Array<{ side: string; minutes: string }>;
    const total = (side: string) => {
      const value = Number(rows.find(row => row.side === side)?.minutes);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid shared effort total');
      return value;
    };
    const emptyProject = resource.kind === 'project' && childCount === 0;
    const customerMinutes = visible(context, 'customerMinutes') && (customerIds.length > 0 || emptyProject) ? total('customer') : null;
    const mspMinutes = shared && visible(context, 'mspMinutes') && (mspIds.length > 0 || emptyProject) ? total('msp') : null;
    const combinedMinutes = customerMinutes !== null && mspMinutes !== null && combinedVisible ? customerMinutes + mspMinutes : null;
    if (combinedMinutes !== null && !Number.isSafeInteger(combinedMinutes)) throw new Error('Invalid shared effort total');
    await assertCoManagedSessionUnexpired(trx, actor);
    return { resource: context.resource, customerMinutes, mspMinutes, combinedMinutes };
  });
}
