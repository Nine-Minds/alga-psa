import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveSlaPolicy, getBusinessHoursSchedule } from '@alga-psa/shared/lib/sla/slaPolicyResolver';
import { startOrganizationSlaObligation, applyOrganizationSlaEvent } from '@alga-psa/shared/lib/sla/organizationSlaStore';
import type { CoManagedSharedResource } from './sharedWork';

export class CoManagedSlaSetupError extends Error {
  readonly code = 'CO_MANAGED_SLA_SETUP_REQUIRED';
  constructor() { super('The MSP must configure the SLA policy and priority mapping before this ticket can be escalated.'); this.name = 'CoManagedSlaSetupError'; }
}

/** Called only within the retained handoff transaction. It never admits a user
 * or starts timing for a board grant, queue read, or staff assignment. */
export async function applyCoManagedTicketHandoffSla(trx: Knex.Transaction,
  relationship: { sponsor_tenant: string; sponsor_client_id: string; escalation_board_id: string }, resource: CoManagedSharedResource,
  work: { workId: string; firstEscalatedAt: Date | string | null }, operationId: string,
  transition: 'escalated' | 'handed_back' | 'access_revoked', occurredAt: Date): Promise<void> {
  if (!trx.isTransaction || resource.kind !== 'ticket') throw new Error('SLA handoffs require retained ticket work');
  const owner = tenantDb(trx, relationship.sponsor_tenant), customer = tenantDb(trx, resource.tenant);
  const key = { source_tenant: resource.tenant, ticket_id: resource.id, work_id: work.workId };
  const obligation = await owner.table('sla_organization_obligations').where(key).orderBy('generation', 'desc').first();
  const identity = { tenant: relationship.sponsor_tenant, obligationId: obligation?.obligation_id ?? randomUUID(),
    sourceTenant: resource.tenant, ticketId: resource.id };
  const at = occurredAt.toISOString();
  if (transition !== 'escalated') {
    // Security reduction and handback remain possible for pre-migration work.
    if (obligation) await applyOrganizationSlaEvent(trx, identity, operationId,
      { kind: 'paused', reason: 'customer_responsible', occurredAt: at });
    return;
  }
  if (obligation && !obligation.clock.resolution.completedAt) {
    await applyOrganizationSlaEvent(trx, identity, operationId, { kind: 'resumed', reason: 'customer_responsible', occurredAt: at });
    return;
  }
  // Never turn historic escalations into a fresh deadline merely because their
  // obligation needs explicit migration/reconciliation.
  if (!obligation && work.firstEscalatedAt) throw new CoManagedSlaSetupError();
  const ticket = await customer.table('tickets').where('ticket_id', resource.id).first('priority_id', 'status_id');
  if (!ticket) throw new CoManagedSlaSetupError();
  const status = await customer.table('statuses').where('status_id', ticket.status_id).forShare().first('is_closed');
  if (!status) throw new CoManagedSlaSetupError();
  if (obligation && status?.is_closed) return; // A closed ticket is not a reopened obligation.
  const mapping = await owner.table('co_managed_sla_priority_mappings').where({ customer_tenant: resource.tenant,
    relationship_id: resource.relationshipId, customer_priority_id: ticket.priority_id }).forShare().first();
  if (!mapping) throw new CoManagedSlaSetupError();
  const priority = await owner.table('priorities').where({ priority_id: mapping.msp_priority_id, item_type: 'ticket' }).forShare().first('priority_id');
  if (!priority) throw new CoManagedSlaSetupError();
  await owner.table('clients').where('client_id', relationship.sponsor_client_id).forShare().first('client_id');
  await owner.table('boards').where('board_id', relationship.escalation_board_id).forShare().first('board_id');
  const resolved = await resolveSlaPolicy(trx, identity.tenant, relationship.sponsor_client_id, relationship.escalation_board_id);
  if (!resolved) throw new CoManagedSlaSetupError();
  const policy = await owner.table('sla_policies').where('sla_policy_id', resolved.sla_policy_id).forShare().first();
  const target = await owner.table('sla_policy_targets').where({ sla_policy_id: resolved.sla_policy_id, priority_id: priority.priority_id }).forShare().first();
  if (!policy || !target) throw new CoManagedSlaSetupError();
  const schedule = await getBusinessHoursSchedule(trx, identity.tenant, policy, target);
  identity.obligationId = randomUUID();
  await startOrganizationSlaObligation(trx, identity, operationId, { workId: work.workId, generation: (obligation?.generation ?? 0) + 1,
    policyId: policy.sla_policy_id, priorityId: priority.priority_id, schedule,
    targets: { responseMinutes: target.response_time_minutes, resolutionMinutes: target.resolution_time_minutes }, occurredAt: at });
  // Match native SLA's created-in-closed-status behavior without recording a response.
  if (status?.is_closed) await applyOrganizationSlaEvent(trx, identity, randomUUID(), { kind: 'resolved', occurredAt: at });
}
