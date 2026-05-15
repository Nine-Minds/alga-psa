import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface CategorySearchRow {
  category_id: string;
  category_name: string;
  board_id: string | null;
  created_at?: Date | string | null;
}

function toSearchDoc(tenant: string, row: CategorySearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'category',
    objectId: row.category_id,
    title: row.category_name,
    url: `/msp/tickets?categoryId=${encodeURIComponent(row.category_id)}`,
    metadata: row.board_id ? { board_id: row.board_id } : undefined,
    acl: {
      requiredPermission: 'ticket:read',
    },
    sourceUpdatedAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export const categoryIndexer: EntityIndexer = {
  objectType: 'category',
  sourceEvents: [
    'CATEGORY_CREATED',
    'CATEGORY_UPDATED',
    'CATEGORY_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<CategorySearchRow>('categories')
      .select('category_id', 'category_name', 'board_id', 'created_at')
      .where('tenant', tenant)
      .andWhere('category_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<CategorySearchRow>('categories')
      .select('category_id', 'category_name', 'board_id', 'created_at')
      .where('tenant', tenant)
      .orderBy('category_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('category_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
