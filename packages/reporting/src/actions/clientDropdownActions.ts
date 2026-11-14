'use server'

import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';

/**
 * Lightweight client id/name pairs for filter dropdowns.
 */
export const fetchClientsForDropdown = withAuth(async (user, { tenant }) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const query = trx('clients').where('tenant', tenant);
      // The dropdown lists the clients the subject may read, like the clients list does.
      (await (await createClientScopeContext(trx, tenant, user)).narrowing('client', 'clients')).apply(query);
      const rows = await query
        .select('client_id', 'client_name')
        .orderBy('client_name', 'asc');

      return rows.map((row: { client_id: string; client_name: string }) => ({
        id: row.client_id,
        name: row.client_name
      }));
    } catch (error) {
      console.error('Error fetching clients for dropdown:', error);
      throw error;
    }
  });
});
