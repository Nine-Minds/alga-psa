import type { Knex } from 'knex';
import { retainTenantPsaLicense } from '@alga-psa/licensing';
import { upgradeCoManagedRelationship, type CoManagedIndependentUpgradeRequest,
  type CoManagedPolicyTarget, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { backfillPsaSeeds, applyRbacDelta, backfillClientTaxDefaults, ensureSlaParity } from './product-upgrade-operations.js';
import type { SeedRunLog } from './onboarding-seeds-operations.js';

/** Customer-admin command using an already staged, signed tenant license.
 * No Stripe swap, installation-license mutation, or provider call occurs here. */
export function upgradeCoManagedWorkspaceWithTenantLicense(db: Knex, actor: CoManagedSessionActor,
  target: CoManagedPolicyTarget, request: CoManagedIndependentUpgradeRequest, log: SeedRunLog) {
  return upgradeCoManagedRelationship(db, actor, target, request, async (trx, tenant) => {
    const entitlement = await retainTenantPsaLicense(trx, tenant);
    await backfillPsaSeeds(tenant, log, trx);
    await applyRbacDelta(tenant, log, trx);
    await backfillClientTaxDefaults(tenant, log, trx);
    await ensureSlaParity(tenant, log, trx);
    return { source: 'tenant_license', ...entitlement };
  });
}
