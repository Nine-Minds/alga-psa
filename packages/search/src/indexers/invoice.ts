import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface InvoiceSearchRow {
  invoice_id: string;
  invoice_number: string;
  client_id: string | null;
  client_name: string | null;
  total_amount: number | string | null;
  status: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: InvoiceSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: InvoiceSearchRow): SearchDoc {
  const total = row.total_amount == null ? undefined : String(row.total_amount);

  return {
    tenant,
    objectType: 'invoice',
    objectId: row.invoice_id,
    title: row.invoice_number,
    subtitle: compactJoin([row.client_name, row.status, total]),
    url: `/msp/invoices/${row.invoice_id}`,
    metadata: { identifier: row.invoice_number },
    acl: {
      requiredPermission: 'invoice:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseInvoiceQuery(knex: Knex, tenant: string) {
  return createTenantScopedIndexerQuery<InvoiceSearchRow>(knex, 'invoices as i', 'i', tenant)
    .leftJoin('clients as c', function() {
      this.on('c.tenant', 'i.tenant').andOn('c.client_id', 'i.client_id');
    })
    .select(
      'i.invoice_id',
      'i.invoice_number',
      'i.client_id',
      'i.total_amount',
      'i.status',
      'i.created_at',
      'i.updated_at',
      'c.client_name',
    );
}

export const invoiceIndexer: EntityIndexer = {
  objectType: 'invoice',
  sourceEvents: [
    'INVOICE_CREATED',
    'INVOICE_UPDATED',
    'INVOICE_DELETED',
    'INVOICE_GENERATED',
    'INVOICE_FINALIZED',
    'INVOICE_SENT',
    'INVOICE_STATUS_CHANGED',
    'INVOICE_DUE_DATE_CHANGED',
    'INVOICE_OVERDUE',
    'INVOICE_WRITTEN_OFF',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseInvoiceQuery(knex, tenant)
      .andWhere('i.invoice_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseInvoiceQuery(knex, tenant)
      .orderBy('i.invoice_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('i.invoice_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
