import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { publishEventMock } = vi.hoisted(() => ({
  publishEventMock: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
}));

import { publishInventoryEvent } from './inventoryEvents';

describe('inventory event publisher', () => {
  beforeEach(() => {
    publishEventMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes inventory events through the shared event bus', async () => {
    publishEventMock.mockResolvedValueOnce(undefined);

    await publishInventoryEvent('INVENTORY_PO_RECEIVED', {
      tenant: '00000000-0000-0000-0000-000000000001',
      po_id: '00000000-0000-0000-0000-000000000002',
      po_number: 'PO-1',
      vendor_id: null,
      vendor_name: null,
      received_line_count: 1,
    });

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

    await expect(publishInventoryEvent('INVENTORY_STOCK_LOW', {
      tenant: '00000000-0000-0000-0000-000000000001',
      service_id: '00000000-0000-0000-0000-000000000002',
      service_name: 'Widget',
      sku: 'W-1',
      location_id: '00000000-0000-0000-0000-000000000003',
      location_name: 'Main',
      on_hand: 3,
      reorder_point: 3,
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('[InventoryEvents] Failed to publish INVENTORY_STOCK_LOW:', error);
  });
});
