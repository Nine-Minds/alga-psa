'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { getCoManagedIndependentUpgradeScreen, getCoManagedUpgradeAudience, prepareCoManagedIndependentUpgrade,
  type CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';
import { startTenantProductUpgradeWorkflow, getTenantProductUpgradeStatus } from '../tenant-management/workflowClient';

export const getCoManagedUpgradeScreenAction = withAuth(async (user, { tenant }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const { knex } = await createTenantKnex(tenant);
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
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const { knex } = await createTenantKnex(tenant);
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
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const { knex } = await createTenantKnex(tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { purchaseCoManagedIndependentPsa } = await import('../stripe/coManagedUpgradeCheckout');
  return purchaseCoManagedIndependentPsa(knex, actor, input);
});

export const retryCoManagedUpgradePaymentAction = withAuth(async (user, { tenant }, operationId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const { knex } = await createTenantKnex(tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { retryCoManagedIndependentPayment } = await import('../stripe/coManagedUpgradeCheckout');
  return retryCoManagedIndependentPayment(knex, actor, operationId);
});

export const manageCoManagedUpgradeBillingAction = withAuth(async (user, { tenant }, input: { kind: 'payment_method' | 'seats'; quantity?: number }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const { knex } = await createTenantKnex(tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { openCoManagedIndependentBilling } = await import('../stripe/coManagedUpgradeCheckout');
  return openCoManagedIndependentBilling(knex, actor, input);
});

/** Page-level audience check (own tenant only, from the session): the customer side of a co-managed
 * relationship, or a tenant with a completed independent upgrade. Pass `includeCustomer: false` when
 * the capability gate is closed so only the completed-upgrade row is consulted. */
export const getCoManagedUpgradeAudienceAction = withAuth(async (_user, { tenant }, includeCustomer: boolean = true) => {
  const { knex } = await createTenantKnex(tenant);
  const audience = await getCoManagedUpgradeAudience(knex, tenant, includeCustomer);
  return { audience: audience.customer || audience.completed };
});
