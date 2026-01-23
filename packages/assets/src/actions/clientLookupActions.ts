'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/users/actions';

export async function getAllClientsForAssets(includeInactive: boolean = true): Promise<IClient[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

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
}

export async function getClientLocationsForAssets(clientId: string): Promise<IClientLocation[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

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
}
