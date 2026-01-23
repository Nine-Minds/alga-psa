'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';

export const getAllClientsForAssets = withAuth(async (
  _user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];
});

export const getClientLocationsForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientLocation[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return trx('client_locations')
      .where({
        client_id: clientId,
        tenant,
        is_active: true,
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');
  }) as unknown as IClientLocation[];
});
