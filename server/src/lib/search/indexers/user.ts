import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface UserSearchRow {
  user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_type: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function buildTitle(row: UserSearchRow): string {
  return compactJoin([row.first_name, row.last_name]) ?? row.username ?? row.email ?? row.user_id;
}

function toSourceUpdatedAt(row: UserSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: UserSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'user',
    objectId: row.user_id,
    title: buildTitle(row),
    subtitle: compactJoin([row.username, row.email]),
    url: `/msp/team/${row.user_id}`,
    acl: {
      requiredPermission: 'user:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const userIndexer: EntityIndexer = {
  objectType: 'user',
  sourceEvents: ['USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'USER_ROLES_UPDATED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<UserSearchRow>('users')
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'user_type', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('user_id', id)
      .andWhere('user_type', 'internal')
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<UserSearchRow>('users')
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'user_type', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('user_type', 'internal')
      .orderBy('user_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('user_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
