import { describe, expect, it, vi } from 'vitest';

import InvoiceModel from '@alga-psa/billing/models/invoice';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getInvoiceCharges: vi.fn(),
  },
}));

describe('InvoiceService recurring detail projection', () => {
  it('T039: API invoice detail readers preserve canonical recurring periods without requiring billing-cycle metadata in the item payload', async () => {
    const service = new InvoiceService();
    const trx = {} as any;
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
    const projectedCharges = [
      {
        item_id: 'recurring-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        description: 'Managed Services Bundle',
        quantity: 1,
        rate: 10000,
        unit_price: 10000,
        total_price: 10000,
        tax_amount: 0,
        net_amount: 10000,
        is_manual: false,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: null,
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
          {
            service_period_start: '2025-02-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            billing_timing: 'advance',
          },
        ],
      },
    ];
    vi.mocked(InvoiceModel.getInvoiceCharges).mockResolvedValue(projectedCharges as any);

    const lineItems = await (service as any).getInvoiceLineItems('invoice-1', trx, context);

    expect(InvoiceModel.getInvoiceCharges).toHaveBeenCalledWith(trx, 'tenant-1', 'invoice-1');
    expect(lineItems).toEqual(projectedCharges);
  });
});
