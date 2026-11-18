import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hasCoManagedLocalPermission } from './localPermission';
import { countCoManagedCommittedSeats, getCoManagedEntitlementState, invalidateCoManagedAwaitingAcceptance } from '@alga-psa/licensing';
import { CoManagedAcceptanceError, readCoManagedAcceptanceScope, coManagedScopeFingerprint,
  type CoManagedAcceptanceScope } from './acceptanceScope';
import { requestCoManagedProvisioningCleanup } from './provisioning';

export { CoManagedAcceptanceError, type CoManagedAcceptanceScope };

/** Always constructed by the authentication adapter from the home identity.
 * Delegated context and user-supplied destination tenants are not identities. */
export interface CoManagedCustomerActor { tenant: string; userId: string }
export type CoManagedAcceptanceState =
  | { state: 'unavailable' | 'active' | 'terminated' }
  | { state: 'cancelled' | 'destination_unavailable'; sponsorName: string }
  | { state: 'pending_acceptance'; relationshipId: string; revision: number;
      canAccept: boolean; scope: CoManagedAcceptanceScope; scopeFingerprint: string };

async function customerAdministrator(db: Knex, actor: CoManagedCustomerActor, lock = false): Promise<boolean> {
  const customer = tenantDb(db, actor.tenant);
  const users = customer.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false });
  if (lock) users.forShare();
  const user = await users.first();
  const owner = await customer.table('tenants').where('product_code', 'co_managed').first();
  if (!user || !owner) throw new CoManagedAcceptanceError('FORBIDDEN');
  return hasCoManagedLocalPermission(db, actor, 'co_management', 'manage', lock);
}

/** Customer-local review only. No sponsor contacts, contracts, or other boards. */
export async function getCoManagedAcceptanceState(db: Knex, actor: CoManagedCustomerActor): Promise<CoManagedAcceptanceState> {
  return db.transaction(async trx => {
    const canAccept = await customerAdministrator(trx, actor);
    const relationship = await tenantDb(trx, actor.tenant).table('co_management_relationships')
      .orderBy('created_at', 'desc').first();
    if (!relationship) return { state: 'unavailable' };
    if (['provisioning', 'pending_acceptance'].includes(relationship.state)) {
      // The MSP may cancel until acceptance; the relationship only ends once
      // cleanup has deleted the workspace, so read the sponsor's operation.
      const sponsor = tenantDb(trx, relationship.sponsor_tenant);
      const operation = await sponsor.table('co_managed_provisioning_operations')
        .where({ relationship_id: relationship.relationship_id, customer_tenant: actor.tenant }).first('state');
      if (operation && ['cleanup_requested', 'cancelled'].includes(operation.state)) {
        const owner = await sponsor.table('tenants').first('client_name');
        return { state: 'cancelled', sponsorName: owner?.client_name ?? '' };
      }
    }
    if (relationship.state === 'provisioning') return { state: 'unavailable' };
    if (relationship.state === 'active' || relationship.state === 'terminated') return { state: relationship.state };
    // A sponsor that no longer exists proposes nothing; there is nothing to review.
    if (!await tenantDb(trx, relationship.sponsor_tenant).table('tenants').first('tenant')) return { state: 'unavailable' };
    let scope: CoManagedAcceptanceScope;
    try { scope = await readCoManagedAcceptanceScope(trx, relationship); }
    catch (error) {
      // A missing queue is the MSP's to fix; say so instead of failing the review.
      if (!(error instanceof CoManagedAcceptanceError) || error.code !== 'DESTINATION_UNAVAILABLE') throw error;
      const owner = await tenantDb(trx, relationship.sponsor_tenant).table('tenants').first('client_name');
      return { state: 'destination_unavailable', sponsorName: owner?.client_name ?? '' };
    }
    return { state: 'pending_acceptance', relationshipId: relationship.relationship_id, revision: relationship.revision,
      canAccept, scope, scopeFingerprint: coManagedScopeFingerprint(scope) };
  }, { isolationLevel: 'repeatable read', readOnly: true });
}

function assertAcceptanceInput(input: { relationshipId: string; revision: number; scopeFingerprint: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.relationshipId) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      !/^[0-9a-f]{64}$/.test(input.scopeFingerprint)) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
}

/** Approval, seat activation, and its immutable receipt commit together.
 * Scope mutations must take the same relationship lock and increment revision. */
