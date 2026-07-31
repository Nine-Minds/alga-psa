'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { resolveTenantCurrency } from '../lib';

export const getInventoryTenantCurrency = withAuth(
  async (user, { tenant }): Promise<string> => {
    if (!(await hasPermission(user, 'inventory', 'read'))) {
      throw new Error('Permission denied: inventory read required');
    }

    const { knex } = await createTenantKnex();
    return resolveTenantCurrency(knex, tenant);
  },
);
