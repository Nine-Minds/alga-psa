import { describe, expect, it } from 'vitest';
import { EventPayloadSchemas } from '../eventBusSchema';
import { workflowEventPayloadSchemas } from './workflowEventPayloadSchemas';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const timestamp = '2026-07-16T12:00:00.000Z';

const registrations = [
  ['INVENTORY_SALES_ORDER_CREATED', 'payload.InventorySalesOrderCreated.v1'],
  ['INVENTORY_SALES_ORDER_UPDATED', 'payload.InventorySalesOrderUpdated.v1'],
  ['INVENTORY_SALES_ORDER_DELETED', 'payload.InventorySalesOrderDeleted.v1'],
  ['INVENTORY_PURCHASE_ORDER_CREATED', 'payload.InventoryPurchaseOrderCreated.v1'],
  ['INVENTORY_PURCHASE_ORDER_UPDATED', 'payload.InventoryPurchaseOrderUpdated.v1'],
  ['INVENTORY_PURCHASE_ORDER_DELETED', 'payload.InventoryPurchaseOrderDeleted.v1'],
  ['INVENTORY_TRANSFER_DISPATCHED', 'payload.InventoryTransferDispatched.v1'],
  ['INVENTORY_TRANSFER_RECEIVED', 'payload.InventoryTransferReceived.v1'],
  ['INVENTORY_COUNT_SUBMITTED', 'payload.InventoryCountSubmitted.v1'],
  ['INVENTORY_COUNT_APPROVED', 'payload.InventoryCountApproved.v1'],
] as const;

describe('inventory workflow event schemas', () => {
  it('resolves every catalog payload_schema_ref and event-bus payload schema', () => {
    for (const [eventType, payloadRef] of registrations) {
      expect(EventPayloadSchemas[eventType]).toBeDefined();
      expect(workflowEventPayloadSchemas[payloadRef]).toBeDefined();
    }
  });

  it('accepts transfer and count facts published by inventory actions', () => {
    expect(workflowEventPayloadSchemas['payload.InventoryTransferDispatched.v1'].safeParse({
      tenant: id(1),
      transfer_id: id(2),
      from_location_id: id(3),
      to_location_id: id(4),
      line_count: 2,
      user_id: id(5),
      timestamp,
    }).success).toBe(true);

    expect(workflowEventPayloadSchemas['payload.InventoryCountApproved.v1'].safeParse({
      tenant: id(1),
      session_id: id(6),
      location_id: id(3),
      line_count: 8,
      counted_line_count: 7,
      variance_line_count: 2,
      variance_quantity: -3,
      adjustment_line_count: 2,
      stale_line_count: 1,
      uncounted_line_count: 1,
      user_id: id(5),
      timestamp,
    }).success).toBe(true);
  });
});