export async function acceptCoManagedRelationship(db: Knex, actor: CoManagedCustomerActor, input: {
  relationshipId: string; revision: number; scopeFingerprint: string;
}): Promise<void> {
  assertAcceptanceInput(input);
  await db.transaction(async trx => {
    if (!await customerAdministrator(trx, actor)) throw new CoManagedAcceptanceError('FORBIDDEN');
    const customer = tenantDb(trx, actor.tenant);
    // Discovery is customer scoped; never trust a sponsor or customer ID from the browser.
    const found = await customer.table('co_management_relationships').where('relationship_id', input.relationshipId).first();
    if (!found) throw new CoManagedAcceptanceError('NOT_PENDING');
    const sponsor = tenantDb(trx, found.sponsor_tenant);
    // Same order as reservation, workers, and cancellation.
    const entitlement = await sponsor.table('co_managed_entitlements').forUpdate().first();
    const owner = await sponsor.table('tenants').forShare().first();
    const operation = await sponsor.table('co_managed_provisioning_operations')
      .where({ customer_tenant: actor.tenant, relationship_id: input.relationshipId }).forUpdate().first();
    const relationship = await customer.table('co_management_relationships').where('relationship_id', input.relationshipId).forUpdate().first();
    if (!relationship || relationship.sponsor_tenant !== found.sponsor_tenant || !operation ||
        operation.state !== 'pending_acceptance') throw new CoManagedAcceptanceError('NOT_PENDING');
    // Recheck after any wait for the relationship lock; hold the live local
    // identity and permission rows through the acceptance commit.
    if (!await customerAdministrator(trx, actor, true)) throw new CoManagedAcceptanceError('FORBIDDEN');
    if (relationship.state === 'active') {
      const receipt = await customer.table('co_management_relationship_events').where({ relationship_id: input.relationshipId,
        event_type: 'accepted', revision: input.revision + 1, actor_tenant: actor.tenant, actor_user_id: actor.userId,
        scope_fingerprint: input.scopeFingerprint }).first();
      if (receipt && relationship.revision === receipt.revision) return;
      throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    }
    if (relationship.state !== 'pending_acceptance') throw new CoManagedAcceptanceError('NOT_PENDING');
    const scope = await readCoManagedAcceptanceScope(trx, relationship, true);
    if (relationship.revision !== input.revision || coManagedScopeFingerprint(scope) !== input.scopeFingerprint) {
      throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    }
    const capacity = await getCoManagedEntitlementState(trx, found.sponsor_tenant);
    const allocation = await sponsor.table('co_managed_allocations').where({ allocation_id: operation.allocation_id,
      customer_tenant: actor.tenant, relationship_id: input.relationshipId, state: 'reserved' }).first();
    // Serialize with invitation/account admission before measuring committed seats.
    await customer.table('tenants').forNoKeyUpdate().first();
    if (owner?.product_code !== 'psa' || (entitlement?.source === 'hosted' && owner.plan !== 'pro') || !allocation ||
        capacity.isReadOnly || capacity.graceEndsAt || capacity.capacity < capacity.allocated ||
        await sponsor.table('co_management_relationships').whereNull('ended_at').first() ||
        await countCoManagedCommittedSeats(trx, actor.tenant) > Number(allocation.seats)) {
      throw new CoManagedAcceptanceError('CAPACITY_UNAVAILABLE');
    }
    // write-admission: exempt — co-management acceptance/decline is the lifecycle transition admission depends on; serialized under the relationship lock
    await customer.table('co_management_relationships').where('relationship_id', input.relationshipId)
      .update({ state: 'active', accepted_by: actor.userId, accepted_at: trx.fn.now(),
        revision: input.revision + 1, updated_at: trx.fn.now() });
    // write-admission: exempt — co-management acceptance/decline is the lifecycle transition admission depends on; serialized under the relationship lock
    await sponsor.table('co_managed_allocations').where('allocation_id', operation.allocation_id)
      .update({ state: 'active', updated_at: trx.fn.now() });
    // write-admission: exempt — co-management acceptance/decline is the lifecycle transition admission depends on; serialized under the relationship lock
    await customer.table('co_management_relationship_events').insert({ tenant: actor.tenant, event_id: randomUUID(),
      relationship_id: input.relationshipId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      event_type: 'accepted', revision: input.revision + 1, scope, scope_fingerprint: input.scopeFingerprint });
  });
  // The workspace is no longer awaiting acceptance; drop any cached positive answer.
  invalidateCoManagedAwaitingAcceptance(actor.tenant);
}

