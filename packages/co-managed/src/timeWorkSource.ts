import type { Knex } from 'knex';
import type { AuthorizationSubject, AuthorizationRecord } from '@alga-psa/authorization';
import type { IWorkItem } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedAuthenticatedSharedWork, type CoManagedSharedResource } from './sharedWork';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import type { CoManagedAuthenticatedActor } from './localAuthentication';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** New contributions use live collaboration authority. Retained time or an
 * actually started, owned clock is evidence of the MSP's existing effort.
 * It remains usable after revocation under current home work/time permissions,
 * without querying newly private customer data. */
export async function admitCoManagedTimeWorkSource(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject,
  referenceId: string, existingEffortId?: string | null) {
  if (!trx.isTransaction || !isCoManagedUuid(referenceId)) throw new CoManagedSharedWorkError();
  const home = tenantDb(trx, actor.tenant);
  const reference = await home.table('co_managed_time_work_references').where('reference_id', referenceId).first();
  if (!reference) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { tenant: reference.customer_tenant, relationshipId: reference.relationship_id, kind: reference.source_kind, id: reference.source_id };
  const retainedEntry = existingEffortId ? await home.table('time_entries').where({ entry_id: existingEffortId, work_item_type: 'co_managed',
    work_item_id: referenceId, co_managed_work_reference_id: referenceId }).first('entry_id') : null;
  const retainedClock = existingEffortId && !retainedEntry ? await home.table('native_time_tracking_sessions').where({
    session_id: existingEffortId, user_id: actor.userId, work_item_type: 'co_managed', work_item_id: referenceId,
    co_managed_work_reference_id: referenceId }).whereNull('completed_entry_id').forShare().first('session_id') : null;
  const localRecord = async (): Promise<AuthorizationRecord> => {
    const referenceTable = resource.kind === 'ticket' ? 'co_managed_ticket_references' : 'co_managed_project_task_references';
    const route = await home.table(referenceTable).where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
      [resource.kind === 'ticket' ? 'ticket_id' : 'task_id']: resource.id, client_id: reference.client_id }).forShare().first();
    const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`, clientId: reference.client_id,
      boardId: resource.kind === 'ticket' ? route?.board_id : undefined, assignedUserIds: route?.assigned_to ? [route.assigned_to] : [],
      teamIds: route?.assigned_team_id ? [route.assigned_team_id] : [] };
    return record;
  };
  const present = (fields: readonly string[], evidence: { title?: string | null; description?: string | null; ticket_number?: string | null }, assertCurrent: () => Promise<void>, record: AuthorizationRecord) => {
    const hidden = (...names: string[]) => isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `tickets.${name}`, `project_tasks.${name}`]));
    if (hidden('time_entries', 'work_item_id', resource.kind === 'ticket' ? 'ticket_id' : 'task_id')) throw new CoManagedSharedWorkError();
    const workItem: IWorkItem & { ticket_number?: string } = { work_item_id: referenceId, type: 'co_managed',
      name: hidden('title', 'task_name', 'name') ? '' : evidence.title ?? '',
      description: hidden('description', 'attributes.description') ? '' : evidence.description ?? '', is_billable: true };
    if (resource.kind === 'ticket' && evidence.ticket_number && !hidden('ticket_number')) workItem.ticket_number = evidence.ticket_number;
    return { record, fields, workItem, billingProfileId: reference.billing_profile_id as string | null, assertCurrent };
  };
  const retainReference = async (write: boolean) => {
    const query = home.table('co_managed_time_work_references').where('reference_id', referenceId);
    if (write) query.forUpdate(); else query.forShare();
    const current = await query.first();
    if (!current || ['customer_tenant', 'relationship_id', 'source_kind', 'source_id', 'client_id', 'billing_profile_id'].some(key => current[key] !== reference[key])) throw new CoManagedSharedWorkError();
    return current;
  };
  if (retainedEntry || retainedClock) {
    const current = await retainReference(false);
    const record = await localRecord();
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, resource.kind === 'ticket' ? 'ticket' : 'project', 'read', record);
    return present(decision.redactedFields, current, async () => {}, record);
  }
  return withCoManagedAuthenticatedSharedWork(trx, actor, resource, 'update', write =>
    withCoManagedAuthenticatedSharedWork(trx, actor, resource, 'read', async read => {
      const relationship = await tenantDb(trx, resource.tenant).table('co_management_relationships').where('relationship_id', resource.relationshipId).first('sponsor_client_id');
      if (relationship?.sponsor_client_id !== reference.client_id) throw new CoManagedSharedWorkError();
      const owner = tenantDb(trx, resource.tenant);
      const row = resource.kind === 'ticket' ? await owner.table('tickets').where('ticket_id', resource.id).first('title', 'ticket_number', 'attributes')
        : await owner.table('project_tasks').where('task_id', resource.id).first('task_name', 'description');
      if (!row) throw new CoManagedSharedWorkError();
      const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
      // LEVERAGE: pattern time-work-evidence — registration and live time-source admission capture the same allowlisted descriptive fields.
      const presented = present([...write.redactedFields, ...read.redactedFields], { title: row.title ?? row.task_name,
        description: resource.kind === 'ticket' ? attrs?.description : row.description, ticket_number: row.ticket_number }, async () => {
        await write.assertCurrent(); await read.assertCurrent();
      }, await localRecord());
      await retainReference(true);
      await home.table('co_managed_time_work_references').where('reference_id', referenceId).update({
        title: presented.workItem.name || null, description: presented.workItem.description || null,
        ticket_number: presented.workItem.ticket_number ?? null, captured_at: trx.raw('clock_timestamp()'),
      });
      return presented;
    }));
}
