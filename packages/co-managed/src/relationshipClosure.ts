import { sealCoManagedArchive } from './archiveManifest';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasCoManagedLocalPermission } from './localPermission';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { applyCoManagedTicketSlaTransition } from './ticketSla';
import type { CoManagedPolicyTarget } from './policy';

export interface CoManagedClosureRequest {
  operationId: string;
  expectedRevision: number;
  reason: 'departure' | 'independent_upgrade';
}
export interface CoManagedClosureReceipt {
  operationId: string;
  customerTenant: string;
  relationshipId: string;
  appliedRevision: number;
  releasedSeats: number;
  cutoffAt: string;
  closedAt: string;
}
export interface CoManagedClosureEvidenceContext {
  trx: Knex.Transaction;
  sponsorTenant: string;
  customerTenant: string;
  relationshipId: string;
  operationId: string;
  cutoffAt: Date;
}
export class CoManagedClosureError extends Error {
  constructor(public readonly code: 'INVALID_CLOSURE' | 'CLOSURE_CHANGED' | 'RELATIONSHIP_CLOSED') {
    super(code); this.name = 'CoManagedClosureError';
  }
}
const iso = (date: Date | string) => new Date(date).toISOString();
const receipt = (row: any): CoManagedClosureReceipt => ({ operationId: row.operation_id, customerTenant: row.customer_tenant,
  relationshipId: row.relationship_id, appliedRevision: row.applied_revision, releasedSeats: row.released_seats,
  cutoffAt: iso(row.cutoff_at), closedAt: iso(row.closed_at) });

/** Internal transaction boundary for departure and independent upgrade. The
 * production archive adapter MUST finish permitted evidence in this retained
 * transaction before returning. There is intentionally no default finalizer
 * and no public action exposing closure before that adapter is implemented.
 * Independent upgrade additionally proves entitlement and seeds commercial
 * capability in its outer transaction; this primitive never grants PSA. */
export async function closeCoManagedRelationship(db: Knex, inputActor: CoManagedSessionActor,
  inputTarget: CoManagedPolicyTarget, input: CoManagedClosureRequest,
  finalizeEvidence: (context: CoManagedClosureEvidenceContext) => Promise<void>): Promise<CoManagedClosureReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputTarget || !input || ![inputTarget.customerTenant, inputTarget.relationshipId, input.operationId].every(isCoManagedUuid) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647 ||
      !['departure', 'independent_upgrade'].includes(input.reason) || typeof finalizeEvidence !== 'function') throw new CoManagedClosureError('INVALID_CLOSURE');
  const target = { customerTenant: inputTarget.customerTenant, relationshipId: inputTarget.relationshipId };
  const request = { operationId: input.operationId, expectedRevision: input.expectedRevision, reason: input.reason };
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, target, request })).digest('hex');
  return withTransaction(db, async trx => {
    const customer = tenantDb(trx, target.customerTenant);
    const found = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first('sponsor_tenant');
    if (!found || ![target.customerTenant, found.sponsor_tenant].includes(actor.tenant)) throw new CoManagedSharedWorkError();
    const sponsor = tenantDb(trx, found.sponsor_tenant);
    // Same order as provisioning, capacity changes and operational admission.
    // Expired capacity cannot prevent either organization from ending trust.
    await sponsor.table('co_managed_entitlements').forUpdate().first();
    const home = await sponsor.table('tenants').forShare().first('product_code');
    const relationship = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).forUpdate().first();
    const owner = await customer.table('tenants').forShare().first('product_code');
    if (!home || !owner || !relationship || relationship.sponsor_tenant !== found.sponsor_tenant) throw new CoManagedSharedWorkError();
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    const previous = await sponsor.table('co_managed_relationship_closures').where('operation_id', request.operationId).first();
    if (previous) {
      if (previous.request_fingerprint !== fingerprint) throw new CoManagedClosureError('CLOSURE_CHANGED');
      await assertCoManagedSessionUnexpired(trx, actor);
      return receipt(previous);
    }
    if (relationship.ended_at || relationship.state === 'terminated') throw new CoManagedClosureError('RELATIONSHIP_CLOSED');
    if (relationship.state !== 'active' || owner.product_code !== 'co_managed' || home.product_code !== 'psa') throw new CoManagedSharedWorkError();
    if (relationship.revision !== request.expectedRevision) throw new CoManagedClosureError('CLOSURE_CHANGED');
    const cutoffAt = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
    const evidenceContext = { trx, sponsorTenant: found.sponsor_tenant, ...target, operationId: request.operationId, cutoffAt: new Date(cutoffAt) };
    await finalizeEvidence(evidenceContext);
    await sealCoManagedArchive({ trx, sponsorTenant: found.sponsor_tenant, ...target, operationId: request.operationId, cutoffAt: new Date(cutoffAt) });
    await assertCoManagedSessionUnexpired(trx, actor);
    const work = await customer.table('co_management_ticket_work').where('relationship_id', target.relationshipId).orderBy('ticket_id').forUpdate();
    for (const ticket of work) {
      await applyCoManagedTicketSlaTransition(trx, relationship, { tenant: target.customerTenant, relationshipId: target.relationshipId, kind: 'ticket', id: ticket.ticket_id },
        { workId: ticket.work_id, firstEscalatedAt: ticket.first_escalated_at }, request.operationId, 'access_revoked', cutoffAt);
    }
    const allocations = await sponsor.table('co_managed_allocations').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId })
      .whereNot('state', 'released').forUpdate().select('allocation_id', 'seats');
    const releasedSeats = allocations.reduce((sum, allocation) => sum + Number(allocation.seats), 0);
    if (!Number.isSafeInteger(releasedSeats) || releasedSeats < 0 || releasedSeats > 2147483647) throw new Error('Invalid co-managed seat allocation');
    const closedAt = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
    await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).update({ state: 'terminated', ended_at: closedAt,
      revision: relationship.revision + 1, updated_at: closedAt });
    await sponsor.table('co_managed_allocations').whereIn('allocation_id', allocations.map(row => row.allocation_id))
      .update({ state: 'released', released_at: closedAt, updated_at: closedAt });
    const row = { tenant: found.sponsor_tenant, operation_id: request.operationId, customer_tenant: target.customerTenant, relationship_id: target.relationshipId,
      actor_tenant: actor.tenant, actor_user_id: actor.userId, request_fingerprint: fingerprint, reason: request.reason,
      applied_revision: relationship.revision + 1, released_seats: releasedSeats, cutoff_at: cutoffAt, closed_at: closedAt };
    await sponsor.table('co_managed_relationship_closures').insert(row);
    await assertCoManagedSessionUnexpired(trx, actor);
    return receipt(row);
  });
}
