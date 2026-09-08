'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedIndependentUpgradeScreen, prepareCoManagedIndependentUpgrade,
  type CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';
import { startTenantProductUpgradeWorkflow, getTenantProductUpgradeStatus } from '../tenant-management/workflowClient';

export const getCoManagedUpgradeScreenAction = withAuth(async (user, { tenant }) => {
  const { knex } = await createTenantKnex(tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const prices = [process.env.STRIPE_ALGAPSA_USER_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID || process.env.STRIPE_PRO_ANNUAL_PRICE_ID].filter((id): id is string => Boolean(id));
  const screen = await getCoManagedIndependentUpgradeScreen(knex, actor, prices);
  if (screen.state === 'completed') return { ...screen, progress: 'completed' as const };
  const status = await getTenantProductUpgradeStatus(tenant);
  return { ...screen, progress: status.available ? status.data.state : 'unavailable' as const };
});

export const startCoManagedUpgradeAction = withAuth(async (user, { tenant }, input: CoManagedIndependentUpgradeRequest & { relationshipId: string }) => {
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
  const { knex } = await createTenantKnex(tenant);
  const actor = await coManagedBrowserActor(user, tenant);
  const { purchaseCoManagedIndependentPsa } = await import('../stripe/coManagedUpgradeCheckout');
  return purchaseCoManagedIndependentPsa(knex, actor, input);
});
