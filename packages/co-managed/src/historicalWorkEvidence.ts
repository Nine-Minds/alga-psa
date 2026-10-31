import type { Knex } from 'knex';
import type { CoManagedSharedResource } from './sharedWork';
import { tenantDb } from '@alga-psa/db';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { readCoManagedSummaryCandidates } from './sharedWorkRead';
import { appendParticipationEvidence, participationEvidenceTable } from './participationEvidenceStore';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** Structural context supplied by the relationship-closure writer (lands with L3/closure). */
export interface CoManagedClosureEvidenceContext {
  trx: Knex.Transaction; sponsorTenant: string; customerTenant: string; relationshipId: string; cutoffAt: Date;
}
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value ?? {};

/** Recover only missing, currently permitted collaboration audit sources (and
 * handoffs once L3 tables exist). Actual saved event actors are historical
 * attribution, never a fabricated session or writer context. Existing immutable
 * evidence is not refreshed. */
export async function retainCoManagedHistoricalWorkEvidence(context: CoManagedClosureEvidenceContext, resource: CoManagedSharedResource): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, cutoffAt } = context;
  if (!trx.isTransaction || resource.tenant !== customerTenant || resource.relationshipId !== relationshipId ||
      !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant), task = resource.kind === 'project_task';
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id');
  if (!relationship || !await hasEffectiveSharedGrant(trx, resource)) return;
  if (!await customer.table(task ? 'project_tasks' : 'tickets').where(task ? 'task_id' : 'ticket_id', resource.id).forShare().first()) return;
  // L3: handoff evidence needs co_management_ticket_handoffs, which does not exist until L3b1.
  const handoffs = !task && await trx.schema.hasTable('co_management_ticket_handoffs')
    ? await customer.table('co_management_ticket_handoffs').where({ relationship_id: relationshipId, ticket_id: resource.id, audience: 'shared_it' })
      .where('occurred_at', '<=', cutoffAt).orderBy('occurred_at').forShare() : [];
  const audits = await customer.table('audit_logs').where({ table_name: task ? 'project_tasks' : 'tickets', record_id: resource.id })
    .whereIn('operation', task ? ['co_managed_project_task_update', 'co_managed_project_task_assignment'] : ['co_managed_ticket_assignment'])
    .where('timestamp', '<=', cutoffAt).orderBy('timestamp').forShare();
  const qualifiedAudits = audits.map((row: any) => ({ row, details: object(row.details) })).filter(({ details }: any) => details.relationship_id === relationshipId &&
    [customerTenant, sponsorTenant].includes(details.actor_tenant) && isCoManagedUuid(details.actor_user_id) && isCoManagedUuid(details.operation_id));
  const key = { customer_tenant: customerTenant, relationship_id: relationshipId, resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id };
  let participated = handoffs.some((row: any) => row.transition === 'escalated') || qualifiedAudits.some((event: any) => event.details.actor_tenant === sponsorTenant) ||
    Boolean(await sponsor.table(participationEvidenceTable).where({ ...key, client_id: relationship.sponsor_client_id }).first('evidence_id'));
  // L3: sponsor-side reference tables land later.
  const referenceTable = task ? 'co_managed_project_task_references' : 'co_managed_ticket_references';
  if (!participated && await trx.schema.hasTable(referenceTable)) {
    participated = Boolean(await sponsor.table(referenceTable).where({ customer_tenant: customerTenant, relationship_id: relationshipId,
      client_id: relationship.sponsor_client_id, [task ? 'task_id' : 'ticket_id']: resource.id }).forShare().first('reference_id'));
  }
  if (!participated) return;
  const summary = await readCoManagedSummaryCandidates(trx, resource);
  const title = summary.title?.value ?? summary.task_name?.value, number = summary.ticket_number?.value;
  const disclosed = { audience: 'shared_it', ...(title ? { resourceTitle: title } : {}), ...(number ? { ticketNumber: number } : {}) };
  for (const event of handoffs as any[]) {
    if (![customerTenant, sponsorTenant].includes(event.actor_tenant) || !isCoManagedUuid(event.actor_user_id)) continue;
    const identity = { tenant: sponsorTenant, ...key, source_type: 'ticket_handoff' as const, source_id: event.operation_id };
    if (await sponsor.table(participationEvidenceTable).where(identity).first('evidence_id')) continue;
    if (typeof event.actor_name !== 'string' || typeof event.actor_organization !== 'string') throw new Error('Historical handoff attribution is incomplete');
    await appendParticipationEvidence(trx, identity, { client_id: relationship.sponsor_client_id, operation_id: event.operation_id,
      event_type: event.transition, occurred_at: new Date(event.occurred_at).toISOString(), actor_tenant: event.actor_tenant, actor_user_id: event.actor_user_id,
      actor_name: event.actor_name, actor_organization: event.actor_organization,
      payload: { revision: event.revision, ...(event.note ? { note: event.note } : {}), ...disclosed } });
  }
  for (const { row, details } of qualifiedAudits as any[]) {
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
      payload: { changes, ...disclosed } });
  }
}
