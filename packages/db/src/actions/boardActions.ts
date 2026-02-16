import type { IBoard } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '../lib/tenant';
import type { Knex } from 'knex';

export async function getAllBoards(tenant: string, includeAll: boolean = true): Promise<IBoard[]> {
  const { knex: db } = await createTenantKnex(tenant);

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const boards = await trx('boards')
        .where({ tenant })
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc');
      return boards;
    });
  } catch (error) {
    console.error('Failed to fetch boards:', error);
    return [];
  }
}
