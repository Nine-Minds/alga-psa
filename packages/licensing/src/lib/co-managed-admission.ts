import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from './co-managed-entitlements';

export class CoManagedAdmissionError extends Error {
  constructor(public readonly code: 'CO_MANAGED_SEAT_LIMIT' | 'CO_MANAGED_NOT_ACTIVE' | 'CO_MANAGED_LICENSE_LAPSED' |
    'CO_MANAGED_INVITATION_INVALID' | 'CO_MANAGED_ALLOCATION_CONFLICT' | 'CO_MANAGED_POOL_LIMIT') {
    super({ CO_MANAGED_SEAT_LIMIT: 'The customer technician allocation is full. Ask the sponsoring MSP to allocate more seats.',
      CO_MANAGED_NOT_ACTIVE: 'The customer administrator must activate the co-management relationship first.',
      CO_MANAGED_LICENSE_LAPSED: 'Restore the sponsoring Pro license and co-managed seats before adding customer technicians.',
      CO_MANAGED_INVITATION_INVALID: 'This invitation is no longer valid. Request a new invitation from your administrator.',
      CO_MANAGED_POOL_LIMIT: 'The sponsoring MSP needs more available co-managed seats before increasing this allocation.',
      CO_MANAGED_ALLOCATION_CONFLICT: 'The customer allocation changed or is no longer available. Refresh before trying again.',
    }[code]);
    this.name = 'CoManagedAdmissionError';
  }
}

/** Shared lock order for user admission, invitations, and allocation changes.
 * The caller must keep the transaction open through the corresponding write.
 * No appliance-wide MSP user counter participates in customer admission. */
export async function lockCoManagedSeatScope(trx: Knex.Transaction, customerTenant: string) {
  const customer = tenantDb(trx, customerTenant);
  if ((await customer.table('tenants').first('product_code'))?.product_code !== 'co_managed') return null;
  if (!trx.isTransaction) throw new Error('Customer seat admission requires an open transaction');
  const found = await customer.table('co_management_relationships').whereNull('ended_at').first();
  if (!found) throw new CoManagedAdmissionError('CO_MANAGED_NOT_ACTIVE');
  const sponsor = tenantDb(trx, found.sponsor_tenant);
  const entitlement = await sponsor.table('co_managed_entitlements').forUpdate().first();
  const owner = await sponsor.table('tenants').forShare().first('product_code', 'plan');
  const operation = await sponsor.table('co_managed_provisioning_operations')
    .where({ customer_tenant: customerTenant, relationship_id: found.relationship_id }).forUpdate().first();
  const relationship = await customer.table('co_management_relationships').where('relationship_id', found.relationship_id).forUpdate().first();
  if (!relationship || relationship.ended_at || relationship.sponsor_tenant !== found.sponsor_tenant ||
      !operation || operation.state !== 'pending_acceptance') throw new CoManagedAdmissionError('CO_MANAGED_NOT_ACTIVE');
  const allocation = await sponsor.table('co_managed_allocations').where({ allocation_id: operation.allocation_id,
    customer_tenant: customerTenant, relationship_id: relationship.relationship_id }).whereNot('state', 'released').first();
  if (!allocation) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
  await customer.table('tenants').forUpdate().first();
  return { sponsorTenant: found.sponsor_tenant as string, entitlement, owner, operation, relationship, allocation };
}

/** Active customer technicians plus distinct unexpired invitations. Requesters
 * are free; an invitation for an already-active technician reserves no extra seat. */
export async function countCoManagedCommittedSeats(trx: Knex.Transaction, tenant: string, excludeEmail?: string): Promise<number> {
  const db = tenantDb(trx, tenant);
  const users = await db.table('users').where({ user_type: 'internal', is_inactive: false }).count('* as count').first();
  const pending = db.table('user_invitations as invitation').whereNull('invitation.used_at')
    .where('invitation.expires_at', '>', trx.raw('clock_timestamp()'))
    .whereNotExists(db.table('users as member').select(trx.raw('1')).where({ 'member.user_type': 'internal', 'member.is_inactive': false })
      .whereRaw('lower(trim(member.email)) = lower(trim(invitation.email))'));
  if (excludeEmail) pending.whereRaw('lower(trim(invitation.email)) <> ?', [excludeEmail.trim().toLowerCase()]);
  const invitations = await pending.countDistinct({ count: trx.raw('lower(trim(invitation.email))') }).first();
  return Number(users?.count || 0) + Number(invitations?.count || 0);
}

/** Internal admission primitive. Invitation tokens come only from the team
 * setup adapter, not generic user-create payloads. The caller consumes a token
 * in the same transaction as the account/roles after this check succeeds. */
