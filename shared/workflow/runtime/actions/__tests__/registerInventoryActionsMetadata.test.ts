import { describe, expect, it } from 'vitest';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerInventoryActions } from '../businessOperations/inventory';
import { workflowEventPayloadSchemas } from '../../schemas/workflowEventPayloadSchemas';

describe('inventory workflow actions', () => {
  it('registers all inventory actions with Zod contracts and Designer metadata', () => {
    const registry = getActionRegistryV2();
    if (!registry.get('inventory.get_availability', 1)) registerInventoryActions();

    const ids = [
      'inventory.get_availability',
      'inventory.find_units',
      'inventory.adjust_stock',
      'inventory.create_purchase_order_draft',
    ];
    for (const id of ids) {
      const action = registry.get(id, 1);
      expect(action, id).toBeDefined();
      expect(action?.ui?.category).toBe('Business Operations');
      expect(action?.ui?.label).toBeTruthy();
      expect(action?.ui?.description).toBeTruthy();
    }

    const adjust = registry.get('inventory.adjust_stock', 1)!;
    expect(adjust.inputSchema.safeParse({
      service_id: '11111111-1111-4111-8111-111111111111',
      location_id: '22222222-2222-4222-8222-222222222222',
      quantity_delta: 0,
      reason: 'correction',
    }).success).toBe(false);
    expect(adjust.ui?.description).toContain('performed_by');
    expect(adjust.ui?.description).toContain('workflow publisher');

    const find = registry.get('inventory.find_units', 1)!;
    expect(find.inputSchema.safeParse({ limit: 51 }).success).toBe(false);

    const create = registry.get('inventory.create_purchase_order_draft', 1)!;
    expect(create.inputSchema.safeParse({
      vendor_id: '33333333-3333-4333-8333-333333333333',
      lines: [],
    }).success).toBe(false);
  });

  it('registers every inventory catalog schema in the runtime initialization map', () => {
    const refs = [
      'payload.InventorySalesOrderCreated.v1',
      'payload.InventorySalesOrderUpdated.v1',
      'payload.InventorySalesOrderDeleted.v1',
      'payload.InventoryPurchaseOrderCreated.v1',
      'payload.InventoryPurchaseOrderUpdated.v1',
      'payload.InventoryPurchaseOrderDeleted.v1',
      'payload.InventoryTransferDispatched.v1',
      'payload.InventoryTransferReceived.v1',
      'payload.InventoryCountSubmitted.v1',
      'payload.InventoryCountApproved.v1',
    ];
    for (const ref of refs) expect(workflowEventPayloadSchemas[ref], ref).toBeDefined();
  });
});
