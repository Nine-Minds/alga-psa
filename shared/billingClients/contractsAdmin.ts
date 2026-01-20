import type { Knex } from 'knex';
import type { IContract } from '@alga-psa/types';

export async function getContracts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IContract[]> {
  return knexOrTrx<IContract>('contracts')
    .where({ tenant })
    .select('*')
    .orderBy('contract_name', 'asc');
}

