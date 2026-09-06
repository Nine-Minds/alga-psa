'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, getLicenseStateRow, type CoManagedPurchaseOperation } from '@alga-psa/licensing';

export const getCoManagedBillingState = withAuth(async (user, { tenant }) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'account_management', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT');
  const selfHosted = Boolean(await getLicenseStateRow());
  const state = await getCoManagedEntitlementState(knex, tenant);
  const pending: CoManagedPurchaseOperation | undefined = await scoped.table('co_managed_purchase_operations')
    .whereIn('state', ['preparing', 'checkout']).select('operation_id', 'quantity', 'state', 'provider_reference').first();
  return { ...state, selfHosted, isPro: owner.plan === 'pro' || (selfHosted && state.capacity > 0),
    canPurchase: !selfHosted && await hasPermission(user, 'account_management', 'update'), pending: pending ?? null };
});
