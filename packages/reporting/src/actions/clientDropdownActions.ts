'use server'

import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

/**
 * Lightweight client id/name pairs for filter dropdowns.
 */
export const fetchClientsForDropdown = withAuth(async (_user, { tenant }) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const rows = await trx('clients')
        .where('tenant', tenant)
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
