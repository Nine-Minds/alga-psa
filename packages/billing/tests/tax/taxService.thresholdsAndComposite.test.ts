/**
 * Unit tests for TaxService threshold-bracket and composite (multi-component)
 * tax calculation paths (packages/billing/src/services/taxService.ts).
 *
 * These paths run when the client's default tax rate has thresholds or is a
 * composite rate: bracket-by-bracket application, compound component stacking,
 * component date applicability, and tax holidays.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tenant: 'tenant-1' as string | null,
  knex: undefined as any,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: h.tenant })),
  tenantDb: vi.fn((knex: any) => ({
    table: (table: string) => knex(table),
    unscoped: (table: string) => knex(table),
  })),
}));

vi.mock('../../src/models/clientTaxSettings', () => ({
  default: {
    get: vi.fn(),
    getCompositeTaxComponents: vi.fn(),
    getTaxRateThresholds: vi.fn(),
    getTaxHolidays: vi.fn(),
  },
}));

import { TaxService } from '../../src/services/taxService';
import ClientTaxSettings from '../../src/models/clientTaxSettings';

const DATE = '2025-03-15T00:00:00.000Z';

function createFakeKnex(results: Record<string, any[]>) {
  const queues: Record<string, any[]> = {};
  for (const [table, value] of Object.entries(results)) {
    queues[table] = [...value];
  }
  const knex: any = (table: string) => {
    const queue = queues[table] ?? [];
    const result = queue.length > 0 ? queue.shift() : [];
    const builder: any = {};
    for (const method of ['where', 'andWhere', 'orWhere', 'whereIn', 'whereNull', 'whereNotNull', 'select', 'orderBy']) {
      builder[method] = (...args: any[]) => {
        for (const arg of args) {
          if (typeof arg === 'function') arg.call(builder, builder);
        }
        return builder;
      };
    }
    builder.first = () => Promise.resolve(Array.isArray(result) ? result[0] : result);
    builder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(Array.isArray(result) ? result : [result]).then(onFulfilled, onRejected);
    return builder;
  };
  knex.raw = (sql: string) => sql;
  return knex;
}

/** Wires up the default-rate lookup so calculateTax reaches simple/composite calculation. */
function setupDefaultRate(rate: Record<string, unknown>) {
  h.knex = createFakeKnex({
    clients: [[{ is_tax_exempt: false }]],
    client_tax_rates: [[{ tax_rate_id: rate.tax_rate_id }]],
    tax_rates: [[rate]],
  });
}

describe('TaxService threshold-based tax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant = 'tenant-1';
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: false,
    } as any);
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([]);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([]);
  });

  it('applies progressive brackets: each bracket taxed at its own rate', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-1', tax_percentage: 0, is_composite: false });
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
      { tax_rate_threshold_id: 't1', tax_rate_id: 'rate-1', min_amount: 0, max_amount: 100000, rate: 5 },
      { tax_rate_threshold_id: 't2', tax_rate_id: 'rate-1', min_amount: 100000, max_amount: null, rate: 10 },
    ] as any);

    // 150000 cents: 100000 @ 5% = 5000, remaining 50000 @ 10% = 5000
    const result = await new TaxService().calculateTax('client-1', 150000, DATE);

    expect(result.taxAmount).toBe(10000);
    expect(result.taxRate).toBeCloseTo((10000 / 150000) * 100, 10);
    expect((result as any).appliedThresholds).toHaveLength(2);
  });

  it('only applies the brackets the amount actually reaches', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-1', tax_percentage: 0, is_composite: false });
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
      { tax_rate_threshold_id: 't1', tax_rate_id: 'rate-1', min_amount: 0, max_amount: 100000, rate: 5 },
      { tax_rate_threshold_id: 't2', tax_rate_id: 'rate-1', min_amount: 100000, max_amount: null, rate: 10 },
    ] as any);

    const result = await new TaxService().calculateTax('client-1', 50000, DATE);

    expect(result.taxAmount).toBe(2500);
    expect((result as any).appliedThresholds).toHaveLength(1);
  });

  it('ceils fractional cents within each bracket', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-1', tax_percentage: 0, is_composite: false });
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
      { tax_rate_threshold_id: 't1', tax_rate_id: 'rate-1', min_amount: 0, max_amount: null, rate: 7.5 },
    ] as any);

    // 333 * 7.5% = 24.975 -> 25
    const result = await new TaxService().calculateTax('client-1', 333, DATE);

    expect(result.taxAmount).toBe(25);
  });

  // NOTE (suspected product gap, intentionally NOT asserted):
  // taxService.ts:293 (`calculateThresholdBasedTax`) and taxService.ts:235
  // (`calculateCompositeTax`) compute `effectiveTaxRate = (taxAmount / netAmount) * 100`
  // without a zero guard, so a netAmount of 0 yields a NaN taxRate on these
  // paths (the simple-rate path at :253 does guard netAmount <= 0).
});

