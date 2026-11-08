import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { appendParticipationEvidence, participationEvidenceTable, type ParticipationEvidenceIdentity } from './participationEvidenceStore';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

// ---------------------------------------------------------------------------
// Access-reduction retainer registry (PLAN §5 interface seam owned by L2).
//
// Shrinking what an MSP can see (removing a board/project scope, switching to
// escalation_only, ending a relationship) must first let every layer that holds
// shared history (conversations, time, handoffs) retain what the MSP already
// legitimately participated in. L2 owns the seam; L3/L4 register retainers.
// With nothing registered the reduction proceeds with no extra work.
// ---------------------------------------------------------------------------

export interface CoManagedAccessReductionContext {
  trx: Knex.Transaction;
  customerTenant: string;
  relationshipId: string;
  /** Shared by every retainer in one reduction so their captures correlate. */
  operationId: string;
  resources: Array<{ kind: 'ticket' | 'project_task'; id: string }>;
}
export type CoManagedAccessReductionRetainer = (context: CoManagedAccessReductionContext) => Promise<void>;

const retainers = new Map<string, CoManagedAccessReductionRetainer>();

/** Idempotent per name, so module re-evaluation (HMR, test isolation) never double-registers. */
export function registerCoManagedAccessReductionRetainer(name: string, retainer: CoManagedAccessReductionRetainer): () => void {
  retainers.set(name, retainer);
  return () => { if (retainers.get(name) === retainer) retainers.delete(name); };
}

/** Runs inside the reducing transaction, before the grant rows change. */
export async function retainCoManagedBeforeAccessReduction(context: CoManagedAccessReductionContext): Promise<void> {
  if (!context.trx.isTransaction) throw new CoManagedSharedWorkError();
  if (!context.resources.length) return;
  for (const [, retainer] of [...retainers].sort(([a], [b]) => a.localeCompare(b))) await retainer(context);
}

// ---------------------------------------------------------------------------
// Participation evidence writer
// ---------------------------------------------------------------------------

type Source = 'ticket_handoff' | 'work_audit';
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value ?? {};

/** Internal writer hook. Reads the committed-in-this-transaction source event,
 * never caller-provided history. Captures only already-shared audit fields.
 * Handoff-sourced evidence (L3b1) reads the immutable handoff row written in this transaction. */
export async function retainCoManagedParticipationEvidence(context: CoManagedSharedWorkContext, source: Source, sourceId: string): Promise<void> {
  const { trx, resource, actor } = context;
  if (!trx.isTransaction || context.action !== 'update' || !['ticket', 'project_task'].includes(resource.kind) ||
      !['ticket_handoff', 'work_audit'].includes(source) || !isCoManagedUuid(sourceId)) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, resource.tenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_tenant', 'sponsor_client_id');
  if (!relationship || ![resource.tenant, relationship.sponsor_tenant].includes(actor.tenant)) throw new CoManagedSharedWorkError();
  if (source === 'ticket_handoff') {
    if (resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
    const handoff = await customer.table('co_management_ticket_handoffs').where({ operation_id: sourceId, relationship_id: resource.relationshipId,
      ticket_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId, audience: 'shared_it' }).forShare().first();
    if (!handoff) throw new CoManagedSharedWorkError();
    const subject = await customer.table('tickets').where('ticket_id', resource.id).first('title', 'ticket_number');
    const identity: ParticipationEvidenceIdentity = { tenant: relationship.sponsor_tenant, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
      resource_type: 'ticket', resource_id: resource.id, source_type: 'ticket_handoff', source_id: sourceId };
    await appendParticipationEvidence(trx, identity, { client_id: relationship.sponsor_client_id, operation_id: handoff.operation_id, event_type: handoff.transition,
      actor_tenant: actor.tenant, actor_user_id: actor.userId, actor_name: handoff.actor_name, actor_organization: handoff.actor_organization,
      occurred_at: new Date(handoff.occurred_at).toISOString(),
      payload: { revision: handoff.revision, note: handoff.note, audience: 'shared_it', resourceTitle: subject?.title ?? null, ticketNumber: subject?.ticket_number ?? null } });
    return;
  }
  const event = await customer.table('audit_logs').where({ audit_id: sourceId, table_name: resource.kind === 'ticket' ? 'tickets' : 'project_tasks', record_id: resource.id })
    .whereIn('operation', resource.kind === 'ticket' ? ['co_managed_ticket_assignment'] : ['co_managed_project_task_update', 'co_managed_project_task_assignment'])
    .forShare().first();
  const details = object(event?.details);
  if (!event || details.relationship_id !== resource.relationshipId || details.actor_tenant !== actor.tenant || details.actor_user_id !== actor.userId ||
      !isCoManagedUuid(details.operation_id)) throw new CoManagedSharedWorkError();
  const changes = object(event.changed_data), allowed: Record<string, unknown> = {};
  for (const field of ['task_name', 'due_date', 'project_status_mapping_id', 'msp_assignment']) {
    if (Object.hasOwn(changes, field) && (changes[field] === null || typeof changes[field] === 'string')) allowed[field] = changes[field];
  }
  if (typeof details.actor_display_name !== 'string' || typeof details.actor_organization_name !== 'string') throw new CoManagedSharedWorkError();
  const work = await customer.table(resource.kind === 'ticket' ? 'tickets' : 'project_tasks').where(resource.kind === 'ticket' ? 'ticket_id' : 'task_id', resource.id)
    .first(...(resource.kind === 'ticket' ? ['title', 'ticket_number'] : ['task_name']));
  const key: ParticipationEvidenceIdentity = { tenant: relationship.sponsor_tenant, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: resource.kind as 'ticket' | 'project_task', resource_id: resource.id, source_type: source, source_id: sourceId };
  await appendParticipationEvidence(trx, key, { client_id: relationship.sponsor_client_id, operation_id: details.operation_id, event_type: event.operation,
    actor_tenant: actor.tenant, actor_user_id: actor.userId, actor_name: details.actor_display_name, actor_organization: details.actor_organization_name,
    occurred_at: new Date(event.timestamp).toISOString(),
    payload: { changes: allowed, audience: 'shared_it', resourceTitle: work?.title ?? work?.task_name ?? null, ticketNumber: work?.ticket_number ?? null } });
}

export { participationEvidenceTable };
