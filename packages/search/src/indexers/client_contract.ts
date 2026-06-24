import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ClientContractSearchRow {
  client_contract_id: string;
  client_id: string;
  contract_id: string;
  client_name: string;
  contract_name: string;
  start_date: Date | string | null;
  end_date: Date | string | null;
  is_active: boolean | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toDateString(value: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return new Date(value).toISOString().slice(0, 10);
}

function toSourceUpdatedAt(row: ClientContractSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ClientContractSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'client_contract',
    objectId: row.client_contract_id,
    parentType: 'contract',
    parentId: row.contract_id,
    title: `${row.client_name} – ${row.contract_name}`,
    body: compactJoin([
      toDateString(row.start_date),
      toDateString(row.end_date),
      row.is_active == null ? undefined : row.is_active ? 'active' : 'inactive',
    ]),
    url: `/msp/clients/${row.client_id}/contracts/${row.client_contract_id}`,
    acl: {
      requiredPermission: 'contract:read',
      clientScopeId: row.client_id,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseClientContractQuery(knex: Knex, tenant: string) {
  return knex<ClientContractSearchRow>('client_contracts as cc')
    .join('clients as cl', function() {
      this.on('cl.tenant', 'cc.tenant').andOn('cl.client_id', 'cc.client_id');
    })
    .join('contracts as c', function() {
      this.on('c.tenant', 'cc.tenant').andOn('c.contract_id', 'cc.contract_id');
    })
    .select(
      'cc.client_contract_id',
      'cc.client_id',
      'cc.contract_id',
      'cc.start_date',
      'cc.end_date',
      'cc.is_active',
      'cc.created_at',
      'cc.updated_at',
      'cl.client_name',
      'c.contract_name',
    )
    .where('cc.tenant', tenant);
}

export const clientContractIndexer: EntityIndexer = {
  objectType: 'client_contract',
  sourceEvents: ['CLIENT_CONTRACT_CREATED', 'CLIENT_CONTRACT_UPDATED', 'CLIENT_CONTRACT_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseClientContractQuery(knex, tenant)
      .andWhere('cc.client_contract_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseClientContractQuery(knex, tenant)
      .orderBy('cc.client_contract_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('cc.client_contract_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
