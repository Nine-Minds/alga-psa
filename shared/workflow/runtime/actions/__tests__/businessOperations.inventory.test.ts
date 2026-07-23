import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  permissions: [] as Array<{ resource: string; action: string }>,
  audits: [] as Array<Record<string, unknown>>,
}));

const inventoryMocks = vi.hoisted(() => ({
  queryStockLevelsForProduct: vi.fn(),
  adjustStockCore: vi.fn(),
  createPurchaseOrderDraftCore: vi.fn(),
  findStockUnits: vi.fn(),
  publishInventoryEvent: vi.fn(),
  timestampPayload: vi.fn((payload: Record<string, unknown>) => ({
    ...payload,
    timestamp: '2026-07-16T12:00:00.000Z',
  })),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => fn({
      tenantId: state.tenantId,
      actorUserId: state.actorUserId,
      trx: { transaction: true },
    }),
    requirePermission: async (_ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      state.permissions.push(permission);
    },
    writeRunAudit: async (_ctx: any, _tx: any, audit: Record<string, unknown>) => {
      state.audits.push(audit);
    },
  };
});

vi.mock('@alga-psa/inventory/lib', () => inventoryMocks);

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerInventoryActions } from '../businessOperations/inventory';

const ids = {
  service: '33333333-3333-4333-8333-333333333333',
  location: '44444444-4444-4444-8444-444444444444',
  movement: '55555555-5555-4555-8555-555555555555',
  vendor: '66666666-6666-4666-8666-666666666666',
  po: '77777777-7777-4777-8777-777777777777',
};

function actionContext() {
  return {
    runId: '88888888-8888-4888-8888-888888888888',
    stepPath: 'steps.inventory',
    idempotencyKey: 'test',
    attempt: 1,
    nowIso: () => '2026-07-16T12:00:00.000Z',
    env: {},
    tenantId: state.tenantId,
  } as any;
}

async function invoke(actionId: string, input: Record<string, unknown>) {
  const action = getActionRegistryV2().get(actionId, 1)!;
  return action.handler(action.inputSchema.parse(input), actionContext());
}

describe('inventory workflow action behavior', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('inventory.get_availability', 1)) registerInventoryActions();
  });

  beforeEach(() => {
    state.permissions.length = 0;
    state.audits.length = 0;
    for (const mock of Object.values(inventoryMocks)) {
      if ('mockClear' in mock) mock.mockClear();
    }
  });

  it('returns numeric per-location availability and effective reorder state', async () => {
    inventoryMocks.queryStockLevelsForProduct.mockResolvedValueOnce([{
      location_id: ids.location,
      location_name: 'Main Warehouse',
      quantity_on_hand: '9',
      reserved_quantity: '2',
      held_quantity: '1',
      available: 6,
      reorder_point: '6',
    }]);

    await expect(invoke('inventory.get_availability', { service_id: ids.service })).resolves.toEqual({
      locations: [{
        location_id: ids.location,
        location_name: 'Main Warehouse',
        quantity_on_hand: 9,
        reserved_quantity: 2,
        held_quantity: 1,
        available: 6,
        reorder_point: 6,
        below_reorder: true,
      }],
    });
    expect(state.permissions).toContainEqual({ resource: 'inventory', action: 'read' });
    expect(inventoryMocks.queryStockLevelsForProduct).toHaveBeenCalledWith(
      { transaction: true },
      state.tenantId,
      ids.service,
    );
  });

  it('adjusts through the core as the workflow publisher and publishes pending stock-low post-core', async () => {
    const pendingStockLow = {
      tenant: state.tenantId,
      service_id: ids.service,
      service_name: 'Router',
      sku: 'RTR-1',
      location_id: ids.location,
      location_name: 'Main Warehouse',
      on_hand: 3,
      reorder_point: 3,
    };
    inventoryMocks.adjustStockCore.mockResolvedValueOnce({
      movements: [{ movement_id: ids.movement }],
      pending_stock_low_event: pendingStockLow,
    });
    inventoryMocks.queryStockLevelsForProduct.mockResolvedValueOnce([{
      location_id: ids.location,
      quantity_on_hand: 3,
    }]);

    await expect(invoke('inventory.adjust_stock', {
      service_id: ids.service,
      location_id: ids.location,
      quantity_delta: -2,
      reason: 'Workflow reconciliation',
    })).resolves.toEqual({ movement_id: ids.movement, new_on_hand: 3 });

    expect(inventoryMocks.adjustStockCore).toHaveBeenCalledWith(
      { transaction: true },
      state.tenantId,
      state.actorUserId,
      {
        service_id: ids.service,
        location_id: ids.location,
        delta: -2,
        reason: 'Workflow reconciliation',
      },
    );
    expect(state.permissions).toContainEqual({ resource: 'inventory', action: 'update' });
    expect(state.audits[0]).toMatchObject({ operation: 'workflow_action:inventory.adjust_stock' });
    expect(inventoryMocks.publishInventoryEvent).toHaveBeenCalledWith(
      'INVENTORY_STOCK_LOW',
      expect.objectContaining(pendingStockLow),
    );
  });

  it('creates a numbered draft PO through the shared core', async () => {
    inventoryMocks.createPurchaseOrderDraftCore.mockResolvedValueOnce({
      purchase_order: { po_id: ids.po, po_number: 'PO-1042' },
      purchase_order_created_event: {
        tenant: state.tenantId,
        po_id: ids.po,
        user_id: state.actorUserId,
      },
    });

    await expect(invoke('inventory.create_purchase_order_draft', {
      vendor_id: ids.vendor,
      ship_to_location_id: ids.location,
      lines: [{ service_id: ids.service, quantity: 4, unit_cost: 1250 }],
    })).resolves.toEqual({ po_id: ids.po, po_number: 'PO-1042' });
    expect(inventoryMocks.createPurchaseOrderDraftCore).toHaveBeenCalledWith(
      { transaction: true },
      state.tenantId,
      state.actorUserId,
      {
        vendor_id: ids.vendor,
        ship_to_location_id: ids.location,
        lines: [{ service_id: ids.service, quantity_ordered: 4, unit_cost: 1250 }],
      },
    );
    expect(state.permissions).toContainEqual({ resource: 'purchase_order', action: 'create' });
    expect(inventoryMocks.publishInventoryEvent).toHaveBeenCalledWith(
      'INVENTORY_PURCHASE_ORDER_CREATED',
      expect.objectContaining({ po_id: ids.po }),
    );
  });
});