export async function assertCoManagedSeatAdmission(trx: Knex.Transaction, tenant: string, input: {
  email?: string; kind?: 'user' | 'invitation'; existingUserId?: string; invitationToken?: string;
} = {}): Promise<{ managed: false } | { managed: true; invitation?: { invitation_id: string; role_id: string; email: string } }> {
  const scope = await lockCoManagedSeatScope(trx, tenant);
  if (!scope) return { managed: false };
  const customer = tenantDb(trx, tenant);
  // Repeated reactivation of an already active technician is not a new seat.
  if (input.existingUserId) {
    const existing = await customer.table('users').where('user_id', input.existingUserId).forUpdate().first();
    if (!existing) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
    if (existing.user_type === 'internal' && existing.is_inactive === false) return { managed: true };
  }
  let invitation;
  if (input.invitationToken) {
    invitation = await customer.table('user_invitations').where({ token: input.invitationToken, used_at: null })
      .where('expires_at', '>', trx.raw('clock_timestamp()')).forUpdate().first();
    if (!invitation || invitation.email.trim().toLowerCase() !== input.email?.trim().toLowerCase()) {
      throw new CoManagedAdmissionError('CO_MANAGED_INVITATION_INVALID');
    }
  }
  const initialAdministrator = scope.relationship.state === 'pending_acceptance' && input.kind !== 'invitation' &&
    invitation?.invitation_id === scope.operation.administrator_invitation_id &&
    invitation?.metadata?.co_managed_initial_admin === true;
  if (scope.relationship.state !== 'active' && !initialAdministrator) throw new CoManagedAdmissionError('CO_MANAGED_NOT_ACTIVE');
  const capacity = await getCoManagedEntitlementState(trx, scope.sponsorTenant);
  if (scope.owner?.product_code !== 'psa' || (scope.entitlement?.source === 'hosted' && scope.owner.plan !== 'pro') ||
      capacity.graceEndsAt || capacity.isReadOnly || capacity.capacity < capacity.allocated || capacity.capacity < 1) {
    throw new CoManagedAdmissionError('CO_MANAGED_LICENSE_LAPSED');
  }
  if (await countCoManagedCommittedSeats(trx, tenant, input.email) >= Number(scope.allocation.seats)) {
    throw new CoManagedAdmissionError('CO_MANAGED_SEAT_LIMIT');
  }
  return { managed: true, ...(invitation ? { invitation: { invitation_id: invitation.invitation_id,
    role_id: invitation.role_id, email: invitation.email } } : {}) };
}

/** Sponsor adapter supplies its authenticated home tenant. Allocation changes
 * never evict a user or cancel a pending invitation to make the numbers fit. */
export async function changeCoManagedAllocation(db: Knex, sponsorTenant: string, input: {
  customerTenant: string; relationshipId: string; seats: number; expectedSeats: number;
}): Promise<void> {
  if (!Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 2147483647 ||
      !Number.isSafeInteger(input.expectedSeats) || input.expectedSeats < 1) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
  await db.transaction(async trx => {
    // Authorize ownership before entering the customer's locking path.
    const owned = await tenantDb(trx, sponsorTenant).table('co_managed_allocations').where({
      customer_tenant: input.customerTenant, relationship_id: input.relationshipId }).whereNot('state', 'released').first();
    if (!owned) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
    const scope = await lockCoManagedSeatScope(trx, input.customerTenant);
    if (!scope || scope.sponsorTenant !== sponsorTenant || scope.relationship.relationship_id !== input.relationshipId ||
        Number(scope.allocation.seats) !== input.expectedSeats) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
    if (input.seats === input.expectedSeats) return;
    if (await countCoManagedCommittedSeats(trx, input.customerTenant) > input.seats) throw new CoManagedAdmissionError('CO_MANAGED_SEAT_LIMIT');
    if (input.seats > input.expectedSeats) {
      if (await tenantDb(trx, sponsorTenant).table('co_managed_purchase_operations').whereIn('state', ['preparing', 'checkout']).first()) {
        throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
      }
      const capacity = await getCoManagedEntitlementState(trx, sponsorTenant);
      if (scope.owner?.product_code !== 'psa' || (scope.entitlement?.source === 'hosted' && scope.owner.plan !== 'pro') ||
          capacity.graceEndsAt || capacity.isReadOnly) throw new CoManagedAdmissionError('CO_MANAGED_LICENSE_LAPSED');
      if (capacity.available < input.seats - input.expectedSeats) throw new CoManagedAdmissionError('CO_MANAGED_POOL_LIMIT');
    }
    await tenantDb(trx, sponsorTenant).table('co_managed_allocations').where('allocation_id', scope.allocation.allocation_id)
      .update({ seats: input.seats, updated_at: trx.fn.now() });
    await tenantDb(trx, input.customerTenant).table('tenants').update({ licensed_user_count: input.seats });
  });
}
