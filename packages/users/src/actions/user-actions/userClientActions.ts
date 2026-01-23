'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '../../lib/permissions';

export interface UserClientInfo {
  user_id: string;
  client_id: string | null;
  client_name: string | null;
}

/**
 * Returns client info for a batch of users in the current tenant.
 * Joins users -> contacts -> clients using tenant-aware joins for Citus.
 */
export async function getUsersClientInfo(userIds: string[]): Promise<UserClientInfo[]> {
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
      throw new Error('Permission denied: Cannot read user client info');
    }

    const rows = await trx('users as u')
      .leftJoin('contacts as c', function () {
        this.on('u.contact_id', '=', 'c.contact_name_id')
            .andOn('u.tenant', '=', 'c.tenant');
      })
      .leftJoin('clients as co', function () {
        this.on('c.client_id', '=', 'co.client_id')
            .andOn('c.tenant', '=', 'co.tenant');
      })
      .where('u.tenant', tenant)
      .whereIn('u.user_id', userIds)
      .select(
        'u.user_id as user_id',
        'c.client_id as client_id',
        'co.client_name as client_name'
      );

    return rows.map((r) => ({
      user_id: r.user_id,
      client_id: r.client_id ?? null,
      client_name: r.client_name ?? null,
    }));
  });
}

