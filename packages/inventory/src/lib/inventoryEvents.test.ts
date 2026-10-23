import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { publishEventMock } = vi.hoisted(() => ({
  publishEventMock: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishBuiltWorkflowPayload: publishEventMock,
  publishNonCatalogEventByName: vi.fn(),
  reviveStoredWorkflowPayload: (eventType: string, payload: Record<string, unknown>) => ({ eventType, payload }),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { publishInventoryEvent } from './inventoryEvents';
import { buildInventoryPoReceivedPayload, buildInventoryStockLowPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/inventoryEventBuilders';

describe('inventory event publisher', () => {
  beforeEach(() => {
    publishEventMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes inventory events through the shared event bus', async () => {
    publishEventMock.mockResolvedValueOnce(undefined);

    await publishInventoryEvent('INVENTORY_PO_RECEIVED', buildInventoryPoReceivedPayload({
      tenant: '00000000-0000-0000-0000-000000000001',
      poId: '00000000-0000-0000-0000-000000000002',
      poNumber: 'PO-1',
      vendorId: null,
      vendorName: null,
      receivedLineCount: 1,
    }));

    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'INVENTORY_PO_RECEIVED',
      payload: {
        tenant: '00000000-0000-0000-0000-000000000001',
        po_id: '00000000-0000-0000-0000-000000000002',
        po_number: 'PO-1',
        vendor_id: null,
        vendor_name: null,
        received_line_count: 1,
      },
    });
  });

  it('logs publish failures without throwing into the caller flow', async () => {
    const error = new Error('redis down');
    publishEventMock.mockRejectedValueOnce(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(publishInventoryEvent('INVENTORY_STOCK_LOW', buildInventoryStockLowPayload({
      tenant: '00000000-0000-0000-0000-000000000001',
      serviceId: '00000000-0000-0000-0000-000000000002',
      serviceName: 'Widget',
      sku: 'W-1',
      locationId: '00000000-0000-0000-0000-000000000003',
      locationName: 'Main',
      onHand: 3,
      reorderPoint: 3,
    }))).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('[InventoryEvents] Failed to publish INVENTORY_STOCK_LOW:', error);
  });
});
