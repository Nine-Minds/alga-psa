import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IContract } from '@alga-psa/types';

export async function getContracts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IContract[]> {
  return tenantDb(knexOrTrx, tenant).table<IContract>('contracts')
    .select('*')
    .orderBy('contract_name', 'asc');
}
