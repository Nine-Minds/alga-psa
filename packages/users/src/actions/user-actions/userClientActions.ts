'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/user-composition/lib/permissions';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export interface UserClientInfo {
  user_id: string;
  client_id: string | null;
  client_name: string | null;
}

export type UserClientInfoActionError = ActionMessageError | ActionPermissionError;

function userClientInfoActionErrorFrom(error: unknown): UserClientInfoActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected users is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected users no longer exists. Please refresh and try again.');
  }

  return null;
}

/**
 * Returns client info for a batch of users in the current tenant.
 * Joins users -> contacts -> clients using tenant-aware joins for Citus.
 */
export const getUsersClientInfo = withAuth(async (
  user,
  { tenant },
  userIds: string[]
): Promise<UserClientInfo[] | UserClientInfoActionError> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'user', 'read', trx)) {
        return permissionError('Permission denied: Cannot read user client info');
      }

      const scopedDb = tenantDb(trx, tenant);
      const usersQuery = scopedDb.table('users as u');
      scopedDb.tenantJoin(usersQuery, 'contacts as c', 'u.contact_id', 'c.contact_name_id', { type: 'left' });
      scopedDb.tenantJoin(usersQuery, 'clients as co', 'c.client_id', 'co.client_id', { type: 'left' });

      const rows = await usersQuery
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
  } catch (error) {
    const expected = userClientInfoActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
