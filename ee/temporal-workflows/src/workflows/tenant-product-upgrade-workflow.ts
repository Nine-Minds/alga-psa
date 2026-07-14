import {
  defineQuery,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type * as productUpgradeActivities from '../activities/product-upgrade-activities.js';

export interface TenantProductUpgradeInput {
  tenantId: string;
  requestedByUserId: string;
}

export interface TenantProductUpgradeStatus {
  currentStep: string | null;
  completedSteps: string[];
}

type DatabaseActivities = Omit<
  typeof productUpgradeActivities,
  'product_upgrade_stripe_swap'
>;

const databaseActivities = proxyActivities<DatabaseActivities>({
  startToCloseTimeout: '5m',
});

const stripeActivities = proxyActivities<Pick<
  typeof productUpgradeActivities,
  'product_upgrade_stripe_swap'
>>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export const productUpgradeStatusQuery = defineQuery<TenantProductUpgradeStatus>(
  'productUpgradeStatus',
);

export async function tenantProductUpgradeWorkflow(
  input: TenantProductUpgradeInput,
): Promise<void> {
  const status: TenantProductUpgradeStatus = {
    currentStep: null,
    completedSteps: [],
  };
  setHandler(productUpgradeStatusQuery, () => ({
    currentStep: status.currentStep,
    completedSteps: [...status.completedSteps],
  }));

  const runStep = async (name: string, run: () => Promise<unknown>) => {
    status.currentStep = name;
    await run();
    status.completedSteps.push(name);
  };

  log.info('Starting tenant product upgrade', {
    tenantId: input.tenantId,
    requestedByUserId: input.requestedByUserId,
  });

  await runStep('product_upgrade_preflight', () =>
    databaseActivities.product_upgrade_preflight(input.tenantId));
  await runStep('product_upgrade_backfill_seeds', () =>
    databaseActivities.product_upgrade_backfill_seeds(input.tenantId));
  await runStep('product_upgrade_rbac_delta', () =>
    databaseActivities.product_upgrade_rbac_delta(input.tenantId));
  await runStep('product_upgrade_client_backfill', () =>
    databaseActivities.product_upgrade_client_backfill(input.tenantId));
  await runStep('product_upgrade_sla_parity', () =>
    databaseActivities.product_upgrade_sla_parity(input.tenantId));
  await runStep('product_upgrade_stripe_swap', () =>
    stripeActivities.product_upgrade_stripe_swap(input.tenantId));
  await runStep('product_upgrade_flip', () =>
    databaseActivities.product_upgrade_flip(input.tenantId));
  await runStep('product_upgrade_verify', () =>
    databaseActivities.product_upgrade_verify(input.tenantId));

  status.currentStep = null;
  log.info('Tenant product upgrade completed', { tenantId: input.tenantId });
}
