import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';

export async function getClientLocations(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClientLocation[]> {
  return (await tenantDb(knexOrTrx, tenant).table('client_locations')
    .where({
      client_id: clientId,
      is_active: true,
    })
    .orderBy('is_default', 'desc')
    .orderBy('location_name', 'asc')) as unknown as IClientLocation[];
}
