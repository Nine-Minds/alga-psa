import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSessionActor, type CoManagedSharedResource } from './sharedWork';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, snapshotCoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';

/** Register an MSP-local work identity for the existing time/billing engine.
 * It captures only admitted descriptive evidence; opening a time picker alone
 * does not constitute archive participation or create a time entry. */
export async function registerCoManagedTimeWorkReference(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource) {
  actor = snapshotCoManagedSessionActor(actor);
  if (!resource || !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  return withCoManagedSharedWork(db, actor, resource, 'update', write =>
    withCoManagedSharedWork(write.trx, actor, write.resource, 'read', async read => {
      const { trx } = read, source = read.resource, home = tenantDb(trx, read.actor.tenant), owner = tenantDb(trx, source.tenant);
      const relationship = await owner.table('co_management_relationships').where('relationship_id', source.relationshipId).first('sponsor_client_id');
      if (!relationship) throw new CoManagedSharedWorkError();
      const client = await home.table('clients').where({ client_id: relationship.sponsor_client_id, is_inactive: false }).forShare().first('client_id');
      if (!client) throw new CoManagedSharedWorkError();
      const subject = await lockCoManagedSessionIdentity(trx, { ...read.actor, kind: 'session', sessionId: read.sessionId });
      const record = { clientId: client.client_id, ownerUserId: read.actor.userId, assignedUserIds: [read.actor.userId] };
      for (const action of ['read', 'create'] as const) {
        const decision = await authorizeCoManagedLocalRecord(trx, read.actor, subject, 'time_entry', action, record);
        if (isCoManagedReadFieldHidden(decision.redactedFields, ['work_item_id', 'work_item_type', 'client_id', 'time_entries.work_item_id', 'time_entries.work_item_type'])) throw new CoManagedSharedWorkError();
      }
      const fields = [...read.redactedFields, ...write.redactedFields];
      const hidden = (...names: string[]) => isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `tickets.${name}`, `project_tasks.${name}`]));
      if (hidden('work_item_id', 'time_entries', source.kind === 'ticket' ? 'ticket_id' : 'task_id')) throw new CoManagedSharedWorkError();
      const row = source.kind === 'ticket'
        ? await owner.table('tickets').where('ticket_id', source.id).first('title', 'ticket_number', 'attributes')
        : await owner.table('project_tasks').where('task_id', source.id).first('task_name', 'description');
      if (!row) throw new CoManagedSharedWorkError();
      const attributes = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
      const identity = { customer_tenant: source.tenant, relationship_id: source.relationshipId, source_kind: source.kind, source_id: source.id };
      const evidence = { ticket_number: source.kind === 'ticket' && !hidden('ticket_number') ? row.ticket_number : null,
        title: hidden('name', 'title', 'task_name') ? null : row.title ?? row.task_name ?? null,
        description: hidden('description', 'attributes.description') ? null : source.kind === 'ticket' ? attributes?.description ?? null : row.description ?? null };
      await home.table('co_managed_time_work_references').insert({ tenant: read.actor.tenant, ...identity, ...evidence, client_id: client.client_id })
        .onConflict(['tenant', 'customer_tenant', 'relationship_id', 'source_kind', 'source_id']).ignore();
      const reference = await home.table('co_managed_time_work_references').where(identity).forShare().first();
      if (!reference || reference.client_id !== client.client_id) throw new CoManagedSharedWorkError();
      await assertCoManagedSessionUnexpired(trx, { ...read.actor, kind: 'session', sessionId: read.sessionId });
      await assertCoManagedOperationalWrite(trx, source.tenant);
      // Use current admitted text for the picker. Stored evidence is never an
      // alternate live read path after a field/grant revocation.
      return { referenceId: reference.reference_id as string, resource: source, title: evidence.title as string | null };
    }));
}
