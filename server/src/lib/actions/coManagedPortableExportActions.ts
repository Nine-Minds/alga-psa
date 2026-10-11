'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from '../../../../packages/co-managed/src/portableExport';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedPortableExportScreenAction = withAuth(async (user, { tenant }) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return withCoManagedExportAdmin(knex, actor, async trx => {
    const owner = await tenantDb(trx, tenant).table('tenants').first('client_name');
    return { workspaceName: String(owner.client_name ?? '') };
  });
});