describe('TaxService composite tax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant = 'tenant-1';
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: false,
    } as any);
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([]);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([]);
  });

  it('stacks compound components on the increased taxable base', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-c', tax_percentage: 7, is_composite: true });
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'rate-c', name: 'GST', rate: 5, sequence: 1, is_compound: true },
      { tax_component_id: 'c2', tax_rate_id: 'rate-c', name: 'PST', rate: 2, sequence: 2, is_compound: false },
    ] as any);

    // c1: 10000 * 5% = 500 (compound -> base becomes 10500)
    // c2: 10500 * 2% = 210
    const result = await new TaxService().calculateTax('client-1', 10000, DATE);

    expect(result.taxAmount).toBe(710);
    expect(result.taxRate).toBeCloseTo(7.1, 10);
    expect(result.taxComponents).toHaveLength(2);
  });

  it('does not compound when components are independent', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-c', tax_percentage: 7, is_composite: true });
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'rate-c', name: 'GST', rate: 5, sequence: 1, is_compound: false },
      { tax_component_id: 'c2', tax_rate_id: 'rate-c', name: 'PST', rate: 2, sequence: 2, is_compound: false },
    ] as any);

    const result = await new TaxService().calculateTax('client-1', 10000, DATE);

    expect(result.taxAmount).toBe(700);
  });

  it('skips components that are not yet (or no longer) effective on the calculation date', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-c', tax_percentage: 5, is_composite: true });
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      {
        tax_component_id: 'future',
        tax_rate_id: 'rate-c',
        name: 'Future levy',
        rate: 3,
        sequence: 1,
        is_compound: false,
        start_date: '2026-01-01T00:00:00.000Z',
      },
      {
        tax_component_id: 'expired',
        tax_rate_id: 'rate-c',
        name: 'Expired levy',
        rate: 4,
        sequence: 2,
        is_compound: false,
        end_date: '2024-12-31T00:00:00.000Z',
      },
      {
        tax_component_id: 'active',
        tax_rate_id: 'rate-c',
        name: 'Active levy',
        rate: 5,
        sequence: 3,
        is_compound: false,
      },
    ] as any);

    const result = await new TaxService().calculateTax('client-1', 10000, DATE);

    expect(result.taxAmount).toBe(500);
    expect(result.taxComponents?.map((c) => c.tax_component_id)).toEqual(['active']);
  });

  it('zeroes a component during an applicable tax holiday', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-c', tax_percentage: 5, is_composite: true });
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'rate-c', name: 'GST', rate: 5, sequence: 1, is_compound: false },
    ] as any);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([
      {
        tax_holiday_id: 'hol-1',
        tax_rate_id: 'rate-c',
        start_date: '2025-03-01T00:00:00.000Z',
        end_date: '2025-03-31T00:00:00.000Z',
      },
    ] as any);

    const result = await new TaxService().calculateTax('client-1', 10000, DATE);

    expect(result.taxAmount).toBe(0);
  });

  it('does not apply a holiday outside its window', async () => {
    setupDefaultRate({ tax_rate_id: 'rate-c', tax_percentage: 5, is_composite: true });
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'rate-c', name: 'GST', rate: 5, sequence: 1, is_compound: false },
    ] as any);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([
      {
        tax_holiday_id: 'hol-1',
        tax_rate_id: 'rate-c',
        start_date: '2025-04-01T00:00:00.000Z',
        end_date: '2025-04-30T00:00:00.000Z',
      },
    ] as any);

    const result = await new TaxService().calculateTax('client-1', 10000, DATE);

    expect(result.taxAmount).toBe(500);
  });
});
