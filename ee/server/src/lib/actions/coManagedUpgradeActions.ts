'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CapabilityUnavailableError } from '@alga-psa/core/capability/server';
import { getCoManagedIndependentUpgradeScreen, resolveCoManagedUpgradeAccess, prepareCoManagedIndependentUpgrade,
  type CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';
import { startTenantProductUpgradeWorkflow, getTenantProductUpgradeStatus } from '../tenant-management/workflowClient';

/** Mutations start something new (checkout, purchase, the upgrade itself), so they need the whole upgrade
 * gate, release flag included, and only a current customer passes it. `serves` alone ignores the flag. */
async function requireUpgradeCustomer(knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'], tenant: string): Promise<void> {
  if (await resolveCoManagedUpgradeAccess(knex, tenant) !== 'customer') throw new CapabilityUnavailableError();
}

export const getCoManagedUpgradeScreenAction = withAuth(async (user, { tenant }) => {
  // Read-only screen: the shared upgrade gate (kill switch, flag, customer or former customer), not `serves`,
  // so a former customer that no longer participates still gets its completed state. Mutations need 'customer'.
  const { knex } = await createTenantKnex(tenant);
  if (await resolveCoManagedUpgradeAccess(knex, tenant) === 'closed') throw new CapabilityUnavailableError();
  const actor = await coManagedBrowserActor(user, tenant);
  const prices = [process.env.STRIPE_ALGAPSA_USER_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID || process.env.STRIPE_PRO_ANNUAL_PRICE_ID].filter((id): id is string => Boolean(id));
  const screen = await getCoManagedIndependentUpgradeScreen(knex, actor, prices);
  if (screen.state === 'completed') return { ...screen, purchaseConfigured: false, progress: 'completed' as const };
  const status = await getTenantProductUpgradeStatus(tenant);
  const purchaseConfigured = prices.length > 0;
  return { ...screen, purchaseConfigured, progress: status.available ? status.data.state : 'unavailable' as const };
});

export const startCoManagedUpgradeAction = withAuth(async (user, { tenant }, input: CoManagedIndependentUpgradeRequest & { relationshipId: string }) => {
  const { knex } = await createTenantKnex(tenant);
  await requireUpgradeCustomer(knex, tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const target = { customerTenant: tenant, relationshipId: input?.relationshipId };
  const request = { operationId: input?.operationId, expectedRevision: input?.expectedRevision };
  const prepared = await prepareCoManagedIndependentUpgrade(knex, actor, target, request, async () => undefined);
  if (prepared.kind === 'completed') return { completed: true, enqueued: false };
  const result = await startTenantProductUpgradeWorkflow({ tenantId: tenant, requestedByUserId: user.user_id,
    coManaged: { actor, target, request } });
  return { completed: false, enqueued: result.available };
});

export const purchaseCoManagedUpgradeAction = withAuth(async (user, { tenant }, input: import('@alga-psa/co-managed').CoManagedUpgradePurchaseRequest) => {
  const { knex } = await createTenantKnex(tenant);
  await requireUpgradeCustomer(knex, tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { purchaseCoManagedIndependentPsa } = await import('../stripe/coManagedUpgradeCheckout');
  return purchaseCoManagedIndependentPsa(knex, actor, input);
});

export const retryCoManagedUpgradePaymentAction = withAuth(async (user, { tenant }, operationId: string) => {
  const { knex } = await createTenantKnex(tenant);
  await requireUpgradeCustomer(knex, tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { retryCoManagedIndependentPayment } = await import('../stripe/coManagedUpgradeCheckout');
  return retryCoManagedIndependentPayment(knex, actor, operationId);
});

export const manageCoManagedUpgradeBillingAction = withAuth(async (user, { tenant }, input: { kind: 'payment_method' | 'seats'; quantity?: number }) => {
  const { knex } = await createTenantKnex(tenant);
  await requireUpgradeCustomer(knex, tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { openCoManagedIndependentBilling } = await import('../stripe/coManagedUpgradeCheckout');
  return openCoManagedIndependentBilling(knex, actor, input);
});

/** Page-level gate (page and generateMetadata): 'customer' | 'former' | 'closed', from the one shared function. */
export const getCoManagedUpgradeAccessAction = withAuth(async (_user, { tenant }) => {
  const { knex } = await createTenantKnex(tenant);
  return { access: await resolveCoManagedUpgradeAccess(knex, tenant) };
});
