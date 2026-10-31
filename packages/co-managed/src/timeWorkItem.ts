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
}

const hiddenIn = (fields: readonly string[], names: readonly string[]) =>
  isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `tickets.${name}`, `project_tasks.${name}`, `values.${name}`]));

async function describe(trx: Knex.Transaction, tenant: string, resource: CoManagedSharedResource, fields: readonly string[]): Promise<string | null> {
  if (hiddenIn(fields, ['name', 'title', 'task_name'])) return null;
  const owner = tenantDb(trx, tenant);
  if (resource.kind === 'ticket') return (await owner.table('tickets').where('ticket_id', resource.id).first('title'))?.title ?? null;
  return (await owner.table('project_tasks').where('task_id', resource.id).first('task_name'))?.task_name ?? null;
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
        const workItemName = await describe(write.trx, resource.tenant, write.resource, fields);
        await write.assertCurrent(); await read.assertCurrent();
        return { workItemType: 'co_managed' as const, workItemId: local.localReferenceId, workItemName };
      }));
  }
  const boundary = resource.kind === 'ticket' ? withCoManagedCustomerTicket : withCoManagedCustomerProject;
  return boundary(db, actor, resource, 'update', async context => {
    if (hiddenIn(context.redactedFields, ['time_entries', 'work_item_id', resource.kind === 'ticket' ? 'ticket_id' : 'task_id'])) throw new CoManagedSharedWorkError();
    return { workItemType: resource.kind as 'ticket' | 'project_task', workItemId: context.resource.id,
      workItemName: await describe(context.trx, actor.tenant, context.resource, context.redactedFields) };
  });
}
