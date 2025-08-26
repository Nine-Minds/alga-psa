'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

export interface UserCompanyInfo {
  user_id: string;
  company_id: string | null;
  company_name: string | null;
}

/**
 * Returns company info for a batch of users in the current tenant.
 * Joins users -> contacts -> companies using tenant-aware joins for Citus.
 */
export async function getUsersCompanyInfo(userIds: string[]): Promise<UserCompanyInfo[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(currentUser, 'user', 'read', trx)) {
      throw new Error('Permission denied: Cannot read user company info');
    }

    const rows = await trx('users as u')
      .leftJoin('contacts as c', function () {
        this.on('u.contact_id', '=', 'c.contact_name_id')
            .andOn('u.tenant', '=', 'c.tenant');
      })
      .leftJoin('companies as co', function () {
        this.on('c.company_id', '=', 'co.company_id')
            .andOn('c.tenant', '=', 'co.tenant');
      })
      .where('u.tenant', tenant)
      .whereIn('u.user_id', userIds)
      .select(
        'u.user_id as user_id',
        'c.company_id as company_id',
        'co.company_name as company_name'
      );

    return rows.map((r) => ({
      user_id: r.user_id,
      company_id: r.company_id ?? null,
      company_name: r.company_name ?? null,
    }));
  });
}

