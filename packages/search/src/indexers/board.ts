import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface BoardSearchRow {
  board_id: string;
  board_name: string;
}

function toSearchDoc(tenant: string, row: BoardSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'board',
    objectId: row.board_id,
    title: row.board_name,
    url: `/msp/tickets?boardId=${encodeURIComponent(row.board_id)}`,
    acl: {
      requiredPermission: 'ticket:read',
    },
    sourceUpdatedAt: new Date(),
  };
}

export const boardIndexer: EntityIndexer = {
  objectType: 'board',
  sourceEvents: [
    'BOARD_CREATED',
    'BOARD_UPDATED',
    'BOARD_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<BoardSearchRow>(knex, 'boards', 'boards', tenant)
      .select('board_id', 'board_name')
      .andWhere('board_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<BoardSearchRow>(knex, 'boards', 'boards', tenant)
      .select('board_id', 'board_name')
      .orderBy('board_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('board_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
