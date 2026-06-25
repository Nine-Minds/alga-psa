import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ContactSearchRow {
  contact_name_id: string;
  full_name: string;
  email: string | null;
  role: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: ContactSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ContactSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'contact',
    objectId: row.contact_name_id,
    title: row.full_name,
    subtitle: compactJoin([row.email, row.role]),
    url: `/msp/contacts/${row.contact_name_id}`,
    acl: {
      requiredPermission: 'contact:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const contactIndexer: EntityIndexer = {
  objectType: 'contact',
  sourceEvents: ['CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_ARCHIVED', 'CONTACT_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<ContactSearchRow>(knex, 'contacts', 'contacts', tenant)
      .select('contact_name_id', 'full_name', 'email', 'role', 'created_at', 'updated_at')
      .andWhere('contact_name_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<ContactSearchRow>(knex, 'contacts', 'contacts', tenant)
      .select('contact_name_id', 'full_name', 'email', 'role', 'created_at', 'updated_at')
      .orderBy('contact_name_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('contact_name_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
