import type { Knex } from 'knex';
import type { IClientLocation } from '@alga-psa/types';

export async function getClientLocations(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClientLocation[]> {
  return (await knexOrTrx('client_locations')
    .where({
      client_id: clientId,
      tenant,
      is_active: true,
    })
    .orderBy('is_default', 'desc')
    .orderBy('location_name', 'asc')) as unknown as IClientLocation[];
}

