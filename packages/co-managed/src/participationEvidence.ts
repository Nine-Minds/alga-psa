import { tenantDb } from '@alga-psa/db';
import { appendParticipationEvidence, participationEvidenceTable as TABLE, type ParticipationEvidenceIdentity } from './participationEvidenceStore';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

type Source = 'ticket_handoff' | 'work_audit';
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value ?? {};

/** Internal writer hook. Read the committed-in-this-transaction source event,
 * never caller-provided history or an oversight projection. This captures only
 * already-shared handoff/audit fields; archive content and file capture use
 * separate audience-aware adapters. No later worker may refresh these rows. */
export async function retainCoManagedParticipationEvidence(context: CoManagedSharedWorkContext, source: Source, sourceId: string): Promise<void> {
  const { trx, resource, actor } = context;
  if (!trx.isTransaction || context.action !== 'update' || !['ticket', 'project_task'].includes(resource.kind) ||
      !['ticket_handoff', 'work_audit'].includes(source) || !isCoManagedUuid(sourceId)) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, resource.tenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_tenant', 'sponsor_client_id');
  if (!relationship || ![resource.tenant, relationship.sponsor_tenant].includes(actor.tenant)) throw new CoManagedSharedWorkError();
  const sponsor = tenantDb(trx, relationship.sponsor_tenant);
  let eventType: string, operationId: string, occurredAt: string, name: string, organization: string, payload: Record<string, unknown>;
  if (source === 'ticket_handoff') {
    if (resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
    const event = await customer.table('co_management_ticket_handoffs').where({ operation_id: sourceId, relationship_id: resource.relationshipId,
      ticket_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId, audience: 'shared_it' }).forShare().first();
    if (!event) throw new CoManagedSharedWorkError();
    eventType = event.transition; operationId = event.operation_id; occurredAt = new Date(event.occurred_at).toISOString();
    name = event.actor_name; organization = event.actor_organization;
    payload = { revision: event.revision, note: event.note, audience: 'shared_it' };
  } else {
    const event = await customer.table('audit_logs').where({ audit_id: sourceId, table_name: resource.kind === 'ticket' ? 'tickets' : 'project_tasks', record_id: resource.id })
      .whereIn('operation', resource.kind === 'ticket' ? ['co_managed_ticket_assignment'] : ['co_managed_project_task_update', 'co_managed_project_task_assignment'])
      .forShare().first();
    const details = object(event?.details);
    if (!event || details.relationship_id !== resource.relationshipId || details.actor_tenant !== actor.tenant || details.actor_user_id !== actor.userId ||
        !isCoManagedUuid(details.operation_id)) throw new CoManagedSharedWorkError();
    if (actor.tenant === resource.tenant) {
      const key = { customer_tenant: resource.tenant, relationship_id: resource.relationshipId };
      const reference = await sponsor.table(resource.kind === 'ticket' ? 'co_managed_ticket_references' : 'co_managed_project_task_references')
        .where({ ...key, [resource.kind === 'ticket' ? 'ticket_id' : 'task_id']: resource.id, client_id: relationship.sponsor_client_id }).forShare().first('reference_id');
      // Customer-only work is not MSP participation. An assignment (including
      // one since withdrawn), received handoff or prior contribution proves it.
      if (!reference && !await sponsor.table(TABLE).where({ ...key, resource_type: resource.kind, resource_id: resource.id }).first('evidence_id')) return;
    }
    const changes = object(event.changed_data), allowed: Record<string, unknown> = {};
    for (const field of ['task_name', 'due_date', 'project_status_mapping_id', 'msp_assignment']) {
      if (Object.hasOwn(changes, field) && (changes[field] === null || typeof changes[field] === 'string')) allowed[field] = changes[field];
    }
    eventType = event.operation; operationId = details.operation_id; occurredAt = new Date(event.timestamp).toISOString();
    name = details.actor_display_name; organization = details.actor_organization_name;
    payload = { changes: allowed, audience: 'shared_it' };
  }
  if (typeof name !== 'string' || typeof organization !== 'string') throw new CoManagedSharedWorkError();
  const key: ParticipationEvidenceIdentity = { tenant: relationship.sponsor_tenant, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id, source_type: source, source_id: sourceId };
  const retained = { client_id: relationship.sponsor_client_id, operation_id: operationId, event_type: eventType,
    actor_tenant: actor.tenant, actor_user_id: actor.userId, actor_name: name, actor_organization: organization, occurred_at: occurredAt, payload };
  await appendParticipationEvidence(trx, key, retained);
}
