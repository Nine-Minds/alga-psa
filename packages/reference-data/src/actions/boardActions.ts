'use server'

import { IBoard } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

export const getAllBoards = withAuth(async (_user, { tenant }, includeAll: boolean = true): Promise<IBoard[]> => {
  const { knex: db } = await createTenantKnex();
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
});
