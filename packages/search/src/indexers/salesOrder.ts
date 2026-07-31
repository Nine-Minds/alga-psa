import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface SalesOrderSearchRow {
  so_id: string;
  so_number: string;
  client_id: string | null;
  client_name: string | null;
  status: string;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: SalesOrderSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: SalesOrderSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'sales_order',
    objectId: row.so_id,
    title: row.so_number,
    subtitle: compactJoin([row.client_name, row.status]),
    body: compactJoin([row.so_number, row.client_name, row.status]),
    url: `/msp/inventory/sales-orders?soId=${row.so_id}`,
    metadata: { status: row.status, clientId: row.client_id },
    acl: {
      requiredPermission: 'sales_order:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const salesOrderIndexer: EntityIndexer = {
  objectType: 'sales_order',
  sourceEvents: [
    'INVENTORY_SALES_ORDER_CREATED',
    'INVENTORY_SALES_ORDER_UPDATED',
    'INVENTORY_SALES_ORDER_DELETED',
    'INVENTORY_SO_FULFILLED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<SalesOrderSearchRow>('sales_orders as so')
      .leftJoin('clients as c', function () {
        this.on('c.client_id', '=', 'so.client_id').andOn('c.tenant', '=', 'so.tenant');
      })
      .where({ 'so.tenant': tenant, 'so.so_id': id })
      .select('so.so_id', 'so.so_number', 'so.client_id', 'so.status', 'so.created_at', 'so.updated_at', 'c.client_name')
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<SalesOrderSearchRow>('sales_orders as so')
      .leftJoin('clients as c', function () {
        this.on('c.client_id', '=', 'so.client_id').andOn('c.tenant', '=', 'so.tenant');
      })
      .where({ 'so.tenant': tenant })
      .select('so.so_id', 'so.so_number', 'so.client_id', 'so.status', 'so.created_at', 'so.updated_at', 'c.client_name')
      .orderBy('so.so_id', 'asc')
      .limit(limit);

    if (cursor) query.andWhere('so.so_id', '>', cursor);

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
