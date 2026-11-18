import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { admitCoManagedPermissions } from '@alga-psa/licensing';
import type { Knex } from 'knex';

/** Called only after the capability gate admits the authenticated sponsor. */
export async function admitCoManagedSponsor(tenant: string, connection?: Knex): Promise<void> {
  const knex = connection ?? (await createTenantKnex(tenant)).knex;
  await knex.transaction(async trx => {
    const home = tenantDb(trx, tenant);
    const entitlement = await home.table('co_managed_entitlements').forUpdate().first();
    if (!entitlement) return;
    const owner = await home.table('tenants').first('product_code');
    if (owner?.product_code !== 'psa') return;
    // Do not restore grants an administrator intentionally removed later.
    if (await home.table('permissions').where({ resource: 'co_management' }).first('permission_id')) return;
    await admitCoManagedPermissions(trx, tenant);
  });
}
