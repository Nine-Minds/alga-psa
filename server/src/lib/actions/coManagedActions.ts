'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { admits } from '@alga-psa/core/capability';
import { CoManagedAdmissionError, getCoManagedEntitlementState, getLicenseStateRow, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { isEnterpriseEdition } from '../features';
import { getCoManagedManagementOptions, getCoManagedManagementStatus, changeCoManagedAllocationForActor,
  getCoManagedClientManagement as readCoManagedClientManagement,
  getCoManagedClientOverview as readCoManagedClientOverview } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { admitCoManagedSponsor } from '../co-managed/admitSponsor';

// Enabling and management actions gate on `admits` (flag AND entitlement) before
// touching the database. The two overview reads (seat capacity and the client
// table) show state that already exists, so they gate on `serves`: a served but
// not admitted sponsor sees a read-only overview. Only an admitted sponsor has
// its co-management grants (re)applied.
async function admitSponsorWhenAdmitted(tenant: string): Promise<void> {
  if ((await admits('co-managed', tenant)).admitted) await admitCoManagedSponsor(tenant);
}

/** Seat capacity for the sponsor, used to hint whether another workspace fits.
 * Purchase flows are deliberately absent: capacity comes from the entitlement row. */
export const getCoManagedBillingState = withAuth(async (user, { tenant }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  await admitSponsorWhenAdmitted(tenant);
  const canReadRelationships = await hasPermission(user, 'co_management', 'read');
  if (!canReadRelationships && !await hasPermission(user, 'account_management', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const owner = await tenantDb(knex, tenant).table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT');
  const selfHosted = Boolean(await getLicenseStateRow());
  const state = await getCoManagedEntitlementState(knex, tenant);
  return { ...state, selfHosted, canReadRelationships, isPro: owner.plan === 'pro' || (selfHosted && state.capacity > 0) };
});

export interface CoManagedPurchaseAvailability {
  pending: { operationId: string; quantity: number; state: string } | null;
  canPurchase: boolean;
  canResume: boolean;
  reason: 'available' | 'self_host_license' | 'ineligible' | 'no_permission' | 'implementation_unavailable' | 'pending';
}

/**
 * Pool state plus purchase availability for the account surface.
 *
 * Deliberately not behind `admits`: eligibility is an entitlement row and a purchase is how the first
 * row comes to exist. The surface gate is the kill switch, the release flag and a configured price;
 * when it is closed this returns null before reading anything, and the screen renders nothing.
 */
export const getCoManagedPurchaseState = withAuth(async (user, { tenant }) => {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) return null;
  if (!await hasPermission(user, 'account_management', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa') return null;
  const selfHosted = Boolean(await getLicenseStateRow());
  const state = await getCoManagedEntitlementState(knex, tenant);
  const purchaser = await hasPermission(user, 'account_management', 'update');
  // payment_failed stays in flight so the same operation is recovered instead of charged twice.
  const pending = await scoped.table('co_managed_purchase_operations')
    .whereIn('state', ['preparing', 'checkout', 'payment_failed']).select('operation_id', 'quantity', 'state').first();
  const implementationAvailable = isEnterpriseEdition();
  const eligible = owner.plan === 'pro';
  const reason: CoManagedPurchaseAvailability['reason'] = selfHosted ? 'self_host_license'
    : !eligible ? 'ineligible' : !purchaser ? 'no_permission' : !implementationAvailable ? 'implementation_unavailable'
      : pending ? 'pending' : 'available';
  const availability: CoManagedPurchaseAvailability = {
    pending: pending ? { operationId: pending.operation_id, quantity: Number(pending.quantity), state: pending.state } : null,
    canPurchase: reason === 'available', canResume: reason === 'pending', reason };
  return { ...state, selfHosted, purchase: availability };
});

export const getCoManagedProvisioningOptions = withAuth(async (user, { tenant }, search: string = '', selectedClientId?: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type === 'internal') await admitCoManagedSponsor(tenant);
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedManagementOptions(knex, actor, search, selectedClientId);
});

export const getCoManagedProvisioningStatus = withAuth(async (user, { tenant }, page: number = 0) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type === 'internal') await admitCoManagedSponsor(tenant);
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedManagementStatus(knex, actor, page);
});

/** Authorized cross-client overview table. */
export const getCoManagedClientOverviewAction = withAuth(async (user, { tenant }, input: { search?: string; page?: number; pageSize?: number } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type === 'internal') await admitSponsorWhenAdmitted(tenant);
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return readCoManagedClientOverview(knex, actor, input);
});

export const changeCoManagedWorkspaceSeats = withAuth(async (user, { tenant }, input: {
  operationId: string; seats: number; expectedSeats: number;
}) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  try {
    await changeCoManagedAllocationForActor(knex, actor, { operationId: input.operationId, seats: input.seats, expectedSeats: input.expectedSeats });
    return { changed: true as const };
  } catch (error) {
    // Admission refusals are expected outcomes the screen must name (a thrown
    // error reaches the client as a redacted generic failure).
    if (error instanceof CoManagedAdmissionError) return { changed: false as const, errorCode: error.code };
    throw error;
  }
});

/** Authorized per-client relationship discovery and seat usage for the client record. */
export const getCoManagedClientManagement = withAuth(async (user, { tenant }, clientId: string, relationshipId?: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type === 'internal') await admitCoManagedSponsor(tenant);
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return readCoManagedClientManagement(knex, actor, clientId, relationshipId);
});
