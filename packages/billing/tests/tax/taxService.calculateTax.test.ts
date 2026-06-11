/**
 * Unit tests for TaxService.calculateTax (packages/billing/src/services/taxService.ts).
 *
 * Covers the money path: exemption / reverse-charge short circuits, region-code
 * rate lookup (composite summing, string percentages from pg numeric columns),
 * cents rounding (Math.ceil policy), zero/negative amounts, and the
 * default-rate fallback precedence when no region code is supplied.
 *
 * All knex access is faked; no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tenant: 'tenant-1' as string | null,
  knex: undefined as any,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: h.tenant })),
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

/**
 * Minimal chainable, thenable knex fake. Each call to knex(table) shifts the
 * next queued result for that table. `.first()` resolves the first row,
 * awaiting the builder resolves the full row set.
 */
function createFakeKnex(results: TableResults) {
  const queues: Record<string, any[]> = {};
  for (const [table, value] of Object.entries(results)) {
    queues[table] = [...value];
  }

  const knex: any = (table: string) => {
    const queue = queues[table] ?? [];
    const result = queue.length > 0 ? queue.shift() : [];
    const builder: any = {};
    const chainMethods = [
      'where',
      'andWhere',
      'andWhereNot',
      'orWhere',
      'whereIn',
      'whereNull',
      'whereNotNull',
      'orWhereNull',
      'select',
      'orderBy',
    ];
    for (const method of chainMethods) {
      builder[method] = (...args: any[]) => {
        for (const arg of args) {
          if (typeof arg === 'function') {
            arg.call(builder, builder);
          }
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

const DATE = '2025-03-15T00:00:00.000Z';

function setupKnex(results: TableResults) {
  h.knex = createFakeKnex(results);
}

describe('TaxService.calculateTax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant = 'tenant-1';
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: false,
    } as any);
  });

  it('throws when tenant context is missing', async () => {
    h.tenant = null;
    setupKnex({});

    await expect(new TaxService().calculateTax('client-1', 1000, DATE)).rejects.toThrow(
      'Tenant context is required for tax calculation'
    );
  });

  it('throws when the client does not exist in the tenant', async () => {
    setupKnex({ clients: [[]] });

    await expect(new TaxService().calculateTax('ghost-client', 1000, DATE)).rejects.toThrow(
      'Client ghost-client not found in tenant tenant-1'
    );
  });

  it('returns zero tax for tax-exempt clients', async () => {
    setupKnex({ clients: [[{ is_tax_exempt: true }]] });

    const result = await new TaxService().calculateTax('client-1', 100000, DATE, 'US-NY');

    expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
  });

  it('returns zero tax for non-taxable charges', async () => {
    setupKnex({ clients: [[{ is_tax_exempt: false }]] });

    const result = await new TaxService().calculateTax('client-1', 100000, DATE, 'US-NY', false);

    expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
  });

  it('returns zero tax when reverse charge applies (B2B liability shift)', async () => {
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1',
      tenant: 'tenant-1',
      is_reverse_charge_applicable: true,
    } as any);
    setupKnex({ clients: [[{ is_tax_exempt: false }]] });

    const result = await new TaxService().calculateTax('client-1', 100000, DATE, 'US-NY');

    expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
  });

  describe('region-code rate lookup', () => {
    it('applies a single active rate and rounds fractional cents up (never undercharges)', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[{ tax_percentage: 8.875 }]],
      });

      // 10000 cents * 8.875% = 887.5 cents -> ceil -> 888
      const result = await new TaxService().calculateTax('client-1', 10000, DATE, 'US-NY');

      expect(result).toEqual({ taxAmount: 888, taxRate: 8.875 });
    });

    it('sums all applicable rates for composite regional taxes', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[{ tax_percentage: 5 }, { tax_percentage: 2.5 }]],
      });

      const result = await new TaxService().calculateTax('client-1', 10000, DATE, 'CA-QC');

      expect(result).toEqual({ taxAmount: 750, taxRate: 7.5 });
    });

    it('parses string percentages from numeric columns and ignores unparseable rates', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[{ tax_percentage: '6.25' }, { tax_percentage: 'not-a-number' }]],
      });

      const result = await new TaxService().calculateTax('client-1', 10000, DATE, 'US-TX');

      expect(result).toEqual({ taxAmount: 625, taxRate: 6.25 });
    });

    it('charges no tax on zero or negative (credit) amounts but still reports the rate', async () => {
      setupKnex({
        clients: [
          [{ is_tax_exempt: false }],
          [{ is_tax_exempt: false }],
        ],
        tax_rates: [[{ tax_percentage: 10 }], [{ tax_percentage: 10 }]],
      });
      const service = new TaxService();

      expect(await service.calculateTax('client-1', 0, DATE, 'US-NY')).toEqual({
        taxAmount: 0,
        taxRate: 10,
      });
      expect(await service.calculateTax('client-1', -5000, DATE, 'US-NY')).toEqual({
        taxAmount: 0,
        taxRate: 10,
      });
    });

    it('rounds each call independently with ceil (one extra cent on a 333-cent line at 10%)', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[{ tax_percentage: 10 }]],
      });

      const result = await new TaxService().calculateTax('client-1', 333, DATE, 'US-NY');

      // ceil(33.3) = 34: per-line ceiling policy.
      expect(result.taxAmount).toBe(34);
    });

    it('throws when no active rate exists for the region/date', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        tax_rates: [[]],
      });

      await expect(
        new TaxService().calculateTax('client-1', 10000, DATE, 'XX-ZZ')
      ).rejects.toThrow(`No active tax rate(s) found for region XX-ZZ on date ${DATE}`);
    });
  });

  describe('default-rate fallback (no region code)', () => {
    it('returns zero tax when the client has no default tax rate association', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[]],
      });

      const result = await new TaxService().calculateTax('client-1', 10000, DATE);

      expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
    });

    it('returns zero tax when the default rate is inactive or invalid for the date', async () => {
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[{ tax_rate_id: 'rate-1' }]],
        tax_rates: [[]],
      });

      const result = await new TaxService().calculateTax('client-1', 10000, DATE);

      expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
    });

    it('calculates simple tax from the default rate with ceil rounding', async () => {
      vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([]);
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[{ tax_rate_id: 'rate-1' }]],
        tax_rates: [
          [{ tax_rate_id: 'rate-1', tax_percentage: 7.25, is_composite: false }],
        ],
      });

      // 9999 * 7.25% = 724.9275 -> ceil -> 725
      const result = await new TaxService().calculateTax('client-1', 9999, DATE);

      expect(result).toEqual({ taxAmount: 725, taxRate: 7.25 });
    });

    it('returns zero tax (but the configured rate) for non-positive amounts on the simple path', async () => {
      vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([]);
      setupKnex({
        clients: [[{ is_tax_exempt: false }]],
        client_tax_rates: [[{ tax_rate_id: 'rate-1' }]],
        tax_rates: [
          [{ tax_rate_id: 'rate-1', tax_percentage: 7.25, is_composite: false }],
        ],
      });

      const result = await new TaxService().calculateTax('client-1', 0, DATE);

      expect(result).toEqual({ taxAmount: 0, taxRate: 7.25 });
    });
  });
});
