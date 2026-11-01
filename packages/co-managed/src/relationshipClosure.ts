import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasCoManagedLocalPermission } from './localPermission';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedPolicyTarget } from './policy';
import { sealCoManagedArchive } from './archiveManifest';

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
/** Everything a closure-time evidence writer needs; `operationId` is the closure operation. */
export interface CoManagedClosureContext {
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
const dbNow = async (trx: Knex.Transaction) => new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);

/**
 * The one closure transaction, for departure and independent upgrade alike.
 *
 * It is an idempotent state machine whose "released exactly once" guarantee has two independent
 * layers: the closure row is unique on `(sponsor tenant, relationship_id)`, and the seat release
 * is an update-if-null on `released_at` inside this transaction, so a retry by the action, an
 * operator or a workflow can neither write a second closure row nor release a seat twice.
 *
 * `finalizeEvidence` runs first, inside the same transaction and under the same locks, and
 * retains evidence before the archive is sealed; the seal itself always follows.
 * This primitive never grants PSA, never touches the customer's tickets, users or files, and
 * authorizes the actor as either party to the relationship (existing `co_management:manage`).
 */
export async function closeCoManagedRelationship(db: Knex, inputActor: CoManagedSessionActor,
  inputTarget: CoManagedPolicyTarget, input: CoManagedClosureRequest,
  finalizeEvidence: (context: CoManagedClosureContext) => Promise<void>): Promise<CoManagedClosureReceipt> {
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
    // Same lock order as provisioning, capacity changes and operational admission
    // (sponsor entitlement, sponsor tenant, relationship, customer tenant). Expired capacity
    // never prevents either organization from ending trust, so the entitlement is not evaluated.
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
    const cutoffAt = await dbNow(trx);
    const context = { trx, sponsorTenant: found.sponsor_tenant, ...target, operationId: request.operationId, cutoffAt };
    await finalizeEvidence({ ...context, cutoffAt: new Date(cutoffAt) });
    // The seal is part of the closure, not of the caller's finalizer: no closure without an archive manifest.
    await sealCoManagedArchive({ ...context, cutoffAt: new Date(cutoffAt) });
    await assertCoManagedSessionUnexpired(trx, actor);
    const { releasedSeats, closedAt } = await endCoManagedRelationshipAccess(trx, found.sponsor_tenant, target.customerTenant, relationship);
    const row = { tenant: found.sponsor_tenant, operation_id: request.operationId, customer_tenant: target.customerTenant, relationship_id: target.relationshipId,
      actor_tenant: actor.tenant, actor_user_id: actor.userId, request_fingerprint: fingerprint, reason: request.reason,
      applied_revision: relationship.revision + 1, released_seats: releasedSeats, cutoff_at: cutoffAt, closed_at: closedAt };
    // write-admission: exempt — closure history for a relationship that is ending; it must be writable by definition.
    await sponsor.table('co_managed_relationship_closures').insert(row);
    await assertCoManagedSessionUnexpired(trx, actor);
    return receipt(row);
  });
}

/**
 * Ending a relationship, whoever ends it: the relationship becomes terminated history and the
 * allocation's seats return to the sponsor's pool. The caller holds the entitlement and
 * relationship locks. The release is "update where released_at is null ... returning", never
 * read-then-write, so the seat count is exactly what this statement actually released.
 */
// LEVERAGE: friction ticket-sla-access-revoked — shared ticket SLAs must stop as access revoked at the cutoff; the SLA clock (L6b) is out of scope here, so closure has no hook to call yet.
async function endCoManagedRelationshipAccess(trx: Knex.Transaction, sponsorTenant: string, customerTenant: string,
  relationship: any): Promise<{ releasedSeats: number; closedAt: Date }> {
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant);
  const closedAt = await dbNow(trx);
  // write-admission: exempt — the relationship is being ended; ending must not be refused by the lifecycle it ends.
  await customer.table('co_management_relationships').where('relationship_id', relationship.relationship_id).update({
    state: 'terminated', ended_at: closedAt, revision: relationship.revision + 1, updated_at: closedAt });
  // write-admission: exempt — sponsor seat ledger, released as part of the same closure.
  const released = await sponsor.table('co_managed_allocations')
    .where({ customer_tenant: customerTenant, relationship_id: relationship.relationship_id }).whereNull('released_at')
    .update({ state: 'released', released_at: closedAt, updated_at: closedAt }).returning('seats');
  const releasedSeats = (released as Array<{ seats: number | string }>).reduce((sum, row) => sum + Number(row.seats), 0);
  if (!Number.isSafeInteger(releasedSeats) || releasedSeats < 0 || releasedSeats > 2147483647) throw new Error('Invalid co-managed seat allocation');
  return { releasedSeats, closedAt };
}

