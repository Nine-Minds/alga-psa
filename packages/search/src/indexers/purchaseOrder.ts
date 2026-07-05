import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface PurchaseOrderSearchRow {
  po_id: string;
  po_number: string;
  vendor_id: string | null;
  vendor_name: string | null;
  status: string;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: PurchaseOrderSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: PurchaseOrderSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'purchase_order',
    objectId: row.po_id,
    title: row.po_number,
    subtitle: compactJoin([row.vendor_name, row.status]),
    body: compactJoin([row.po_number, row.vendor_name, row.status]),
    url: `/msp/inventory/purchase-orders?poId=${row.po_id}`,
    metadata: { status: row.status, vendorId: row.vendor_id },
    acl: {
      requiredPermission: 'purchase_order:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const purchaseOrderIndexer: EntityIndexer = {
  objectType: 'purchase_order',
  sourceEvents: [
    'INVENTORY_PURCHASE_ORDER_CREATED',
    'INVENTORY_PURCHASE_ORDER_UPDATED',
    'INVENTORY_PURCHASE_ORDER_DELETED',
    'INVENTORY_PO_RECEIVED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<PurchaseOrderSearchRow>('purchase_orders as po')
      .leftJoin('vendors as v', function () {
        this.on('v.vendor_id', '=', 'po.vendor_id').andOn('v.tenant', '=', 'po.tenant');
      })
      .where({ 'po.tenant': tenant, 'po.po_id': id })
      .select('po.po_id', 'po.po_number', 'po.vendor_id', 'po.status', 'po.created_at', 'po.updated_at', 'v.vendor_name')
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<PurchaseOrderSearchRow>('purchase_orders as po')
      .leftJoin('vendors as v', function () {
        this.on('v.vendor_id', '=', 'po.vendor_id').andOn('v.tenant', '=', 'po.tenant');
      })
      .where({ 'po.tenant': tenant })
      .select('po.po_id', 'po.po_number', 'po.vendor_id', 'po.status', 'po.created_at', 'po.updated_at', 'v.vendor_name')
      .orderBy('po.po_id', 'asc')
      .limit(limit);

    if (cursor) query.andWhere('po.po_id', '>', cursor);

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
