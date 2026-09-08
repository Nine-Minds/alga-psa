import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveSlaPolicy, getBusinessHoursSchedule } from '@alga-psa/shared/lib/sla/slaPolicyResolver';
import { startOrganizationSlaObligation, applyOrganizationSlaEvent } from '@alga-psa/shared/lib/sla/organizationSlaStore';
import { acquireOrganizationSlaLock } from '@alga-psa/shared/lib/sla/organizationSlaLock';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import type { CoManagedSharedResource, CoManagedSharedWorkContext } from './sharedWork';

export class CoManagedSlaSetupError extends Error {
  readonly code = 'CO_MANAGED_SLA_SETUP_REQUIRED';
  constructor() { super('The MSP must configure its SLA policy and priority mapping before starting a new SLA obligation.'); this.name = 'CoManagedSlaSetupError'; }
}

/** Retained source mutation only. No new live facts cross a completely removed
 * ticket grant, even when an old MSP obligation still exists for retention. */
async function currentTicketObligation(trx: Knex.Transaction, customerTenant: string, ticketId: string, relationshipId?: string) {
  if (!trx.isTransaction) throw new Error('Organization SLA effects require the source transaction');
  const customer = tenantDb(trx, customerTenant);
  const tenant = await customer.table('tenants').first('product_code', 'suspended_at');
  if (tenant?.product_code !== 'co_managed' || tenant.suspended_at) return null;
  const query = customer.table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at');
  if (relationshipId) query.where('relationship_id', relationshipId);
  const relationship = await query.forShare().first();
  if (!relationship) return null;
  const ticket = await customer.table('tickets').where('ticket_id', ticketId).forUpdate().first('ticket_id', 'board_id', 'status_id');
  if (!ticket) return null;
  const work = await customer.table('co_management_ticket_work').where({ relationship_id: relationship.relationship_id, ticket_id: ticketId }).forUpdate().first();
  if (!work?.first_escalated_at) return null;
  const board = relationship.visibility_mode === 'board_scope' ? await customer.table('co_management_board_scopes')
    .where({ relationship_id: relationship.relationship_id, board_id: ticket.board_id }).forShare().first('board_id') : null;
  if (work.grant_revoked_at && !board) return null;
  const owner = tenantDb(trx, relationship.sponsor_tenant);
  const sponsor = await owner.table('tenants').first('product_code', 'suspended_at');
  if (sponsor?.product_code !== 'psa' || sponsor.suspended_at) return null;
  const obligation = await owner.table('sla_organization_obligations').where({ source_tenant: customerTenant, ticket_id: ticketId, work_id: work.work_id })
    .orderBy('generation', 'desc').first();
  if (!obligation) return null;
  const identity = { tenant: relationship.sponsor_tenant as string, obligationId: obligation.obligation_id as string,
    sourceTenant: customerTenant, ticketId };
  await acquireOrganizationSlaLock(trx, identity);
  const current = await owner.table('sla_organization_obligations').where('obligation_id', identity.obligationId).forUpdate().first();
  return { customer, relationship, ticket, work, identity, obligation: current };
}

/** Count an actually inserted MSP reply, using the persisted actor reference and
 * effective root/reply audience. Editing/disclosing old notes is not a reply. */
