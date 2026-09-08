import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedResource } from './sharedWork';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { readCoManagedSummaryCandidates } from './sharedWorkRead';
import { appendParticipationEvidence, participationEvidenceTable } from './participationEvidenceStore';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** Preserve the existing allowlisted shared metadata, never rich/private source
 * fields. A live grant plus actual MSP participation is required. Run after
 * conversation/private/time capture so those real contributions also qualify. */
export async function retainCoManagedWorkSnapshot(trx: Knex.Transaction, resource: CoManagedSharedResource, operationId: string, cutoffAt: Date): Promise<void> {
  if (!trx.isTransaction || !['ticket', 'project_task'].includes(resource.kind) ||
      ![resource.tenant, resource.relationshipId, resource.id, operationId].every(isCoManagedUuid) || !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, resource.tenant), task = resource.kind === 'project_task';
  const relationship = await owner.table('co_management_relationships').where({ relationship_id: resource.relationshipId, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_tenant', 'sponsor_client_id');
  if (!relationship || !await hasEffectiveSharedGrant(trx, resource)) return;
  const sponsor = tenantDb(trx, relationship.sponsor_tenant), key = { customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id };
  const participated = await sponsor.table(participationEvidenceTable).where({ ...key, client_id: relationship.sponsor_client_id }).first('evidence_id') ||
    await sponsor.table(task ? 'co_managed_project_task_references' : 'co_managed_ticket_references')
      .where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, client_id: relationship.sponsor_client_id,
        [task ? 'task_id' : 'ticket_id']: resource.id }).forShare().first('reference_id');
  if (!participated) return;
  if (!await owner.table(task ? 'project_tasks' : 'tickets').where(task ? 'task_id' : 'ticket_id', resource.id).forShare().first()) return;
  const summary = await readCoManagedSummaryCandidates(trx, resource);
  await appendParticipationEvidence(trx, { tenant: relationship.sponsor_tenant, ...key, source_type: 'work_snapshot', source_id: randomUUID() },
    { client_id: relationship.sponsor_client_id, operation_id: operationId, event_type: 'work_archived', occurred_at: new Date(cutoffAt).toISOString(),
      actor_tenant: resource.tenant, actor_user_id: null, actor_kind: 'system', actor_name: '', actor_organization: '',
      payload: { audience: 'shared_it', resourceTitle: summary.title?.value ?? summary.task_name?.value ?? null,
        ticketNumber: summary.ticket_number?.value ?? null, summary } });
}
