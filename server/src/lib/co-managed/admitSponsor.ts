import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { admitCoManagedPermissions, lockCoManagedSponsorPool, neverActivated } from '@alga-psa/licensing';
import type { Knex } from 'knex';

/** Called only after the capability gate admits the authenticated sponsor. */
export async function admitCoManagedSponsor(tenant: string, connection?: Knex): Promise<void> {
  const knex = connection ?? (await createTenantKnex(tenant)).knex;
  await knex.transaction(async trx => {
    const home = tenantDb(trx, tenant);
    const entitlement = await lockCoManagedSponsorPool(trx, tenant);
    // A pending zero row (an unpaid observation) is no purchase: it seeds no grants.
    if ((!entitlement || neverActivated(entitlement)) &&
        !await home.table('co_managed_trial_sponsors').where('base_until', '>', trx.fn.now()).first('tenant')) return;
    const owner = await home.table('tenants').first('product_code');
    if (owner?.product_code !== 'psa') return;
    // Do not restore grants an administrator intentionally removed later.
    if (await home.table('permissions').where({ resource: 'co_management' }).first('permission_id')) return;
    await admitCoManagedPermissions(trx, tenant);
  });
}
