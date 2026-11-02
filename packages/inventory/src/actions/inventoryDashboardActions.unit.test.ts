import { describe, expect, it } from 'vitest';
import { overdueVendorReturnAttention } from '../lib/overdueVendorReturnAttention';

describe('overdue vendor return attention', () => {
  it('links the RMA and carries its vendor deadline and overdue age as fulfillment attention', () => {
    const [item] = overdueVendorReturnAttention([{
      rma_id: '55058b3a-cbff-4b8d-9f12-f1b9ebb17c35',
      rma_number: 'RMA-SMOKE2683-OVERDUE',
      rma_reference: 'DELL-2683',
      asset_id: '8cde1da4-4f42-4eb6-8b1e-ed537111d322',
      client_id: '57ca1d77-e4b7-48c4-852c-2f44fd86c001',
      return_by: '2026-10-31',
      overdue_days: 2,
    }]);

    expect(item).toMatchObject({
      id: 'rma-vendor-return-55058b3a-cbff-4b8d-9f12-f1b9ebb17c35',
      kind: 'rma_vendor_return',
      band: 'red',
      category: 'fulfillment',
      name: 'RMA-SMOKE2683-OVERDUE',
      href: '/msp/inventory/rma?rmaId=55058b3a-cbff-4b8d-9f12-f1b9ebb17c35',
      params: { rma_reference: 'DELL-2683', return_by: '2026-10-31', overdue_days: 2 },
      action: { key: 'view', href: '/msp/inventory/rma?rmaId=55058b3a-cbff-4b8d-9f12-f1b9ebb17c35' },
    });
  });
});
