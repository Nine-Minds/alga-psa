import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';
import { appendParticipationEvidence, participationEvidenceTable, type ParticipationEvidenceIdentity } from './participationEvidenceStore';

/**
 * Participation marker for MSP time on shared work. Records actual completed MSP effort (not a
 * registration, a read or a running clock) as `source_type: 'time_entry'` evidence, read only from MSP
 * records, so it keeps working after the customer revokes. The first record survives later edits,
 * staff renames and time deletion. Idempotent per entry. Free for tenants with no co-managed time:
 * a non-`co_managed` entry returns before any further statement.
 */
export async function retainCoManagedTimeParticipation(trx: Knex.Transaction, tenant: string, entryId: string): Promise<void> {
  if (!trx.isTransaction || ![tenant, entryId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, tenant);
  const entry = await owner.table('time_entries').where('entry_id', entryId).forShare().first('work_item_type', 'user_id', 'created_at', 'end_time');
  if (!entry) throw new CoManagedSharedWorkError();
  if (entry.work_item_type !== 'co_managed') return;
  if (!entry.end_time) throw new CoManagedSharedWorkError();
  const reference = await owner.table('co_managed_time_work_references').where('entry_id', entryId).forShare().first();
  if (!reference || reference.customer_tenant === tenant || !['ticket', 'project_task'].includes(reference.source_kind)) throw new CoManagedSharedWorkError();
  const key: ParticipationEvidenceIdentity = { tenant, customer_tenant: reference.customer_tenant, relationship_id: reference.relationship_id,
    resource_type: reference.source_kind, resource_id: reference.source_id, source_type: 'time_entry', source_id: entryId };
  if (await owner.table(participationEvidenceTable).where(key).first('evidence_id')) return;
  const user = await owner.table('users').where('user_id', entry.user_id).forShare().first('first_name', 'last_name', 'username');
  const organization = await owner.table('tenants').first('client_name');
  if (!user || !organization) throw new CoManagedSharedWorkError();
  await appendParticipationEvidence(trx, key, { client_id: reference.client_id, operation_id: entryId, event_type: 'time_recorded',
    actor_tenant: tenant, actor_user_id: entry.user_id, actor_name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || entry.user_id,
    actor_organization: organization.client_name, occurred_at: new Date(entry.created_at ?? entry.end_time).toISOString(),
    payload: { entryId, workReferenceId: reference.reference_id, title: reference.title, ticketNumber: reference.ticket_number, audience: 'organization_private' } });
}
