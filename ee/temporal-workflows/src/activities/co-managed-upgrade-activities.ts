import { ApplicationFailure, Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin';

/** The independent transition keeps entitlement, seeds, trust and product flip
 * atomic. The existing AlgaDesk Stripe swap is never part of this branch. */
export async function product_upgrade_co_managed(command: import('@alga-psa/co-managed').CoManagedIndependentUpgradeCommand) {
  // Temporal adapter (PLAN §2): the kill switch / participation gate decides before any SQL. Workers never
  // call PostHog. Resolver registration is a side effect of the lazy import, kept out of module load so the
  // worker boots even if @alga-psa/co-managed cannot resolve. A closed gate fails the one-step branch
  // non-retryably; the command is idempotent per operationId, so the customer can start it again later.
  await import('@alga-psa/co-managed/capability');
  const { activityServesCapability } = await import('@alga-psa/core/capability');
  if (await activityServesCapability('co-managed', command.target.customerTenant)) {
    throw ApplicationFailure.nonRetryable('CO_MANAGED_CAPABILITY_CLOSED', 'CO_MANAGED_CAPABILITY_CLOSED');
  }
  const db = await getAdminConnection();
  const log = Context.current().log;
  try {
    if (await db('license_state').first('id')) {
      const { upgradeCoManagedWorkspaceWithTenantLicense } = await import('../db/co-managed-upgrade-operations.js');
      return await upgradeCoManagedWorkspaceWithTenantLicense(db, command.actor, command.target, command.request, log);
    }
    const { upgradeCoManagedWorkspaceWithHostedSubscription } = await import('../db/co-managed-hosted-upgrade.js');
    return await upgradeCoManagedWorkspaceWithHostedSubscription(db, command.actor, command.target, command.request, log);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && ['CO_MANAGED_SHARED_WORK_FORBIDDEN', 'INVALID_UPGRADE', 'UPGRADE_CHANGED',
      'PAID_ENTITLEMENT_REQUIRED', 'INSUFFICIENT_PSA_SEATS'].includes(code))
      throw ApplicationFailure.nonRetryable(code, code);
    throw error;
  }
}