export async function recordCoManagedTicketFirstResponse(context: CoManagedSharedWorkContext, commentId: string, actorReferenceId?: string): Promise<void> {
  if (context.action !== 'update' || context.resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  if (context.actor.tenant === context.resource.tenant) return;
  const retained = await currentTicketObligation(context.trx, context.resource.tenant, context.resource.id, context.resource.relationshipId);
  if (!retained || retained.obligation.clock.response.completedAt || retained.obligation.clock.resolution.completedAt) return;
  const { customer, identity } = retained;
  if (context.actor.tenant !== identity.tenant || !actorReferenceId) throw new CoManagedSharedWorkError();
  const author = await customer.table('collaboration_actor_references').where({ actor_reference_id: actorReferenceId,
    actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId }).forShare().first('actor_reference_id');
  if (!author) throw new CoManagedSharedWorkError();
  const query = customer.table('comments as c').where({ 'c.comment_id': commentId, 'c.ticket_id': context.resource.id,
    'c.actor_reference_id': actorReferenceId, 'c.author_type': 'internal', 'c.publish_state': 'published', 'c.is_system_generated': false })
    .whereNull('c.user_id').whereNull('c.contact_id').whereNull('c.deleted_at');
  customer.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
  customer.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id',
    { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
  const comment = await query.where('root.publish_state', 'published').whereNull('root.deleted_at')
    .forShare('c', 't', 'root').select({ audience: commentAudienceSql(context.trx, 't', 'root', 'c') }).first();
  if (!comment || !['requester', 'shared_it'].includes(comment.audience)) throw new CoManagedSharedWorkError();
  const at = (await context.trx.select({ at: context.trx.raw('clock_timestamp()') }).first()).at;
  await applyOrganizationSlaEvent(context.trx, identity, commentId,
    { kind: 'responded', actorTenant: context.actor.tenant, audience: comment.audience, occurredAt: at.toISOString() });
}

/** A successful canonical close can finish a still-shared MSP obligation even
 * while customer IT is responsible. It does not create or restart any clock. */
export async function recordCoManagedTicketResolution(trx: Knex.Transaction, customerTenant: string, ticketId: string): Promise<void> {
  const retained = await currentTicketObligation(trx, customerTenant, ticketId);
  if (!retained || retained.obligation.clock.resolution.completedAt) return;
  const status = await retained.customer.table('statuses').where('status_id', retained.ticket.status_id).forShare().first('is_closed');
  if (!status?.is_closed) return;
  const at = (await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at;
  await applyOrganizationSlaEvent(trx, retained.identity, randomUUID(), { kind: 'resolved', occurredAt: at.toISOString() });
}

/** Only an actual closed-to-open canonical mutation calls this adapter. Customer
 * responsibility waits for escalation; an existing unresolved clock never resets. */
export async function recordCoManagedTicketReopened(trx: Knex.Transaction, customerTenant: string, ticketId: string): Promise<void> {
  const retained = await currentTicketObligation(trx, customerTenant, ticketId);
  if (!retained || retained.work.responsibility !== 'msp' || !retained.obligation.clock.resolution.completedAt) return;
  const status = await retained.customer.table('statuses').where('status_id', retained.ticket.status_id).forShare().first('is_closed');
  if (!status || status.is_closed) return;
  const at = (await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at;
  await applyCoManagedTicketSlaTransition(trx, retained.relationship,
    { kind: 'ticket', tenant: customerTenant, relationshipId: retained.relationship.relationship_id, id: ticketId },
    { workId: retained.work.work_id, firstEscalatedAt: retained.work.first_escalated_at }, randomUUID(), 'reopened', at);
}

/** Called only within retained handoff/reopen transactions. It never admits a user
 * or starts timing for a board grant, queue read, or staff assignment. */
export async function applyCoManagedTicketSlaTransition(trx: Knex.Transaction,
  relationship: { sponsor_tenant: string; sponsor_client_id: string; escalation_board_id: string }, resource: CoManagedSharedResource,
  work: { workId: string; firstEscalatedAt: Date | string | null }, operationId: string,
  transition: 'escalated' | 'handed_back' | 'access_revoked' | 'reopened', occurredAt: Date): Promise<void> {
  if (!trx.isTransaction || resource.kind !== 'ticket') throw new Error('SLA handoffs require retained ticket work');
  const owner = tenantDb(trx, relationship.sponsor_tenant), customer = tenantDb(trx, resource.tenant);
  const key = { source_tenant: resource.tenant, ticket_id: resource.id, work_id: work.workId };
  const obligation = await owner.table('sla_organization_obligations').where(key).orderBy('generation', 'desc').first();
  const identity = { tenant: relationship.sponsor_tenant, obligationId: obligation?.obligation_id ?? randomUUID(),
    sourceTenant: resource.tenant, ticketId: resource.id };
  const at = occurredAt.toISOString();
  if (transition === 'handed_back' || transition === 'access_revoked') {
    // Security reduction and handback remain possible for pre-migration work.
    if (obligation) await applyOrganizationSlaEvent(trx, identity, operationId,
      { kind: 'paused', reason: 'customer_responsible', occurredAt: at });
    return;
  }
  if (transition === 'reopened' && !obligation?.clock.resolution.completedAt) return;
  const ticket = await customer.table('tickets').where('ticket_id', resource.id).first('priority_id', 'status_id');
  if (!ticket) throw new CoManagedSlaSetupError();
  const status = await customer.table('statuses').where('status_id', ticket.status_id).forShare().first('is_closed');
  if (!status) throw new CoManagedSlaSetupError();
  if (obligation && !obligation.clock.resolution.completedAt) {
    // A newly shared closed ticket ends the retained obligation at this new
    // visibility boundary; do not read its private-period closure timestamp.
    await applyOrganizationSlaEvent(trx, identity, operationId, status.is_closed
      ? { kind: 'resolved', occurredAt: at } : { kind: 'resumed', reason: 'customer_responsible', occurredAt: at });
    return;
  }
  // Never turn historic escalations into a fresh deadline merely because their
  // obligation needs explicit migration/reconciliation.
  if (!obligation && work.firstEscalatedAt) throw new CoManagedSlaSetupError();
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
