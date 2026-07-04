import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface InvoiceAnnotationSearchRow {
  annotation_id: string;
  invoice_id: string;
  content: string | null;
  is_internal: boolean | null;
  created_at?: Date | string | null;
  invoice_number: string;
  client_id: string | null;
}

function toSourceUpdatedAt(row: InvoiceAnnotationSearchRow): Date {
  return row.created_at ? new Date(row.created_at) : new Date();
}

function toSearchDoc(tenant: string, row: InvoiceAnnotationSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'invoice_annotation',
    objectId: row.annotation_id,
    parentType: 'invoice',
    parentId: row.invoice_id,
    title: row.invoice_number,
    body: row.content ?? undefined,
    url: `/msp/invoices/${row.invoice_id}#annotation-${row.annotation_id}`,
    acl: {
      requiredPermission: 'invoice:read',
      clientScopeId: row.client_id ?? undefined,
      isInternalOnly: row.is_internal ?? false,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseInvoiceAnnotationQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<InvoiceAnnotationSearchRow>(knex, 'invoice_annotations as ia', 'ia', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'invoices as i', 'i.invoice_id', 'ia.invoice_id');

  return query
    .select(
      'ia.annotation_id',
      'ia.invoice_id',
      'ia.content',
      'ia.is_internal',
      'ia.created_at',
      'i.invoice_number',
      'i.client_id',
    );
}

export const invoiceAnnotationIndexer: EntityIndexer = {
  objectType: 'invoice_annotation',
  sourceEvents: ['INVOICE_ANNOTATION_CREATED', 'INVOICE_ANNOTATION_UPDATED', 'INVOICE_ANNOTATION_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseInvoiceAnnotationQuery(knex, tenant)
      .andWhere('ia.annotation_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseInvoiceAnnotationQuery(knex, tenant)
      .orderBy('ia.annotation_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('ia.annotation_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
