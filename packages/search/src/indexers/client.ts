import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ClientSearchRow {
  client_id: string;
  client_name: string;
  billing_email: string | null;
  notes: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: ClientSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ClientSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'client',
    objectId: row.client_id,
    title: row.client_name,
    subtitle: compactJoin([row.billing_email]),
    body: row.notes ?? undefined,
    url: `/msp/clients/${row.client_id}`,
    acl: {
      requiredPermission: 'client:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const clientIndexer: EntityIndexer = {
  objectType: 'client',
  sourceEvents: ['CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CLIENT_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<ClientSearchRow>(knex, 'clients', 'clients', tenant)
      .select('client_id', 'client_name', 'billing_email', 'notes', 'created_at', 'updated_at')
      .andWhere('client_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<ClientSearchRow>(knex, 'clients', 'clients', tenant)
      .select('client_id', 'client_name', 'billing_email', 'notes', 'created_at', 'updated_at')
      .orderBy('client_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('client_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
