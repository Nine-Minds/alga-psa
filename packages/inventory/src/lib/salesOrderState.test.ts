import { describe, expect, it } from 'vitest';
import type { PurchaseOrderStatus, SalesOrderStatus } from '@alga-psa/types';
import {
  assertFulfillableSo,
  assertProcurableSo,
  assertReceivablePo,
  FULFILLABLE_SO_STATUSES,
  PROCURABLE_SO_STATUSES,
} from './salesOrderState';

const ALL_SO: SalesOrderStatus[] = [
  'draft',
  'confirmed',
  'partially_fulfilled',
  'fulfilled',
  'invoiced',
  'closed',
  'cancelled',
];
const ALL_PO: PurchaseOrderStatus[] = ['draft', 'open', 'partially_received', 'received', 'cancelled'];

describe('sales order state guards', () => {
  describe('fulfillment', () => {
    it('allows invoiced orders to ship', () => {
      // Manual-mode orders bill the ordered quantity up front and flip to 'invoiced'
      // before anything leaves the shelf. Excluding it would strand every prepaid order.
      expect(FULFILLABLE_SO_STATUSES).toContain('invoiced');
      expect(() => assertFulfillableSo('invoiced')).not.toThrow();
    });

    it('rejects draft orders', () => {
      // Nothing is allocated yet and the header can still be hard-deleted, which would
      // cascade the lines away and leave the consume movements orphaned.
      expect(() => assertFulfillableSo('draft')).toThrow('Cannot fulfill a draft sales order');
    });

    it.each(['cancelled', 'closed', 'fulfilled'] as SalesOrderStatus[])('rejects %s orders', (status) => {
      expect(() => assertFulfillableSo(status)).toThrow(`Cannot fulfill a ${status} sales order`);
    });

    it('accepts exactly the confirmed/partially_fulfilled/invoiced set', () => {
      const allowed = ALL_SO.filter((s) => {
        try {
          assertFulfillableSo(s);
          return true;
        } catch {
          return false;
        }
      });
      expect(allowed.sort()).toEqual(['confirmed', 'invoiced', 'partially_fulfilled']);
    });
  });

  describe('procurement', () => {
    it('allows raising vendor demand before the order is confirmed', () => {
      expect(PROCURABLE_SO_STATUSES).toContain('draft');
      expect(() => assertProcurableSo('draft')).not.toThrow();
    });

    it.each(['cancelled', 'closed'] as SalesOrderStatus[])('rejects %s orders', (status) => {
      expect(() => assertProcurableSo(status)).toThrow(
        `Cannot create purchase orders for a ${status} sales order`,
      );
    });
  });

  describe('drop-ship receipt', () => {
    it('accepts only open and partially received purchase orders', () => {
      const allowed = ALL_PO.filter((s) => {
        try {
          assertReceivablePo(s);
          return true;
        } catch {
          return false;
        }
      });
      expect(allowed.sort()).toEqual(['open', 'partially_received']);
    });

    it('rejects a cancelled purchase order', () => {
      expect(() => assertReceivablePo('cancelled')).toThrow(
        'Cannot receive against a cancelled purchase order',
      );
    });
  });
});
