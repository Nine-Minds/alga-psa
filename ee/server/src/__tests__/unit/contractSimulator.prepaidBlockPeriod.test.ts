/**
 * buildSimulatedPeriod maps Prepaid Block supplemental charges to the
 * "Prepaid block issued" and "Block draw" presentation lines. DB-free.
 */

import { describe, expect, it } from 'vitest';
import { calculateContractBilling } from '@alga-psa/billing/lib/billing/domain';
import { buildSimulatedPeriod } from '@ee/lib/billing/simulator/loadSimulationCalculationInput';

const window = { index: 0, startDate: '2026-01-01', endDateExclusive: '2026-02-01' };

const charges: any[] = [
  {
    type: 'prepaid_block', tenant: 't', issuance_id: 'i', contract_line_id: 'L', client_contract_line_id: 'L',
    serviceId: 'svc', serviceName: 'Support - prepaid block (10 h, contract start)', block_minutes: 600,
    block_price: 150000, currency_code: 'EUR', expiry_months: 12, scope_service_ids: ['svc'],
    quantity: 10, rate: 15000, total: 150000, tax_amount: 0, tax_rate: 0, is_taxable: false,
    servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'advance',
  },
  {
    type: 'hour_block', tenant: 't', block_id: 'b', client_contract_line_id: 'L', serviceId: 'svc',
    serviceName: 'Support - block draw (block 1)', hoursUsed: 4, hoursRemaining: 6, coveredEntryIds: [],
    quantity: 4, rate: 0, total: 0, tax_amount: 0, tax_rate: 0,
    servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', billingTiming: 'arrears',
  },
];

describe('buildSimulatedPeriod prepaid block lines', () => {
  it('labels issuance and draw lines and keeps the draw at $0', () => {
    const accumulator: any = { window, obligations: [], taxContexts: {}, supplementalCharges: charges };
    const calculation = calculateContractBilling({
      schemaVersion: 1,
      execution: { mode: 'simulate', tenantId: 't', calculationId: 'x', asOf: '2026-01-01T00:00:00Z' },
      document: {
        clientId: 'c', currencyCode: 'EUR',
        invoiceWindow: { start: window.startDate, endExclusive: window.endDateExclusive },
      },
      obligations: [],
      taxContexts: {},
      supplementalCharges: charges,
    } as any);
    const period = buildSimulatedPeriod(
      accumulator,
      { scenario_id: 's', currency_code: 'EUR', adjustments: [], invoice_schedule: { billing_cycle: 'monthly' } } as any,
      null,
      { customer: {}, tenantClient: {} } as any,
      calculation,
    );
    const [issued, draw] = period.lines;
    expect(issued.charge_type).toBe('prepaid_block');
    expect(issued.service_name).toMatch(/^Prepaid block issued/);
    expect(issued.net_amount).toBe(150000);
    expect(draw.charge_type).toBe('block_draw');
    expect(draw.service_name).toMatch(/^Block draw/);
    expect(draw.net_amount).toBe(0);
    expect(draw.quantity_label).toBe('4 hrs');
  });
});