export interface CoManagedDeclineResult {
  relationshipId: string;
  operationId: string;
  sponsorTenant: string;
  /** The operation is now `cleanup_requested`; the caller starts the cleanup workflow. */
  cleanupRequested: true;
}

/** The customer administrator refuses the proposal. Same authority, revision
 * and scope-fingerprint check as acceptance. The relationship stays
 * `pending_acceptance`; the `declined` receipt (revision + 1) and the operation's
 * `cleanup_requested` state commit together, and the cleanup worker then deletes
 * the unactivated workspace and releases the seats. A retry of the same decline
 * finds its receipt and returns the same result without writing again. */
export async function declineCoManagedRelationship(db: Knex, actor: CoManagedCustomerActor, input: {
  relationshipId: string; revision: number; scopeFingerprint: string;
}): Promise<CoManagedDeclineResult> {
  assertAcceptanceInput(input);
  const result = await db.transaction(async (trx): Promise<CoManagedDeclineResult> => {
    if (!await customerAdministrator(trx, actor)) throw new CoManagedAcceptanceError('FORBIDDEN');
    const customer = tenantDb(trx, actor.tenant);
    const found = await customer.table('co_management_relationships').where('relationship_id', input.relationshipId).first();
    if (!found) throw new CoManagedAcceptanceError('NOT_PENDING');
    const sponsor = tenantDb(trx, found.sponsor_tenant);
    // Same lock order as accept, reservation, workers and cancellation.
    await sponsor.table('co_managed_entitlements').forUpdate().first();
    await sponsor.table('tenants').forShare().first();
    const operation = await sponsor.table('co_managed_provisioning_operations')
      .where({ customer_tenant: actor.tenant, relationship_id: input.relationshipId }).forUpdate().first();
    const relationship = await customer.table('co_management_relationships').where('relationship_id', input.relationshipId).forUpdate().first();
    if (!relationship || relationship.sponsor_tenant !== found.sponsor_tenant || !operation) throw new CoManagedAcceptanceError('NOT_PENDING');
    if (!await customerAdministrator(trx, actor, true)) throw new CoManagedAcceptanceError('FORBIDDEN');
    const done: CoManagedDeclineResult = { relationshipId: input.relationshipId, operationId: operation.operation_id,
      sponsorTenant: found.sponsor_tenant, cleanupRequested: true };
    const receipt = await customer.table('co_management_relationship_events').where({ relationship_id: input.relationshipId,
      event_type: 'declined', revision: input.revision + 1, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      scope_fingerprint: input.scopeFingerprint }).first();
    if (receipt) {
      // Retry: the decline committed. Cleanup may be requested, running or finished.
      if (['cleanup_requested', 'cancelled'].includes(operation.state)) return done;
      throw new CoManagedAcceptanceError('NOT_PENDING');
    }
    if (relationship.state !== 'pending_acceptance' || operation.state !== 'pending_acceptance') throw new CoManagedAcceptanceError('NOT_PENDING');
    const scope = await readCoManagedAcceptanceScope(trx, relationship, true);
    if (relationship.revision !== input.revision || coManagedScopeFingerprint(scope) !== input.scopeFingerprint) {
      throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    }
    // write-admission: exempt — co-management acceptance/decline is the lifecycle transition admission depends on; serialized under the relationship lock
    await customer.table('co_management_relationships').where('relationship_id', input.relationshipId)
      .update({ revision: input.revision + 1, updated_at: trx.fn.now() });
    // write-admission: exempt — co-management acceptance/decline is the lifecycle transition admission depends on; serialized under the relationship lock
    await customer.table('co_management_relationship_events').insert({ tenant: actor.tenant, event_id: randomUUID(),
      relationship_id: input.relationshipId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      event_type: 'declined', revision: input.revision + 1, scope, scope_fingerprint: input.scopeFingerprint });
    await requestCoManagedProvisioningCleanup(trx, found.sponsor_tenant, operation.operation_id);
    return done;
  });
  invalidateCoManagedAwaitingAcceptance(actor.tenant);
  return result;
}
