import { tenantDb } from '@alga-psa/db';
import type { CoManagedClosureEvidenceContext } from './relationshipClosure';
import type { CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainCoManagedPrivateHistoryAtClosure } from './privateParticipationEvidence';
import { retainCoManagedTimeParticipation } from './timeParticipationEvidence';
import { retainCoManagedHistoricalWorkEvidence } from './historicalWorkEvidence';
import { retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';

/** Production composition for the ticket/task archive sources. Closure owns
 * the exclusive relationship lock and seals these results before ending trust.
 * Discover from actual participation, never time-reference registration or an
 * oversight list; every customer source still requires its effective grant. */
export async function finalizeCoManagedArchive(context: CoManagedClosureEvidenceContext): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, operationId, cutoffAt } = context;
  if (!trx.isTransaction || sponsorTenant === customerTenant || ![sponsorTenant, customerTenant, relationshipId, operationId].every(isCoManagedUuid) ||
      !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id');
  if (!relationship) throw new CoManagedSharedWorkError();
  await retainCoManagedPrivateHistoryAtClosure(context);
  const time = sponsor.table('time_entries as e').where('e.work_item_type', 'co_managed').whereNotNull('e.end_time');
  sponsor.tenantJoin(time, 'co_managed_time_work_references as r', 'e.co_managed_work_reference_id', 'r.reference_id', {
    on: join => join.andOn('e.work_item_id', '=', 'r.reference_id') });
  const entries = await time.where({ 'r.customer_tenant': customerTenant, 'r.relationship_id': relationshipId, 'r.client_id': relationship.sponsor_client_id })
    .orderBy('e.entry_id').forShare('e', 'r').select('e.entry_id');
  for (const entry of entries) await retainCoManagedTimeParticipation(trx, sponsorTenant, entry.entry_id);
  const candidates = new Map<string, CoManagedSharedResource>();
  const add = (kind: 'ticket' | 'project_task', id: string) => candidates.set(`${kind}:${id}`, { tenant: customerTenant, relationshipId, kind, id });
  for (const row of await sponsor.table('co_managed_participation_evidence').where({ customer_tenant: customerTenant, relationship_id: relationshipId,
    client_id: relationship.sponsor_client_id }).distinct('resource_type', 'resource_id')) add(row.resource_type, row.resource_id);
  for (const kind of ['ticket', 'project_task'] as const) {
    const task = kind === 'project_task', id = task ? 'task_id' : 'ticket_id';
    for (const row of await sponsor.table(task ? 'co_managed_project_task_references' : 'co_managed_ticket_references')
      .where({ customer_tenant: customerTenant, relationship_id: relationshipId, client_id: relationship.sponsor_client_id }).select(id)) add(kind, row[id]);
    const comments = customer.table(task ? 'project_task_comments as c' : 'comments as c');
    customer.tenantJoin(comments, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id');
    for (const row of await comments.where('a.actor_tenant', sponsorTenant).distinct(`c.${id}`)) add(kind, row[id]);
  }
  for (const row of await customer.table('co_management_ticket_handoffs').where({ relationship_id: relationshipId, transition: 'escalated', audience: 'shared_it' }).distinct('ticket_id')) add('ticket', row.ticket_id);
  const audits = await customer.table('audit_logs').whereIn('table_name', ['tickets', 'project_tasks'])
    .whereIn('operation', ['co_managed_ticket_assignment', 'co_managed_project_task_update', 'co_managed_project_task_assignment']).select('table_name', 'record_id', 'details');
  for (const audit of audits) {
    const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
    if (details?.relationship_id === relationshipId && details.actor_tenant === sponsorTenant && isCoManagedUuid(audit.record_id)) {
      add(audit.table_name === 'tickets' ? 'ticket' : 'project_task', audit.record_id);
    }
  }
  for (const resource of [...candidates.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))) {
    await retainCoManagedHistoricalWorkEvidence(context, resource);
    await retainCoManagedSharedConversationBeforeReduction(trx, resource, operationId, { cutoffAt });
  }
}
