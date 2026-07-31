import { describe, expect, it } from 'vitest';
import {
  inventoryAdjustmentSchema,
  inventoryLookupResultSchema,
  inventoryPurchaseOrderListQuerySchema,
  inventoryReceiptSchema,
} from '../../../lib/api/schemas/inventorySchemas';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

const product = {
  service_id: SERVICE_ID,
  service_name: 'Managed Switch',
  sku: 'SW-24',
  barcode: '0036000291452',
  is_serialized: true,
  unit_of_measure: 'each',
};

const unit = {
  unit_id: UNIT_ID,
  service_id: SERVICE_ID,
  service_name: 'Managed Switch',
  serial_number: 'SN-100',
  mac_address: 'AA:BB:CC:DD:EE:FF',
  status: 'in_stock' as const,
  location_id: LOCATION_ID,
  location_name: 'Main Warehouse',
  client_id: null,
  client_name: null,
  warranty_expires_at: '2028-07-16T00:00:00.000Z',
  warranty_term: '2 years',
};

describe('inventory API schemas', () => {
  it('T022: parses product and unit lookup payloads with levels and warranty data', () => {
    expect(inventoryLookupResultSchema.parse({
      type: 'product',
      product,
      levels: [{
        service_id: SERVICE_ID,
        service_name: 'Managed Switch',
        sku: 'SW-24',
        location_id: LOCATION_ID,
        location_name: 'Main Warehouse',
        quantity_on_hand: 4,
        reserved_quantity: 1,
        held_quantity: 0,
        available: 3,
        reorder_point: 2,
        is_low_stock: false,
      }],
    }).type).toBe('product');

    const parsed = inventoryLookupResultSchema.parse({ type: 'unit', unit, product });
    expect(parsed.type).toBe('unit');
    if (parsed.type === 'unit') {
      expect(parsed.unit.warranty_term).toBe('2 years');
      expect(parsed.unit.client_id).toBeNull();
    }
  });

  it('T020/T021: parses multi and none lookup union variants', () => {
    expect(inventoryLookupResultSchema.parse({
      type: 'multi',
      matches: [
        { kind: 'product', product },
        { kind: 'unit', unit },
      ],
    }).type).toBe('multi');
    expect(inventoryLookupResultSchema.parse({
      type: 'none',
      candidates: [{ kind: 'product', product }],
    }).type).toBe('none');
  });

  it('T025/T026: validates receipt and adjustment input invariants known at request time', () => {
    expect(inventoryReceiptSchema.parse({
      service_id: SERVICE_ID,
      location_id: LOCATION_ID,
      quantity: 1,
      serials: [{ serial_number: 'SN-100' }],
    }).quantity).toBe(1);
    expect(inventoryAdjustmentSchema.safeParse({
      service_id: SERVICE_ID,
      location_id: LOCATION_ID,
      quantity_delta: 1,
    }).success).toBe(false);
    expect(inventoryAdjustmentSchema.safeParse({
      service_id: SERVICE_ID,
      location_id: LOCATION_ID,
      quantity_delta: 0,
      reason: 'Found during audit',
    }).success).toBe(false);
  });

  it('T028: parses comma-separated purchase-order statuses', () => {
    expect(inventoryPurchaseOrderListQuerySchema.parse({
      status: 'open,partially_received',
    }).status).toEqual(['open', 'partially_received']);
  });
});
