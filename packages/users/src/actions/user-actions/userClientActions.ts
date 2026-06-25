'use server';

import { createTenantKnex, createTenantScopedQuery, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/user-composition/lib/permissions';

export interface UserClientInfo {
  user_id: string;
  client_id: string | null;
  client_name: string | null;
}

/**
 * Returns client info for a batch of users in the current tenant.
 * Joins users -> contacts -> clients using tenant-aware joins for Citus.
 */
export const getUsersClientInfo = withAuth(async (
  user,
  { tenant },
  userIds: string[]
): Promise<UserClientInfo[]> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'user', 'read', trx)) {
      throw new Error('Permission denied: Cannot read user client info');
    }

    const rows = await createTenantScopedQuery(trx, {
      table: 'users as u',
      alias: 'u',
      tenant,
    }).builder
      .leftJoin('contacts as c', function () {
        this.on('u.contact_id', '=', 'c.contact_name_id')
            .andOn('u.tenant', '=', 'c.tenant');
      })
      .leftJoin('clients as co', function () {
        this.on('c.client_id', '=', 'co.client_id')
            .andOn('c.tenant', '=', 'co.tenant');
      })
      .whereIn('u.user_id', userIds)
      .select(
        'u.user_id as user_id',
        'c.client_id as client_id',
        'co.client_name as client_name'
      ) as UserClientInfo[];

    return rows.map((r) => ({
      user_id: r.user_id,
      client_id: r.client_id ?? null,
      client_name: r.client_name ?? null,
    }));
  });
});
