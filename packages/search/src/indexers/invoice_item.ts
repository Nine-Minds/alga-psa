import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface InvoiceItemSearchRow {
  item_id: string;
  invoice_id: string;
  description: string | null;
  invoice_number: string;
  client_id: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: InvoiceItemSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: InvoiceItemSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'invoice_item',
    objectId: row.item_id,
    parentType: 'invoice',
    parentId: row.invoice_id,
    title: row.invoice_number,
    body: row.description ?? undefined,
    url: `/msp/invoices/${row.invoice_id}#item-${row.item_id}`,
    acl: {
      requiredPermission: 'invoice:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseInvoiceItemQuery(knex: Knex, tenant: string) {
  return createTenantScopedIndexerQuery<InvoiceItemSearchRow>(knex, 'invoice_items as ii', 'ii', tenant)
    .join('invoices as i', function() {
      this.on('i.tenant', 'ii.tenant').andOn('i.invoice_id', 'ii.invoice_id');
    })
    .select(
      'ii.item_id',
      'ii.invoice_id',
      'ii.description',
      'ii.created_at',
      'ii.updated_at',
      'i.invoice_number',
      'i.client_id',
    );
}

export const invoiceItemIndexer: EntityIndexer = {
  objectType: 'invoice_item',
  sourceEvents: ['INVOICE_ITEM_CREATED', 'INVOICE_ITEM_UPDATED', 'INVOICE_ITEM_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseInvoiceItemQuery(knex, tenant)
      .andWhere('ii.item_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseInvoiceItemQuery(knex, tenant)
      .orderBy('ii.item_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('ii.item_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
