import type { CoManagedClosureEvidenceContext } from './relationshipClosure';
import type { CoManagedSharedResource } from './sharedWork';
import { tenantDb } from '@alga-psa/db';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { readCoManagedSummaryCandidates } from './sharedWorkRead';
import { appendParticipationEvidence, participationEvidenceTable } from './participationEvidenceStore';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value ?? {};

/** Recover only missing, currently permitted handoff/collaboration audit sources.
 * Actual saved event actors are historical attribution, never a fabricated
 * session or writer context. Existing immutable evidence is not refreshed. */
export async function retainCoManagedHistoricalWorkEvidence(context: CoManagedClosureEvidenceContext, resource: CoManagedSharedResource): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, cutoffAt } = context;
  if (!trx.isTransaction || resource.tenant !== customerTenant || resource.relationshipId !== relationshipId ||
      !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant), task = resource.kind === 'project_task';
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id');
  if (!relationship || !await hasEffectiveSharedGrant(trx, resource)) return;
  if (!await customer.table(task ? 'project_tasks' : 'tickets').where(task ? 'task_id' : 'ticket_id', resource.id).forShare().first()) return;
  const handoffs = task ? [] : await customer.table('co_management_ticket_handoffs').where({ relationship_id: relationshipId, ticket_id: resource.id, audience: 'shared_it' })
    .where('occurred_at', '<=', cutoffAt).orderBy('occurred_at').forShare();
  const audits = await customer.table('audit_logs').where({ table_name: task ? 'project_tasks' : 'tickets', record_id: resource.id })
    .whereIn('operation', task ? ['co_managed_project_task_update', 'co_managed_project_task_assignment'] : ['co_managed_ticket_assignment'])
    .where('timestamp', '<=', cutoffAt).orderBy('timestamp').forShare();
  const qualifiedAudits = audits.map(row => ({ row, details: object(row.details) })).filter(({ details }) => details.relationship_id === relationshipId &&
    [customerTenant, sponsorTenant].includes(details.actor_tenant) && isCoManagedUuid(details.actor_user_id) && isCoManagedUuid(details.operation_id));
  const key = { customer_tenant: customerTenant, relationship_id: relationshipId, resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id };
  const participated = handoffs.some(row => row.transition === 'escalated') || qualifiedAudits.some(event => event.details.actor_tenant === sponsorTenant) ||
    await sponsor.table(participationEvidenceTable).where({ ...key, client_id: relationship.sponsor_client_id }).first('evidence_id') ||
    await sponsor.table(task ? 'co_managed_project_task_references' : 'co_managed_ticket_references').where({ customer_tenant: customerTenant,
      relationship_id: relationshipId, client_id: relationship.sponsor_client_id, [task ? 'task_id' : 'ticket_id']: resource.id }).forShare().first('reference_id');
  if (!participated) return;
  const summary = await readCoManagedSummaryCandidates(trx, resource);
  const title = summary.title?.value ?? summary.task_name?.value ?? null, number = summary.ticket_number?.value ?? null;
  for (const event of handoffs) {
    if (![customerTenant, sponsorTenant].includes(event.actor_tenant) || !isCoManagedUuid(event.actor_user_id)) continue;
    const identity = { tenant: sponsorTenant, ...key, source_type: 'ticket_handoff' as const, source_id: event.operation_id };
    if (await sponsor.table(participationEvidenceTable).where(identity).first('evidence_id')) continue;
    if (typeof event.actor_name !== 'string' || typeof event.actor_organization !== 'string') throw new Error('Historical handoff attribution is incomplete');
    await appendParticipationEvidence(trx, identity, { client_id: relationship.sponsor_client_id, operation_id: event.operation_id,
      event_type: event.transition, occurred_at: new Date(event.occurred_at).toISOString(), actor_tenant: event.actor_tenant, actor_user_id: event.actor_user_id,
      actor_name: event.actor_name, actor_organization: event.actor_organization,
      payload: { revision: event.revision, note: event.note, audience: 'shared_it', resourceTitle: title, ticketNumber: number } });
  }
  for (const { row, details } of qualifiedAudits) {
    const identity = { tenant: sponsorTenant, ...key, source_type: 'work_audit' as const, source_id: row.audit_id };
    if (await sponsor.table(participationEvidenceTable).where(identity).first('evidence_id')) continue;
    if (typeof details.actor_display_name !== 'string' || typeof details.actor_organization_name !== 'string') throw new Error('Historical collaboration audit attribution is incomplete');
    const changed = object(row.changed_data), changes: Record<string, string | null> = {};
    for (const field of ['task_name', 'due_date', 'project_status_mapping_id', 'msp_assignment']) {
      if (Object.hasOwn(changed, field) && (changed[field] === null || typeof changed[field] === 'string')) changes[field] = changed[field];
    }
    await appendParticipationEvidence(trx, identity, { client_id: relationship.sponsor_client_id, operation_id: details.operation_id, event_type: row.operation,
      occurred_at: new Date(row.timestamp).toISOString(), actor_tenant: details.actor_tenant, actor_user_id: details.actor_user_id,
      actor_name: details.actor_display_name, actor_organization: details.actor_organization_name,
      payload: { changes, audience: 'shared_it', resourceTitle: title, ticketNumber: number } });
  }
}
