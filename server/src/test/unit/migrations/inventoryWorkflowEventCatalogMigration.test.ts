import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20260716140000_seed_inventory_workflow_events.cjs');

function createFakeKnex() {
  const rows = new Map<string, {
    event_type: string;
    name: string;
    description: string;
    category: string;
    payload_schema_ref: string;
  }>();
  const knex = {
    schema: {
      hasTable: vi.fn(async () => true),
      hasColumn: vi.fn(async () => true),
    },
    raw: vi.fn(async (_sql: string, bindings: string[]) => {
      const [event_type, name, description, category, payload_schema_ref] = bindings;
      rows.set(event_type, { event_type, name, description, category, payload_schema_ref });
    }),
  } as any;
  return { knex, rows };
}

describe('inventory workflow event catalog migration', () => {
  it('upserts every lifecycle event with a payload ref and is idempotent', async () => {
    const { knex, rows } = createFakeKnex();

    await migration.up(knex);
    await migration.up(knex);

    expect(rows.size).toBe(10);
    expect(knex.raw).toHaveBeenCalledTimes(20);
    const expected = {
      INVENTORY_SALES_ORDER_CREATED: 'payload.InventorySalesOrderCreated.v1',
      INVENTORY_SALES_ORDER_UPDATED: 'payload.InventorySalesOrderUpdated.v1',
      INVENTORY_SALES_ORDER_DELETED: 'payload.InventorySalesOrderDeleted.v1',
      INVENTORY_PURCHASE_ORDER_CREATED: 'payload.InventoryPurchaseOrderCreated.v1',
      INVENTORY_PURCHASE_ORDER_UPDATED: 'payload.InventoryPurchaseOrderUpdated.v1',
      INVENTORY_PURCHASE_ORDER_DELETED: 'payload.InventoryPurchaseOrderDeleted.v1',
      INVENTORY_TRANSFER_DISPATCHED: 'payload.InventoryTransferDispatched.v1',
      INVENTORY_TRANSFER_RECEIVED: 'payload.InventoryTransferReceived.v1',
      INVENTORY_COUNT_SUBMITTED: 'payload.InventoryCountSubmitted.v1',
      INVENTORY_COUNT_APPROVED: 'payload.InventoryCountApproved.v1',
    };
    for (const [eventType, schemaRef] of Object.entries(expected)) {
      expect(rows.get(eventType)).toMatchObject({
        event_type: eventType,
        category: 'Inventory',
        payload_schema_ref: schemaRef,
      });
    }

    const sql = knex.raw.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT (event_type) DO UPDATE');
    expect(sql).toContain('payload_schema_ref = EXCLUDED.payload_schema_ref');
  });
});
