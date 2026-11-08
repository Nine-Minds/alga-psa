import { defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';
import type { CoManagedIndependentUpgradeCommand } from '@alga-psa/co-managed';
import type * as activities from '../activities/co-managed-upgrade-activities.js';
import type { TenantProductUpgradeStatus } from './tenant-product-upgrade-workflow.js';

const upgrade = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m', retry: { maximumAttempts: 3, initialInterval: '1s', maximumInterval: '30s' },
});
const statusQuery = defineQuery<TenantProductUpgradeStatus>('productUpgradeStatus');

/** Entitlement, trust closure, seeds and the product transition commit as one activity. */
export async function coManagedIndependentUpgradeWorkflow(input: { coManaged: CoManagedIndependentUpgradeCommand }): Promise<void> {
  const status: TenantProductUpgradeStatus = { currentStep: 'product_upgrade_co_managed', completedSteps: [] };
  setHandler(statusQuery, () => ({ ...status, completedSteps: [...status.completedSteps] }));
  await upgrade.product_upgrade_co_managed(input.coManaged);
  status.completedSteps.push('product_upgrade_co_managed');
  status.currentStep = null;
}
