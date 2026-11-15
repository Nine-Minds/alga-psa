/**
 * buildSimulatedPeriod maps the prepaidBlock and hourBlockDraw charge families
 * to the prepaid-block fee ("<service> — prepaid block, <h> h") and "Block draw" presentation lines. DB-free.
 */

import { describe, expect, it } from 'vitest';
import { calculateContractBilling } from '@alga-psa/billing/lib/billing/domain';
import { buildSimulatedPeriod } from '@ee/lib/billing/simulator/loadSimulationCalculationInput';

const window = { index: 0, startDate: '2026-01-01', endDateExclusive: '2026-02-01' };

const taxPolicy: any = {
  getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => null,
  isTaxExemptForProfile: () => false,
  calculateTax: () => ({ taxAmount: 0, taxRate: 0 }),
};

const line: any = {
  tenantId: 't', clientId: 'c', clientContractId: 'k', clientContractLineId: 'L',
  contractLineId: 'L', currencyCode: 'EUR',
};
const client = { clientId: 'c', isTaxExempt: false };

const obligations: any[] = [
  {
    obligationId: 'prepaidBlock:L:i', tenantId: 't', contractLineId: 'L',
    chargeFamily: 'prepaidBlock', taxContextKey: 'tax',
    facts: {
      kind: 'prepaidBlock', line, client, dueDate: '2026-01-01',
      issuance: {
        issuanceId: 'i', contractLineId: 'L', clientContractLineId: 'L', tenant: 't',
        blockMinutes: 600, blockPrice: 150000, expiryMonths: 12, scopeServiceIds: ['svc'],
        soldAsServiceId: 'svc', serviceName: 'Support',
        soldAsTaxRateId: null, currencyCode: 'EUR', taxDate: '2026-01-01',
        servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01',
      },
    },
  },
  {
    obligationId: 'hourBlockDraw:L:2026-01-01', tenantId: 't', contractLineId: 'L',
    chargeFamily: 'hourBlockDraw', taxContextKey: 'tax',
    facts: {
      kind: 'hourBlockDraw', line, client,
      period: { startDate: '2026-01-01', endDate: '2026-02-01' },
      allocations: [
        {
          block_id: 'b', service_id: 'svc', service_name: 'Support - block draw (block 1)',
          remaining_minutes: 360, time_entry_id: null, minutes: 240, billable_duration: 0,
        },
      ],
    },
  },
];

describe('buildSimulatedPeriod prepaid block lines', () => {
  it('labels issuance and draw lines and keeps the draw at $0', () => {
    const accumulator: any = { window, obligations, taxContexts: { tax: taxPolicy } };
    const calculation = calculateContractBilling({
      schemaVersion: 1,
      execution: { mode: 'simulate', tenantId: 't', calculationId: 'x', asOf: '2026-01-01T00:00:00Z' },
      document: {
        clientId: 'c', currencyCode: 'EUR',
        invoiceWindow: { start: window.startDate, endExclusive: window.endDateExclusive },
      },
      obligations,
      taxContexts: { tax: taxPolicy },
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
    // Same wording the engine persists (prepaidBlockDescriptions), so past-invoice comparison pairs the lines.
    expect(issued.service_name).toBe('Support — prepaid block, 10 h');
    expect(issued.net_amount).toBe(150000);
    expect(draw.charge_type).toBe('block_draw');
    expect(draw.service_name).toMatch(/^Block draw/);
    expect(draw.net_amount).toBe(0);
    expect(draw.quantity_label).toBe('4 hrs');
  });
});
