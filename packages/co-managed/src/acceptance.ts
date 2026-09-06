import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';

/** Always constructed by the authentication adapter from the home identity.
 * Delegated context and user-supplied destination tenants are not identities. */
export interface CoManagedCustomerActor { tenant: string; userId: string }
export interface CoManagedAcceptanceScope {
  sponsorTenant: string;
  sponsorName: string;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoard: { id: string; name: string };
  boards: Array<{ id: string; name: string; canCollaborate: boolean }>;
  projects: string[];
  delegatedAdministration: string[];
}
export type CoManagedAcceptanceState =
  | { state: 'unavailable' | 'active' | 'terminated' }
  | { state: 'pending_acceptance'; relationshipId: string; revision: number;
      canAccept: boolean; scope: CoManagedAcceptanceScope; scopeFingerprint: string };

export class CoManagedAcceptanceError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_PENDING' | 'SCOPE_CHANGED' | 'CAPACITY_UNAVAILABLE') {
    super({ FORBIDDEN: 'A customer administrator in this workspace must accept the relationship.',
      NOT_PENDING: 'This relationship is not awaiting acceptance.',
      SCOPE_CHANGED: 'The proposed scope changed. Review it again before accepting.',
      CAPACITY_UNAVAILABLE: 'The sponsoring MSP must restore its Pro license and allocated co-managed seats before activation.',
    }[code]);
    this.name = 'CoManagedAcceptanceError';
  }
}

async function customerAdministrator(db: Knex, actor: CoManagedCustomerActor, lock = false): Promise<boolean> {
  const customer = tenantDb(db, actor.tenant);
  const users = customer.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false });
  if (lock) users.forShare();
  const user = await users.first();
  const owner = await customer.table('tenants').where('product_code', 'co_managed').first();
  if (!user || !owner) throw new CoManagedAcceptanceError('FORBIDDEN');
  const query = customer.table('user_roles').where('user_roles.user_id', actor.userId);
  customer.tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id');
  customer.tenantJoin(query, 'role_permissions', 'roles.role_id', 'role_permissions.role_id');
  customer.tenantJoin(query, 'permissions', 'role_permissions.permission_id', 'permissions.permission_id');
  if (lock) query.forShare();
  return Boolean(await query.where({ 'roles.msp': true, 'permissions.msp': true,
    'permissions.resource': 'co_management', 'permissions.action': 'manage' }).first('permissions.permission_id'));
}

async function readScope(db: Knex, relationship: any, lock = false): Promise<CoManagedAcceptanceScope> {
  const sponsor = tenantDb(db, relationship.sponsor_tenant);
  const owner = await sponsor.table('tenants').first('client_name');
  const destinations = sponsor.table('boards').where({ board_id: relationship.escalation_board_id, is_inactive: false });
  if (lock) destinations.forShare();
  const destination = await destinations.first('board_id', 'board_name');
  if (!owner || !destination) throw new CoManagedAcceptanceError('NOT_PENDING');
  const customer = tenantDb(db, relationship.tenant);
  const scopeQuery = customer.table('co_management_board_scopes').where('relationship_id', relationship.relationship_id).orderBy('board_id');
  if (lock) scopeQuery.forShare();
  const scopes = await scopeQuery;
  const boards: CoManagedAcceptanceScope['boards'] = [];
  for (const scope of scopes) {
    const boardQuery = customer.table('boards').where({ board_id: scope.board_id, is_inactive: false });
    if (lock) boardQuery.forShare();
    const board = await boardQuery.first('board_name');
    if (!board) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    boards.push({ id: scope.board_id, name: board.board_name, canCollaborate: scope.can_collaborate });
  }
  if (relationship.visibility_mode === 'escalation_only' && boards.length) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
  return { sponsorTenant: relationship.sponsor_tenant, sponsorName: owner.client_name,
    visibilityMode: relationship.visibility_mode, escalationBoard: { id: destination.board_id, name: destination.board_name },
    boards, projects: [], delegatedAdministration: [] };
}
function fingerprint(scope: CoManagedAcceptanceScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

/** Customer-local review only. No sponsor contacts, contracts, or other boards. */
export async function getCoManagedAcceptanceState(db: Knex, actor: CoManagedCustomerActor): Promise<CoManagedAcceptanceState> {
  return db.transaction(async trx => {
    const canAccept = await customerAdministrator(trx, actor);
    const relationship = await tenantDb(trx, actor.tenant).table('co_management_relationships')
      .orderBy('created_at', 'desc').first();
    if (!relationship || relationship.state === 'provisioning') return { state: 'unavailable' };
    if (relationship.state === 'active' || relationship.state === 'terminated') return { state: relationship.state };
    const scope = await readScope(trx, relationship);
    return { state: 'pending_acceptance', relationshipId: relationship.relationship_id, revision: relationship.revision,
      canAccept, scope, scopeFingerprint: fingerprint(scope) };
  }, { isolationLevel: 'repeatable read', readOnly: true });
}

/** Approval, seat activation, and its immutable receipt commit together.
 * Scope mutations must take the same relationship lock and increment revision. */
export async function acceptCoManagedRelationship(db: Knex, actor: CoManagedCustomerActor, input: {
  relationshipId: string; revision: number; scopeFingerprint: string;
}): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(input.relationshipId) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      !/^[0-9a-f]{64}$/.test(input.scopeFingerprint)) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
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
    const scope = await readScope(trx, relationship, true);
    if (relationship.revision !== input.revision || fingerprint(scope) !== input.scopeFingerprint) {
      throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    }
    const capacity = await getCoManagedEntitlementState(trx, found.sponsor_tenant);
    const allocation = await sponsor.table('co_managed_allocations').where({ allocation_id: operation.allocation_id,
      customer_tenant: actor.tenant, relationship_id: input.relationshipId, state: 'reserved' }).first();
    if (owner?.product_code !== 'psa' || (entitlement?.source === 'hosted' && owner.plan !== 'pro') || !allocation ||
        capacity.isReadOnly || capacity.graceEndsAt || capacity.capacity < capacity.allocated ||
        await sponsor.table('co_management_relationships').whereNull('ended_at').first()) {
      throw new CoManagedAcceptanceError('CAPACITY_UNAVAILABLE');
    }
    await customer.table('co_management_relationships').where('relationship_id', input.relationshipId)
      .update({ state: 'active', accepted_by: actor.userId, accepted_at: trx.fn.now(),
        revision: input.revision + 1, updated_at: trx.fn.now() });
    await sponsor.table('co_managed_allocations').where('allocation_id', operation.allocation_id)
      .update({ state: 'active', updated_at: trx.fn.now() });
    await customer.table('co_management_relationship_events').insert({ tenant: actor.tenant, event_id: randomUUID(),
      relationship_id: input.relationshipId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      event_type: 'accepted', revision: input.revision + 1, scope, scope_fingerprint: input.scopeFingerprint });
  });
}
