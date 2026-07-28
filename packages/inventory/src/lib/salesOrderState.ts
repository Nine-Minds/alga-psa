import type { PurchaseOrderStatus, SalesOrderStatus } from '@alga-psa/types';

/**
 * Statuses a sales order may move stock in.
 *
 * `invoiced` is deliberately included: manual-mode orders bill the ordered quantity up
 * front, so a prepaid order still has to ship. `draft` is excluded — nothing is allocated
 * yet and the header can still be edited or hard-deleted, which would strand the consume
 * movements the fulfillment wrote.
 */
export const FULFILLABLE_SO_STATUSES: readonly SalesOrderStatus[] = [
  'confirmed',
  'partially_fulfilled',
  'invoiced',
];

/** Statuses a sales order may still have procurement raised against it. */
export const PROCURABLE_SO_STATUSES: readonly SalesOrderStatus[] = [
  'draft',
  'confirmed',
  'partially_fulfilled',
];

/** Statuses a drop-ship PO may still receive against. */
export const RECEIVABLE_PO_STATUSES: readonly PurchaseOrderStatus[] = ['open', 'partially_received'];

export function assertFulfillableSo(status: SalesOrderStatus): void {
  if (!FULFILLABLE_SO_STATUSES.includes(status)) {
    throw new Error(`Cannot fulfill a ${status} sales order`);
  }
}

export function assertProcurableSo(status: SalesOrderStatus): void {
  if (!PROCURABLE_SO_STATUSES.includes(status)) {
    throw new Error(`Cannot create purchase orders for a ${status} sales order`);
  }
}

export function assertReceivablePo(status: PurchaseOrderStatus): void {
  if (!RECEIVABLE_PO_STATUSES.includes(status)) {
    throw new Error(`Cannot receive against a ${status} purchase order`);
  }
}
