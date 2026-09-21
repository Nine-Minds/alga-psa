'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, getLicenseStateRow, type CoManagedPurchaseOperation } from '@alga-psa/licensing';

import { canManageCoManagedClient, getCoManagedManagementOptions, getCoManagedManagementStatus, changeCoManagedAllocationForActor,
  getCoManagedClientManagement as readCoManagedClientManagement, resolveCoManagedManagementTarget,
  getCoManagedOperationTarget as readCoManagedOperationTarget, getCoManagedClientOverview as readCoManagedClientOverview,
  type CoManagedManagementSelector } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { isEnterpriseEdition } from '../features';

export const canOpenCoManagedClientProvisioning = withAuth(async (user, { tenant }, clientId: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read') ||
      !await hasPermission(user, 'co_management', 'manage') || !await hasPermission(user, 'client', 'read') ||
      !await hasPermission(user, 'ticket', 'read')) return false;
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return canManageCoManagedClient(knex, actor, clientId);
});

export interface CoManagedPurchaseAvailability {
  deployment: 'hosted' | 'self_host';
  sponsorshipEligible: boolean;
  accountAuthority: 'purchaser' | 'reader';
  implementationAvailable: boolean;
  providerReady: boolean;
  pending: { operationId: string; quantity: number; state: string } | null;
  canPurchase: boolean;
  canResume: boolean;
  reason: 'available' | 'self_host_license' | 'ineligible' | 'no_permission' |
    'implementation_unavailable' | 'provider_unconfigured' | 'pending';
}

export const getCoManagedBillingState = withAuth(async (user, { tenant }) => {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const canReadRelationships = await hasPermission(user, 'co_management', 'read');
  if (!canReadRelationships && !await hasPermission(user, 'account_management', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT');
  const selfHosted = Boolean(await getLicenseStateRow());
  const state = await getCoManagedEntitlementState(knex, tenant);
  const purchaser = await hasPermission(user, 'account_management', 'update');
  const pending: CoManagedPurchaseOperation | undefined = await scoped.table('co_managed_purchase_operations')
    .whereIn('state', ['preparing', 'checkout']).select('operation_id', 'quantity', 'state', 'provider_reference').first();
  // A signed self-host license supplies capacity; absent or invalid claims are
  // missing self-host capacity, never evidence that hosted checkout is available.
  const sponsorshipEligible = owner.plan === 'pro' || (selfHosted && state.capacity > 0);
  const implementationAvailable = isEnterpriseEdition();
  const providerReady = implementationAvailable &&
    Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CO_MANAGED_USER_PRICE_ID);
  const canPurchase = !selfHosted && sponsorshipEligible && implementationAvailable && providerReady && purchaser && !pending;
  const canResume = !selfHosted && Boolean(pending) && purchaser;
  const reason: CoManagedPurchaseAvailability['reason'] = selfHosted ? 'self_host_license'
    : !sponsorshipEligible ? 'ineligible' : !purchaser ? 'no_permission'
      : !implementationAvailable ? 'implementation_unavailable' : !providerReady ? 'provider_unconfigured'
        : pending ? 'pending' : 'available';
  const purchase: CoManagedPurchaseAvailability = { deployment: selfHosted ? 'self_host' : 'hosted', sponsorshipEligible,
    accountAuthority: purchaser ? 'purchaser' : 'reader', implementationAvailable, providerReady,
    pending: pending ? { operationId: pending.operation_id, quantity: Number(pending.quantity), state: pending.state } : null,
    canPurchase, canResume, reason };
  return { ...state, selfHosted, canReadRelationships, isPro: sponsorshipEligible,
    canPurchase: canPurchase || canResume, pending: pending ?? null, purchase };
});

export const getCoManagedProvisioningOptions = withAuth(async (user, { tenant }, search: string = '', selectedClientId?: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedManagementOptions(knex, actor, search, selectedClientId);
});

export const getCoManagedProvisioningStatus = withAuth(async (user, { tenant }, page: number = 0) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedManagementStatus(knex, actor, page);
});

/** Authorized cross-client overview table. Pool totals are read separately so
 * an account-only reader never receives relationship rows and vice versa. */
export const getCoManagedClientOverviewAction = withAuth(async (user, { tenant }, input: { search?: string; page?: number; pageSize?: number } = {}) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return readCoManagedClientOverview(knex, actor, input);
});

export const changeCoManagedWorkspaceSeats = withAuth(async (user, { tenant }, input: {
  operationId: string; seats: number; expectedSeats: number;
}) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  await changeCoManagedAllocationForActor(knex, actor, { operationId: input.operationId, seats: input.seats, expectedSeats: input.expectedSeats });
});

/** Authorized per-client relationship discovery and seat usage for the client
 * record. Discovers every permitted sponsor mapping directly instead of paging
 * the global list, and never exposes a hidden candidate count. */
export const getCoManagedClientManagement = withAuth(async (user, { tenant }, clientId: string, relationshipId?: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return readCoManagedClientManagement(knex, actor, clientId, relationshipId);
});

/** Resolves an explicit customer-home or sponsor-client selector to the exact
 * qualified relationship and persisted operation. Legacy presentation adapters
 * use this to map an operation URL to its authorized client section. */
export const resolveCoManagedManagementTargetAction = withAuth(async (user, { tenant }, selector: CoManagedManagementSelector) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return resolveCoManagedManagementTarget(knex, actor, selector);
});

/** Maps a legacy sponsor operation URL to its authorized canonical local client
 * and exact relationship. A supplied client ID that mismatches the persisted
 * operation yields unavailable rather than redirecting to an unauthorized client. */
export const resolveCoManagedLegacyOperation = withAuth(async (user, { tenant }, operationId: string, expectedClientId?: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return readCoManagedOperationTarget(knex, actor, operationId, expectedClientId);
});
