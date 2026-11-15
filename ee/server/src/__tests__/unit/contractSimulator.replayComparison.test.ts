/**
 * "Compare with past invoices" pairs issued and simulated lines on one identity
 * (origin contract line + charge type + service), not on resolver keys or
 * description text. DB-free: the issued side goes through the same row mapper
 * the loader uses, the simulated side through buildSimulatedPeriod.
 */

import { describe, expect, it } from 'vitest';
import { calculateContractBilling } from '@alga-psa/billing/lib/billing/domain';
import type { SimulatedInvoiceLine } from '@alga-psa/types';
import { buildReplayInvoiceLine } from '@ee/lib/billing/simulator/activityAssumptions';
import { buildSimulatedPeriod } from '@ee/lib/billing/simulator/loadSimulationCalculationInput';
import {
  pairReplayLines,
  replayLineIdentity,
} from '@ee/lib/billing/simulator/replayLineIdentity';

const window = { index: 1, startDate: '2026-10-01', endDateExclusive: '2026-11-01' };
const taxPolicy: any = {
  getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => null,
  isTaxExemptForProfile: () => false,
  calculateTax: () => ({ taxAmount: 0, taxRate: 0 }),
};
const line: any = {
  tenantId: 't', clientId: 'c', clientContractId: 'k', clientContractLineId: 'block-key',
  contractLineId: 'block-key', currencyCode: 'USD',
};
const client = { clientId: 'c', isTaxExempt: false };

// Scenario line keys are not saved-line ids; origin_contract_line_id is.
const scenario: any = {
  scenario_id: 's',
  currency_code: 'USD',
  adjustments: [],
  invoice_schedule: { billing_cycle: 'monthly' },
  lines: [
    {
      key: 'block-key',
      origin_contract_line_id: 'origin-block',
      prepaid_block: { issue_mode: 'cadence' },
      services: [{ service_id: 'svc-support' }],
    },
    {
      key: 'fixed-key',
      origin_contract_line_id: 'origin-fixed',
      services: [{ service_id: 'svc-fixed' }],
    },
  ],
};

const obligations: any[] = [
  {
    obligationId: 'prepaidBlock:block-key:i', tenantId: 't', contractLineId: 'block-key',
    chargeFamily: 'prepaidBlock', taxContextKey: 'tax',
    facts: {
      kind: 'prepaidBlock', line, client, dueDate: '2026-10-01',
      issuance: {
        issuanceId: 'i', contractLineId: 'block-key', clientContractLineId: 'block-key', tenant: 't',
        blockMinutes: 600, blockPrice: 150000, expiryMonths: null, scopeServiceIds: ['svc-support'],
        soldAsServiceId: 'svc-support', serviceName: 'Premium Support',
        soldAsTaxRateId: null, currencyCode: 'USD', taxDate: '2026-10-01',
        servicePeriodStart: '2026-10-01', servicePeriodEnd: '2026-11-01',
      },
    },
  },
  {
    obligationId: 'hourBlockDraw:block-key:2026-10-01', tenantId: 't', contractLineId: 'block-key',
    chargeFamily: 'hourBlockDraw', taxContextKey: 'tax',
    facts: {
      kind: 'hourBlockDraw', line, client,
      period: { startDate: '2026-10-01', endDate: '2026-11-01' },
      allocations: [
        {
          block_id: 'b', service_id: 'svc-support', service_name: 'Premium Support - block draw',
          remaining_minutes: 0, time_entry_id: null, minutes: 600, billable_duration: 0,
        },
      ],
    },
  },
];

function simulatedOctoberLines(): SimulatedInvoiceLine[] {
  const calculation = calculateContractBilling({
    schemaVersion: 1,
    execution: { mode: 'simulate', tenantId: 't', calculationId: 'x', asOf: '2026-10-01T00:00:00Z' },
    document: {
      clientId: 'c', currencyCode: 'USD',
      invoiceWindow: { start: window.startDate, endExclusive: window.endDateExclusive },
    },
    obligations,
    taxContexts: { tax: taxPolicy },
  } as any);
  const period = buildSimulatedPeriod(
    { window, obligations, taxContexts: { tax: taxPolicy } } as any,
    scenario,
    null,
    { customer: {}, tenantClient: {} } as any,
    calculation,
  );
  const [blockFee, draw] = period.lines;
  // The fixed fee and the overage come from other resolver families; they map
  // origin the same way (scenario line key -> origin_contract_line_id).
  const fixed: SimulatedInvoiceLine = {
    line_key: 'fixed:fixed-key:svc-fixed', origin_contract_line_id: 'origin-fixed',
    service_id: 'svc-fixed', service_name: 'Service desk fee', charge_type: 'fixed',
    quantity_label: '1', rate_label: '$1,500.00', net_amount: 150000, tax_amount: 0, total: 150000,
    explanation: null,
  };
  const overage: SimulatedInvoiceLine = {
    line_key: 'hourly:block-key:svc-support', origin_contract_line_id: 'origin-block',
    service_id: 'svc-support', service_name: 'Support hours', charge_type: 'time',
    quantity_label: '4 hrs', rate_label: '$150.00', net_amount: 60000, tax_amount: 0, total: 60000,
    explanation: null,
  };
  return [fixed, blockFee, overage, draw];
}

