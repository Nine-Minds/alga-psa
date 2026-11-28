import type { Knex } from 'knex';
import type { IBoard, IPriority, IStatus, ItemType } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
import Priority from '../models/priority';

// Plain (non-'use server') bodies of the board, status and priority list actions. They are not
// server actions themselves: a caller supplies the already-authenticated tenant, as the withAuth
// wrappers in ../actions do. The batched reference-list loader calls them directly.

/** Body of `getAllBoards`. Like the action, a failed query yields an empty list. */
export async function loadBoards(db: Knex, tenant: string, includeAll: boolean = true): Promise<IBoard[]> {
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const boards = await tenantDb(trx, tenant).table('boards')
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc') as IBoard[];
      return boards;
    });
  } catch (error) {
    console.error('Failed to fetch boards:', error);
    return [];
  }
}

/** Body of `getStatuses`. Throws on failure, like the action. */
export async function loadStatuses(
  db: Knex,
  tenant: string,
  type?: ItemType,
  boardId?: string | null
): Promise<IStatus[]> {
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const query = tenantDb(trx, tenant).table<IStatus>('statuses')
      .select('*')
      .orderBy('order_number');

    if (type) {
      query.where({ status_type: type });
      if (type === ('ticket' as ItemType)) {
        query.whereNotNull('board_id');
        if (boardId) {
          query.andWhere({ board_id: boardId });
        }
      }
    }

    return await query;
  });
}

/** Body of `getAllPriorities`. Throws on failure, like the action. */
export async function loadPriorities(
  db: Knex,
  tenant: string,
  itemType?: 'ticket' | 'project_task'
): Promise<IPriority[]> {
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return await Priority.getAll(trx, tenant, itemType);
  });
}
