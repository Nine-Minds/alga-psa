/**
 * Unit tests for TaxService.calculateTaxForPeriod
 * (packages/billing/src/services/taxService.ts).
 *
 * Period tax splits [start, end) at rate-validity boundaries, pro-rates the net
 * amount by each segment's day share, and ceiling-rounds tax per segment.
 * These tests pin the boundary conventions (inclusive start / exclusive end),
 * segment aggregation, cap application on the single-rate path, and the
 * exemption/reverse-charge/range error contract. All knex access is faked.
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

type TableResults = Record<string, any[]>;

function createFakeKnex(results: TableResults) {
  const queues: Record<string, any[]> = {};
  for (const [table, value] of Object.entries(results)) {
    queues[table] = [...value];
  }

  const knex: any = (table: string) => {
    const queue = queues[table] ?? [];
    const result = queue.length > 0 ? queue.shift() : [];
    const builder: any = {};
    for (const method of [
      'where', 'andWhere', 'orWhere', 'whereNull', 'whereNotNull', 'select', 'orderBy',
    ]) {
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

function setupKnex(results: TableResults) {
  h.knex = createFakeKnex(results);
}

function rate(overrides: Record<string, unknown>) {
  return {
    tax_rate_id: 'rate-1',
    tax_percentage: 5,
    start_date: '2026-01-01',
    end_date: null,
    is_composite: false,
    cap_amount: null,
    ...overrides,
  };
}

describe('TaxService.calculateTaxForPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant = 'tenant-1';
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: false,
    } as any);
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([]);
  });

  it('throws when tenant context is missing', async () => {
    h.tenant = null;
    setupKnex({});

    await expect(
      new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-01-01', '2026-02-01', 'US-NY'),
    ).rejects.toThrow('Tenant context is required for tax calculation');
  });

  it.each([
    ['2026-07-01', '2026-07-01'],
    ['2026-07-01', '2026-06-01'],
  ])('rejects an empty or reversed range [%s, %s)', async (start, end) => {
    setupKnex({});

    await expect(
      new TaxService().calculateTaxForPeriod('client-1', 10000, start, end, 'US-NY'),
    ).rejects.toThrow('Tax period end date must be after start date');
  });

  it('returns zero for a tax-exempt client', async () => {
    setupKnex({ clients: [[{ is_tax_exempt: true }]] });

    const result = await new TaxService().calculateTaxForPeriod(
      'client-1', 10000, '2026-01-01', '2026-02-01', 'US-NY',
    );

    expect(result).toEqual({ taxAmount: 0, taxRate: 0, segments: [] });
  });

  it('returns zero for a non-taxable charge', async () => {
    setupKnex({ clients: [[{ is_tax_exempt: false }]] });

    const result = await new TaxService().calculateTaxForPeriod(
      'client-1', 10000, '2026-01-01', '2026-02-01', 'US-NY', false,
    );

    expect(result).toEqual({ taxAmount: 0, taxRate: 0, segments: [] });
  });

  it('returns zero when reverse charge applies, without resolving a rate', async () => {
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: true,
    } as any);
    setupKnex({ clients: [[{ is_tax_exempt: false }]] });

    const result = await new TaxService().calculateTaxForPeriod(
      'client-1', 10000, '2026-01-01', '2026-02-01', 'US-NY',
    );

    expect(result).toEqual({ taxAmount: 0, taxRate: 0, segments: [] });
  });

  describe('regional path', () => {
    it('keeps a period inside one rate interval as a single segment', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[rate({ tax_percentage: 5 })]],
      });

      // 2026-02-01 -> 2026-03-01 is 28 days; 28000 * 5% = 1400.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 28000, '2026-02-01', '2026-03-01', 'US-NY',
      );

      expect(result.taxAmount).toBe(1400);
      expect(result.taxRate).toBe(5);
      expect(result.segments).toEqual([
        {
          start_date: '2026-02-01',
          end_date: '2026-03-01',
          days: 28,
          netAmount: 28000,
          taxAmount: 1400,
          taxRate: 5,
        },
      ]);
    });

    it('pro-rates by day share and ceiling-rounds each segment across a rate change', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'old', tax_percentage: 5, start_date: '2026-01-01', end_date: '2026-07-01' }),
          rate({ tax_rate_id: 'new', tax_percentage: 7, start_date: '2026-07-01', end_date: null }),
        ]],
      });

      // 2026-06-15 -> 2026-07-15 is 30 days, split 16/14 at the rate change.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 30000, '2026-06-15', '2026-07-15', 'US-NY',
      );

      expect(result.segments.map(segment => ({
        start: segment.start_date,
        end: segment.end_date,
        days: segment.days,
        netAmount: segment.netAmount,
        taxAmount: segment.taxAmount,
        taxRate: segment.taxRate,
      }))).toEqual([
        { start: '2026-06-15', end: '2026-07-01', days: 16, netAmount: 16000, taxAmount: 800, taxRate: 5 },
        { start: '2026-07-01', end: '2026-07-15', days: 14, netAmount: 14000, taxAmount: 980, taxRate: 7 },
      ]);
      expect(result.taxAmount).toBe(1780);
      expect(result.taxRate).toBeCloseTo((1780 / 30000) * 100, 10);
    });

    it('charges the boundary day at the new rate (inclusive start, exclusive end)', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'old', tax_percentage: 5, start_date: '2026-01-01', end_date: '2026-07-01' }),
          rate({ tax_rate_id: 'new', tax_percentage: 7, start_date: '2026-07-01', end_date: null }),
        ]],
      });

      // Two days: 2026-06-30 (old 5%) and 2026-07-01 (new 7%).
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 20000, '2026-06-30', '2026-07-02', 'US-NY',
      );

      expect(result.segments).toEqual([
        { start_date: '2026-06-30', end_date: '2026-07-01', days: 1, netAmount: 10000, taxAmount: 500, taxRate: 5 },
        { start_date: '2026-07-01', end_date: '2026-07-02', days: 1, netAmount: 10000, taxAmount: 700, taxRate: 7 },
      ]);
      expect(result.taxAmount).toBe(1200);
    });

    it('splits a period across multiple rate boundaries', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'r1', tax_percentage: 5, start_date: '2026-01-01', end_date: '2026-06-20' }),
          rate({ tax_rate_id: 'r2', tax_percentage: 7, start_date: '2026-06-20', end_date: '2026-07-01' }),
          rate({ tax_rate_id: 'r3', tax_percentage: 9, start_date: '2026-07-01', end_date: null }),
        ]],
      });

      // 2026-06-10 -> 2026-07-10 is 30 days: 10 / 11 / 9.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 30000, '2026-06-10', '2026-07-10', 'US-NY',
      );

      expect(result.segments.map(segment => [segment.days, segment.netAmount, segment.taxAmount, segment.taxRate])).toEqual([
        [10, 10000, 500, 5],
        [11, 11000, 770, 7],
        [9, 9000, 810, 9],
      ]);
      expect(result.taxAmount).toBe(2080);
    });

    it('ceiling-rounds tax per segment rather than once for the whole period', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'first', tax_percentage: 5, start_date: '2026-01-01', end_date: '2026-01-02' }),
          rate({ tax_rate_id: 'second', tax_percentage: 5, start_date: '2026-01-02', end_date: null }),
        ]],
      });

      // 5 cents over two one-day segments: 2.5 * 5% = 0.125 -> 1 cent each.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 5, '2026-01-01', '2026-01-03', 'US-NY',
      );

      expect(result.segments.map(segment => segment.taxAmount)).toEqual([1, 1]);
      expect(result.taxAmount).toBe(2);
    });

    it('throws a coverage gap naming the interval between rate intervals', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'r1', tax_percentage: 5, start_date: '2026-01-01', end_date: '2026-01-10' }),
          rate({ tax_rate_id: 'r2', tax_percentage: 9, start_date: '2026-01-20', end_date: null }),
        ]],
      });

      // 2026-01-05 -> 2026-01-25 leaves 2026-01-10 -> 2026-01-20 uncovered.
      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 20000, '2026-01-05', '2026-01-25', 'US-NY'),
      ).rejects.toMatchObject({
        code: 'TAX_RATE_COVERAGE_GAP',
        params: { region: 'US-NY', startDate: '2026-01-10', endDate: '2026-01-20' },
      });
    });

    it('caps a single regional rate at its configured cap', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[rate({ tax_percentage: 5, cap_amount: 100 })]],
      });

      // 28000 * 5% = 1400, capped at 100.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 28000, '2026-02-01', '2026-03-01', 'US-NY',
      );

      expect(result.taxAmount).toBe(100);
      expect(result.segments[0].taxAmount).toBe(100);
      expect(result.segments[0].taxRate).toBe(5);
    });

    it('caps each regional rate independently within one segment', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'a', tax_percentage: 5, cap_amount: 200 }),
          rate({ tax_rate_id: 'b', tax_percentage: 2.5, cap_amount: 100 }),
        ]],
      });

      // 28000 * 5% = 1400 -> 200; 28000 * 2.5% = 700 -> 100; sum 300.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 28000, '2026-02-01', '2026-03-01', 'US-NY',
      );

      expect(result.taxAmount).toBe(300);
      expect(result.segments[0].taxRate).toBe(7.5);
    });

    it('caps each regional rate per segment across a capped rate boundary', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[
          rate({ tax_rate_id: 'old', tax_percentage: 5, cap_amount: 100, start_date: '2026-01-01', end_date: '2026-07-01' }),
          rate({ tax_rate_id: 'new', tax_percentage: 7, cap_amount: 200, start_date: '2026-07-01', end_date: null }),
        ]],
      });

      // 2026-06-15 -> 2026-07-15 splits 16/14; each segment caps at its rate's cap.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 30000, '2026-06-15', '2026-07-15', 'US-NY',
      );

      expect(result.segments).toEqual([
        { start_date: '2026-06-15', end_date: '2026-07-01', days: 16, netAmount: 16000, taxAmount: 100, taxRate: 5 },
        { start_date: '2026-07-01', end_date: '2026-07-15', days: 14, netAmount: 14000, taxAmount: 200, taxRate: 7 },
      ]);
      expect(result.taxAmount).toBe(300);
    });

    it('rejects a negative regional cap instead of producing negative tax', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[rate({ tax_percentage: 5, cap_amount: -100 })]],
      });

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 28000, '2026-02-01', '2026-03-01', 'US-NY'),
      ).rejects.toThrow('Tax rate cap amount must be a non-negative whole number.');
    });

    it('throws NO_TAX_RATE when no rate overlaps the period', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[]],
      });

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-06-01', '2026-06-30', 'XX-ZZ'),
      ).rejects.toMatchObject({
        code: 'NO_TAX_RATE',
        params: { region: 'XX-ZZ', startDate: '2026-06-01', endDate: '2026-06-30' },
      });
    });
  });

  describe('default-rate path', () => {
    function setupDefaultRate(overrides: Record<string, unknown> = {}) {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[{ tax_rate_id: 'rate-1' }]],
        tax_rates: [[rate({ tax_percentage: 10, ...overrides })]],
      });
    }

    it('clamps the whole-period tax to the rate cap', async () => {
      setupDefaultRate({ cap_amount: 500 });

      // 10000 * 10% = 1000, capped at 500.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 10000, '2026-02-01', '2026-03-01',
      );

      expect(result.taxAmount).toBe(500);
      expect(result.taxRate).toBeCloseTo((500 / 10000) * 100, 10);
      expect(result.segments).toEqual([
        { start_date: '2026-02-01', end_date: '2026-03-01', days: 28, netAmount: 10000, taxAmount: 500, taxRate: 10 },
      ]);
    });

    it('leaves period tax uncapped when cap_amount is null', async () => {
      setupDefaultRate({ cap_amount: null });

      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 10000, '2026-02-01', '2026-03-01',
      );

      expect(result.taxAmount).toBe(1000);
      expect(result.taxRate).toBe(10);
    });

    it('charges no period tax when the cap is zero', async () => {
      setupDefaultRate({ cap_amount: 0 });

      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 10000, '2026-02-01', '2026-03-01',
      );

      expect(result.taxAmount).toBe(0);
      expect(result.taxRate).toBe(0);
    });

    it('throws a coverage gap when the default rate does not cover the whole period', async () => {
      setupDefaultRate({ cap_amount: null, end_date: '2026-07-01' });

      // 2026-06-15 -> 2026-07-15 runs 14 days past the default rate's end.
      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 30000, '2026-06-15', '2026-07-15'),
      ).rejects.toMatchObject({
        code: 'TAX_RATE_COVERAGE_GAP',
        params: { startDate: '2026-07-01', endDate: '2026-07-15' },
      });
    });

    it('throws a coverage gap when the default rate starts after the period', async () => {
      setupDefaultRate({ cap_amount: null, start_date: '2026-03-01' });

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-02-01', '2026-03-15'),
      ).rejects.toMatchObject({
        code: 'TAX_RATE_COVERAGE_GAP',
        params: { startDate: '2026-02-01', endDate: '2026-03-01' },
      });
    });

    it('applies the cap to the progressive-threshold path within a period', async () => {
      setupDefaultRate({ tax_percentage: 0, cap_amount: 6000 });
      vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
        { tax_rate_threshold_id: 't1', tax_rate_id: 'rate-1', min_amount: 0, max_amount: 100000, rate: 5 },
        { tax_rate_threshold_id: 't2', tax_rate_id: 'rate-1', min_amount: 100000, max_amount: null, rate: 10 },
      ] as any);

      // Uncapped 5000 + 5000 = 10000, capped at 6000.
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 150000, '2026-02-01', '2026-03-01',
      );

      expect(result.taxAmount).toBe(6000);
      expect(result.segments[0].taxAmount).toBe(6000);
    });

    it('throws NO_TAX_RATE when the client has no default tax rate', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[]],
      });

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-02-01', '2026-03-01'),
      ).rejects.toMatchObject({ code: 'NO_TAX_RATE' });
    });

    it('throws NO_TAX_RATE when the default rate is inactive for the period', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[{ tax_rate_id: 'rate-1' }]],
        tax_rates: [[]],
      });

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-02-01', '2026-03-01'),
      ).rejects.toMatchObject({ code: 'NO_TAX_RATE' });
    });
  });

  describe('date validation', () => {
    beforeEach(() => {
      const client = [{ is_tax_exempt: false }];
      const regionRate = [rate({ tax_percentage: 5, start_date: '2020-01-01' })];
      setupKnex({
        clients: [client, client, client, client],
        tax_rates: [regionRate, regionRate, regionRate, regionRate],
      });
    });

    it.each([
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-01-01junk',
      '2026-1-1',
      '01-01-2026',
      '2026-01-01T25:00',
      '2026-01-01T12:60',
    ])('rejects an invalid date %s', async bad => {
      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, bad, '2026-03-01', 'US-NY'),
      ).rejects.toThrow('Invalid tax calculation date');
      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-01-01', bad, 'US-NY'),
      ).rejects.toThrow('Invalid tax calculation date');
    });

    it('accepts a leap day and rejects a non-leap February 29', async () => {
      const leap = await new TaxService().calculateTaxForPeriod(
        'client-1', 28000, '2024-02-28', '2024-03-01', 'US-NY',
      );
      expect(leap.segments[0].days).toBe(2);

      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, '2026-02-29', '2026-03-01', 'US-NY'),
      ).rejects.toThrow('Invalid tax calculation date');
    });

    it('keeps the spelled-out calendar day for offset timestamps', async () => {
      // The leading date is 2026-02-01 in every case, regardless of offset.
      for (const start of [
        '2026-02-01T23:00:00-05:00',
        '2026-02-01T00:00:00.000Z',
        '2026-02-01 12:30:00',
      ]) {
        const result = await new TaxService().calculateTaxForPeriod(
          'client-1', 28000, start, '2026-03-01', 'US-NY',
        );
        expect(result.segments[0].start_date).toBe('2026-02-01');
        expect(result.segments[0].days).toBe(28);
      }
    });

    it('normalizes a local-midnight Date the way PostgreSQL date columns hydrate', async () => {
      const hydrated = new Date(2026, 1, 1); // local midnight, 2026-02-01
      const result = await new TaxService().calculateTaxForPeriod(
        'client-1', 28000, hydrated as any, '2026-03-01', 'US-NY',
      );
      expect(result.segments[0].start_date).toBe('2026-02-01');
      expect(result.segments[0].days).toBe(28);
    });

    it('rejects an invalid Date object', async () => {
      await expect(
        new TaxService().calculateTaxForPeriod('client-1', 10000, new Date(NaN) as any, '2026-03-01', 'US-NY'),
      ).rejects.toThrow('Invalid tax calculation date');
    });
  });
});