function issuedOctoberLines(): SimulatedInvoiceLine[] {
  const common = { quantity: 1, tax_amount: 0, item_kind: 'service', is_license: false };
  return [
    // Fixed fee: no service_id on the invoice line, config row names the line.
    buildReplayInvoiceLine({
      charge: { ...common, item_id: 'i1', service_id: null, description: 'Fixed Fee', net_amount: 150000, billing_charge_type: 'fixed' },
      detail: { contract_line_id: 'origin-fixed', configuration_type: 'Fixed' },
      blockLineId: null, scenario,
    }),
    // Block fee: detail.config_id is the contract_line_id itself, so no service configuration matches.
    buildReplayInvoiceLine({
      charge: { ...common, item_id: 'i2', service_id: 'svc-support', description: 'Premium Support — prepaid block, 10 h', net_amount: 150000, billing_charge_type: 'prepaid_block' },
      detail: {}, blockLineId: 'origin-block', scenario,
    }),
    buildReplayInvoiceLine({
      charge: { ...common, item_id: 'i3', service_id: 'svc-support', description: 'Premium Support (over prepaid block)', net_amount: 60000, billing_charge_type: 'time' },
      detail: { contract_line_id: 'origin-block', configuration_type: 'Hourly' },
      blockLineId: null, scenario,
    }),
    // $0 consumption line: persisted with no detail row at all.
    buildReplayInvoiceLine({
      charge: { ...common, item_id: 'i4', service_id: 'svc-support', description: 'Prepaid hour block (Premium Support) — 10.0 hrs consumed, 0.0 hrs remaining', net_amount: 0, billing_charge_type: 'hour_block' },
      detail: undefined, blockLineId: null, scenario,
    }),
  ];
}

describe('replay line identity', () => {
  it('maps issued block lines to the block stream types keyed by the block line', () => {
    const [fixed, fee, overage, draw] = issuedOctoberLines();
    expect([fixed.charge_type, fee.charge_type, overage.charge_type, draw.charge_type]).toEqual([
      'fixed', 'prepaid_block', 'time', 'block_draw',
    ]);
    expect([fee, overage, draw].map((l) => l.origin_contract_line_id)).toEqual([
      'origin-block', 'origin-block', 'origin-block',
    ]);
  });

  it('pairs the $3,600 October invoice with zero per-line deltas', () => {
    const issued = issuedOctoberLines();
    const simulated = simulatedOctoberLines();
    expect(issued.reduce((s, l) => s + l.total, 0)).toBe(360000);
    expect(simulated.reduce((s, l) => s + l.total, 0)).toBe(360000);
    const pairs = pairReplayLines(issued, simulated);
    expect(pairs).toHaveLength(4);
    for (const pair of pairs) {
      expect(pair.actual).toBeGreaterThanOrEqual(0);
      expect(pair.delta).toBe(0);
    }
    // Overage pairs as one row, not as an issued-only plus a simulated-only line.
    expect(pairs.find((p) => p.simulated === 60000)?.actual).toBe(60000);
  });

  it('pairs the $3,000 September invoice (fixed fee + block fee) with zero deltas', () => {
    const issued = issuedOctoberLines().slice(0, 2);
    const simulated = simulatedOctoberLines().slice(0, 2);
    const pairs = pairReplayLines(issued, simulated);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.delta === 0 && p.actual === p.simulated)).toBe(true);
  });

  it('does not pair a fee and an overage of the same block line and service', () => {
    const [, fee, overage] = issuedOctoberLines();
    expect(replayLineIdentity(fee)).not.toBe(replayLineIdentity(overage));
  });

  it('never uses description text', () => {
    const [, fee] = issuedOctoberLines();
    expect(replayLineIdentity({ ...fee, service_name: 'renamed' } as any)).toBe(replayLineIdentity(fee));
  });
});
