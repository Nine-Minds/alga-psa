'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, getLicenseStateRow, type CoManagedPurchaseOperation } from '@alga-psa/licensing';

import { canManageCoManagedClient, getCoManagedManagementOptions, getCoManagedManagementStatus, changeCoManagedAllocationForActor } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const canOpenCoManagedClientProvisioning = withAuth(async (user, { tenant }, clientId: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read') ||
      !await hasPermission(user, 'co_management', 'manage') || !await hasPermission(user, 'client', 'read') ||
      !await hasPermission(user, 'ticket', 'read')) return false;
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return canManageCoManagedClient(knex, actor, clientId);
});

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
  const pending: CoManagedPurchaseOperation | undefined = await scoped.table('co_managed_purchase_operations')
    .whereIn('state', ['preparing', 'checkout']).select('operation_id', 'quantity', 'state', 'provider_reference').first();
  return { ...state, selfHosted, canReadRelationships, isPro: owner.plan === 'pro' || (selfHosted && state.capacity > 0),
    canPurchase: !selfHosted && await hasPermission(user, 'account_management', 'update'), pending: pending ?? null };
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

export const changeCoManagedWorkspaceSeats = withAuth(async (user, { tenant }, input: {
  operationId: string; seats: number; expectedSeats: number;
}) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  await changeCoManagedAllocationForActor(knex, actor, { operationId: input.operationId, seats: input.seats, expectedSeats: input.expectedSeats });
});
