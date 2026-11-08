import { describe, expect, it } from 'vitest';
import { mapDbInvoiceToWasmViewModel } from '../src/lib/adapters/invoiceAdapters';
import { applyContractChangeDescriptionSources } from '../src/lib/billing/contractChangeInvoiceProjection';

describe('source-linked true-up invoice projection', () => {
  it('enriches an existing read model without mutating financial or provenance fields', () => {
    const persisted = {
      item_id: 'settled-charge', description: 'Mid-period quantity change: Cabling',
      adjustment_source_kind: 'contract_change', adjustment_source_id: 'canonical-revision',
      adjustment_source_revision: 4, quantity: 1, unit_price: 12000, net_amount: 7355,
      total_price: 7355, manual_line_metadata: { adjustmentId: 'ledger-adjustment' },
    };
    const source = {
      item_id: 'settled-charge', service_name: 'Cabling', currency_code: 'USD',
      adjustment_period_start: '2026-10-01', mid_period_effective_date: '2026-10-13', adjustment_period_end: '2026-11-01',
      quantity_delta: 1, unit_rate_cents: '12000', covered_days: 19, full_period_days: 31, amount_cents: '7355',
    };
    const [projected] = applyContractChangeDescriptionSources([persisted], [source]);
    expect(projected.description).toBe(
      'Cabling: increase (+1 units); 2026-10-13 through 2026-11-01 (end date exclusive); full-period rate USD $120.00; prorated 19/31 days',
    );
    expect(persisted.description).toBe('Mid-period quantity change: Cabling');
    expect(projected).toMatchObject({
      adjustment_source_kind: 'contract_change', adjustment_source_id: 'canonical-revision',
      adjustment_source_revision: 4, quantity: 1, unit_price: 12000, net_amount: 7355,
    });

    const pdfAndPortalView = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-SOURCE', invoice_date: '2026-10-13', due_date: '2026-10-20', currency_code: 'USD',
      client: { name: 'Fixture Client', address: '' }, invoice_charges: [projected],
      subtotal: 7355, tax: 0, total: 7355,
    });
    expect(pdfAndPortalView?.items[0]).toMatchObject({
      description: projected.description, quantity: 1, unitPrice: 12000, total: 7355,
    });
  });

  it('leaves unrelated and incomplete legacy rows untouched', () => {
    const legacy = { item_id: 'legacy', description: 'Mid-period quantity change: Cabling' };
    expect(applyContractChangeDescriptionSources([legacy], [])).toEqual([legacy]);
    expect(applyContractChangeDescriptionSources([legacy], [{ item_id: 'legacy', currency_code: 'USD' }]))
      .toEqual([legacy]);
  });
});
