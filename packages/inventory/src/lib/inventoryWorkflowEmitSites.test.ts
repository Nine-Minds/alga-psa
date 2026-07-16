import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function actionSource(fileName: string): Promise<string> {
  return readFile(path.join(srcRoot, 'actions', fileName), 'utf8');
}

describe('inventory workflow event emit sites', () => {
  it('publishes transfer dispatch/receive and count submit/approve after transactional outcomes', async () => {
    const [transfers, counts] = await Promise.all([
      actionSource('transferActions.ts'),
      actionSource('cycleCountActions.ts'),
    ]);

    expect(transfers).toContain("publishInventoryEvent('INVENTORY_TRANSFER_DISPATCHED'");
    expect(transfers).toContain("publishInventoryEvent('INVENTORY_TRANSFER_RECEIVED'");
    expect(transfers.indexOf("const result = await withTransaction")).toBeLessThan(
      transfers.indexOf("publishInventoryEvent('INVENTORY_TRANSFER_DISPATCHED'"),
    );

    expect(counts).toContain("publishInventoryEvent('INVENTORY_COUNT_SUBMITTED'");
    expect(counts).toContain("publishInventoryEvent('INVENTORY_COUNT_APPROVED'");
    expect(counts).toContain('if (adjustment.pending_stock_low_event)');
    expect(counts).toContain('pendingStockLowEvents.push(adjustment.pending_stock_low_event)');
    expect(counts).toContain("publishInventoryEvent('INVENTORY_STOCK_LOW'");
    expect(counts.indexOf('const outcome = await withTransaction')).toBeLessThan(
      counts.indexOf("publishInventoryEvent('INVENTORY_COUNT_SUBMITTED'"),
    );
  });

  it('publishes SO/PO deletion only from explicit delete actions', async () => {
    const [salesOrders, purchaseOrders] = await Promise.all([
      actionSource('salesOrderActions.ts'),
      actionSource('purchaseOrderActions.ts'),
    ]);
    expect(salesOrders).toContain('export const deleteSalesOrder');
    expect(salesOrders).toContain("publishInventoryEvent('INVENTORY_SALES_ORDER_DELETED'");
    expect(purchaseOrders).toContain('export const deletePurchaseOrder');
    expect(purchaseOrders).toContain("publishInventoryEvent('INVENTORY_PURCHASE_ORDER_DELETED'");
  });

  it('keeps the four new event names in the inventory publisher type union', async () => {
    const events = await readFile(path.join(srcRoot, 'lib', 'inventoryEvents.ts'), 'utf8');
    for (const eventType of [
      'INVENTORY_TRANSFER_DISPATCHED',
      'INVENTORY_TRANSFER_RECEIVED',
      'INVENTORY_COUNT_SUBMITTED',
      'INVENTORY_COUNT_APPROVED',
    ]) {
      expect(events).toContain(`| '${eventType}'`);
    }
  });
});