/**
 * The sponsor is being deleted: end every accepted relationship it sponsored so no customer is
 * left pointing at a sponsor that no longer exists. The customer keeps its workspace, tickets,
 * users and files (terminated history, as after a departure). Each relationship is ended in its
 * own transaction with the same lock order; a relationship that is already ended is skipped.
 *
 * A setup the customer never accepted is not cancelled here: that needs the provisioning cleanup
 * helper, so it is reported in `unaccepted` and the caller decides (deletion fails explicitly
 * rather than orphaning an unclaimed workspace).
 */
export async function endCoManagedSponsorshipsForDeletion(db: Knex, sponsorTenant: string):
  Promise<{ terminated: number; unaccepted: number }> {
  if (!isCoManagedUuid(sponsorTenant)) throw new CoManagedClosureError('INVALID_CLOSURE');
  const discovery = tenantDb(db, '__co_managed_sponsor_deletion__');
  const relationships = await discovery.unscoped('co_management_relationships',
    'sponsor deletion: find every customer workspace this sponsor still sponsors').where('sponsor_tenant', sponsorTenant).whereNull('ended_at')
    .orderBy(['tenant', 'relationship_id']).select('tenant', 'relationship_id', 'state');
  let terminated = 0, unaccepted = 0;
  for (const row of relationships as Array<{ tenant: string; relationship_id: string; state: string }>) {
    if (row.state !== 'active') { unaccepted++; continue; }
    const ended = await withTransaction(db, async trx => {
      const sponsor = tenantDb(trx, sponsorTenant), customer = tenantDb(trx, row.tenant);
      await sponsor.table('co_managed_entitlements').forUpdate().first();
      await sponsor.table('tenants').forShare().first('tenant');
      const relationship = await customer.table('co_management_relationships').where('relationship_id', row.relationship_id).forUpdate().first();
      await customer.table('tenants').forShare().first('product_code');
      if (!relationship || relationship.state !== 'active' || relationship.ended_at || relationship.sponsor_tenant !== sponsorTenant) return false;
      await endCoManagedRelationshipAccess(trx, sponsorTenant, row.tenant, relationship);
      return true;
    });
    if (ended) terminated++;
  }
  return { terminated, unaccepted };
}

/**
 * The customer workspace is being deleted: the sponsor's seat for it must come back to the sponsor's
 * pool. The allocation lives in the SPONSOR's partition, so deleting the customer's own rows never
 * releases it. Every relationship the customer is party to that has not already ended goes through the
 * same `endCoManagedRelationshipAccess` as a departure (same lock order, same update-if-null release),
 * so a replay, or a customer that already departed, releases nothing twice. A setup the customer never
 * accepted is ended too: it holds a reserved seat and the customer it points at is going away.
 * A missing sponsor (already deleted) is not an error; there is nothing left to release into.
 */
export async function releaseCoManagedSeatsForCustomerDeletion(db: Knex, customerTenant: string):
  Promise<{ released: number; relationships: number }> {
  if (!isCoManagedUuid(customerTenant)) throw new CoManagedClosureError('INVALID_CLOSURE');
  const found = await tenantDb(db, customerTenant).table('co_management_relationships').whereNull('ended_at')
    .orderBy('relationship_id').select('relationship_id', 'sponsor_tenant');
  let released = 0, relationships = 0;
  for (const row of found as Array<{ relationship_id: string; sponsor_tenant: string }>) {
    const outcome = await withTransaction(db, async trx => {
      const sponsor = tenantDb(trx, row.sponsor_tenant), customer = tenantDb(trx, customerTenant);
      await sponsor.table('co_managed_entitlements').forUpdate().first();
      await sponsor.table('tenants').forShare().first('tenant');
      const relationship = await customer.table('co_management_relationships').where('relationship_id', row.relationship_id).forUpdate().first();
      await customer.table('tenants').forShare().first('product_code');
      if (!relationship || relationship.ended_at) return null;
      return endCoManagedRelationshipAccess(trx, row.sponsor_tenant, customerTenant, relationship);
    });
    if (outcome) { relationships++; released += outcome.releasedSeats; }
  }
  return { released, relationships };
}
