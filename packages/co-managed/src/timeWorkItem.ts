import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSessionActor, type CoManagedSharedResource } from './sharedWork';
import { withCoManagedCustomerProject, withCoManagedCustomerTicket } from './customerWork';
import { CoManagedSharedWorkError, snapshotCoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { findCoManagedLocalWorkReference } from './timeWorkReference';

export interface CoManagedTimeWorkItem {
  workItemType: 'ticket' | 'project_task' | 'co_managed';
  workItemId: string;
  workItemName: string | null;
  /** The shared ticket's number when the field is visible to the actor; null for tasks or a redacted field. */
  workItemTicketNumber?: string | null;
}

const hiddenIn = (fields: readonly string[], names: readonly string[]) =>
  isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `tickets.${name}`, `project_tasks.${name}`, `values.${name}`]));

async function describe(trx: Knex.Transaction, tenant: string, resource: CoManagedSharedResource, fields: readonly string[]): Promise<{ name: string | null; ticketNumber: string | null }> {
  const owner = tenantDb(trx, tenant);
  if (resource.kind === 'ticket') {
    const row = await owner.table('tickets').where('ticket_id', resource.id).first('title', 'ticket_number');
    return { name: hiddenIn(fields, ['name', 'title']) ? null : row?.title ?? null,
      ticketNumber: hiddenIn(fields, ['ticket_number']) ? null : row?.ticket_number ?? null };
  }
  if (hiddenIn(fields, ['name', 'title', 'task_name'])) return { name: null, ticketNumber: null };
  return { name: (await owner.table('project_tasks').where('task_id', resource.id).first('task_name'))?.task_name ?? null, ticketNumber: null };
}

/**
 * Resolve qualified collaboration work to the identity the time writer books against.
 *
 * - MSP side (`actor.tenant !== resource.tenant`): `co_managed`, whose `work_item_id` is the MSP's own
 *   routing row for the shared work. The time stack never learns a foreign tenant's ticket id.
 * - Customer side: the customer's own native `ticket` / `project_task`, admitted by customer-local
 *   authority; that entry is operational (see the provider).
 * Opening a picker creates nothing: no time entry and no reference row (those are written with the entry).
 */
export async function resolveCoManagedTimeWorkItem(db: Knex, inputActor: CoManagedSessionActor, resource: CoManagedSharedResource): Promise<CoManagedTimeWorkItem> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!resource || !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  if (actor.tenant !== resource.tenant) {
    return withCoManagedSharedWork(db, actor, resource, 'update', write =>
      withCoManagedSharedWork(write.trx, actor, write.resource, 'read', async read => {
        const fields = [...write.redactedFields, ...read.redactedFields];
        if (hiddenIn(fields, ['time_entries', 'work_item_id', resource.kind === 'ticket' ? 'ticket_id' : 'task_id'])) throw new CoManagedSharedWorkError();
        const local = await findCoManagedLocalWorkReference(write.trx, actor.tenant,
          { customerTenant: resource.tenant, relationshipId: resource.relationshipId, kind: resource.kind as 'ticket' | 'project_task', id: resource.id });
        if (!local) throw new CoManagedSharedWorkError();
        const described = await describe(write.trx, resource.tenant, write.resource, fields);
        await write.assertCurrent(); await read.assertCurrent();
        return { workItemType: 'co_managed' as const, workItemId: local.localReferenceId, workItemName: described.name, workItemTicketNumber: described.ticketNumber };
      }));
  }
  const boundary = resource.kind === 'ticket' ? withCoManagedCustomerTicket : withCoManagedCustomerProject;
  return boundary(db, actor, resource, 'update', async context => {
    if (hiddenIn(context.redactedFields, ['time_entries', 'work_item_id', resource.kind === 'ticket' ? 'ticket_id' : 'task_id'])) throw new CoManagedSharedWorkError();
    const described = await describe(context.trx, actor.tenant, context.resource, context.redactedFields);
    return { workItemType: resource.kind as 'ticket' | 'project_task', workItemId: context.resource.id,
      workItemName: described.name, workItemTicketNumber: described.ticketNumber };
  });
}
