/**
 * T001: the shared tax engine and TaxService give the same answer.
 *
 * TaxService is a thin adapter over `shared/billingClients/taxEngine`; this
 * runs both entry points over identical fixtures (fake knex + the model stubs
 * the other tax suites use) and pins the arithmetic they must agree on: caps,
 * brackets with a non-zero first minimum and a gap, compound/non-compound
 * composites, holidays, currency filtering, exemption and reverse charge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ knex: undefined as any }));

vi.mock('@alga-psa/db', async () => {
  const { modelBackedTenantDb } = await import('./helpers/modelBackedTenantDb');
  return {
    createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: 'tenant-1' })),
    tenantDb: vi.fn((knex: any) => modelBackedTenantDb(knex)),
  };
});

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
import { calculateTaxForAmount } from '@alga-psa/shared/billingClients/taxEngine';

const DATE = '2025-03-15T00:00:00.000Z';

type Calls = Record<string, any[][]>;

/** Fake knex: queued rows per table, recording every where-style call. */
function fakeKnex(rows: Record<string, any>, calls: Calls = {}) {
  return (table: string) => {
    const value = rows[table];
    const builder: any = {};
    for (const method of ['where', 'andWhere', 'orWhere', 'whereNull', 'select', 'orderBy']) {
      builder[method] = (...args: any[]) => {
        (calls[`${table}.${method}`] ??= []).push(args);
        for (const arg of args) if (typeof arg === 'function') arg.call(builder, builder);
        return builder;
      };
    }
    builder.first = () => Promise.resolve(Array.isArray(value) ? value[0] : value);
    builder.then = (ok: any, err: any) =>
      Promise.resolve(Array.isArray(value) ? value : value === undefined ? [] : [value]).then(ok, err);
    return builder;
  };
}

async function both(
  rows: Record<string, any>,
  args: { netAmount?: number; regionCode?: string; currencyCode?: string; isTaxable?: boolean } = {},
) {
  const netAmount = args.netAmount ?? 10000;
  const taxCalls: Calls = {};
  h.knex = fakeKnex(rows, taxCalls);
  const viaService = await new TaxService().calculateTax(
    'client-1', netAmount, DATE, args.regionCode, args.isTaxable ?? true, args.currencyCode,
  );
  const engineCalls: Calls = {};
  const outcome = await calculateTaxForAmount(fakeKnex(rows, engineCalls) as any, 'tenant-1', {
    clientId: 'client-1', netAmount, date: DATE, regionCode: args.regionCode,
    isTaxable: args.isTaxable, currencyCode: args.currencyCode,
  });
  expect(outcome.resolved).toBe(true);
  const { resolved, ...viaEngine } = outcome as any;
  expect(viaEngine).toEqual(viaService);
  return { result: viaEngine as typeof viaService, taxCalls, engineCalls };
}

const baseRows = (extra: Record<string, any> = {}) => ({
  clients: { is_tax_exempt: false },
  ...extra,
});

describe('tax engine parity with TaxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1', tenant: 'tenant-1', is_reverse_charge_applicable: false,
    } as any);
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([]);
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([]);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([]);
  });

  it('caps a single regional rate', async () => {
    const { result } = await both(baseRows({ tax_rates: [{ tax_percentage: 10, cap_amount: 500 }] }), { regionCode: 'R' });
    expect(result.taxAmount).toBe(500);
  });

  it('caps one of two regional rates and sums the contributions', async () => {
    const { result } = await both(
      baseRows({ tax_rates: [{ tax_percentage: 10, cap_amount: 300 }, { tax_percentage: 5, cap_amount: null }] }),
      { regionCode: 'R' },
    );
    expect(result.taxAmount).toBe(300 + 500);
    expect(result.taxRate).toBe(15);
  });

  it('taxes each bracket against the original base (non-zero first minimum, gap)', async () => {
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
      { tax_rate_threshold_id: 't1', tax_rate_id: 'r', min_amount: 2000, max_amount: 5000, rate: 10 },
      { tax_rate_threshold_id: 't2', tax_rate_id: 'r', min_amount: 8000, max_amount: null, rate: 20 },
    ] as any);
    const { result } = await both(baseRows({
      client_tax_rates: { tax_rate_id: 'r' },
      tax_rates: { tax_rate_id: 'r', tax_percentage: 0, is_composite: false },
    }));
    // 2000..5000 @10% = 300, gap 5000..8000 untaxed, 8000..10000 @20% = 400
    expect(result.taxAmount).toBe(700);
  });

  it('applies the cap to bracket tax', async () => {
    vi.mocked(ClientTaxSettings.getTaxRateThresholds).mockResolvedValue([
      { tax_rate_threshold_id: 't1', tax_rate_id: 'r', min_amount: 0, max_amount: null, rate: 10 },
    ] as any);
    const { result } = await both(baseRows({
      client_tax_rates: { tax_rate_id: 'r' },
      tax_rates: { tax_rate_id: 'r', tax_percentage: 0, is_composite: false, cap_amount: 400 },
    }));
    expect(result.taxAmount).toBe(400);
  });

  it('taxes a non-compound component on net even after a compound one', async () => {
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'r', rate: 5, is_compound: false },
      { tax_component_id: 'c2', tax_rate_id: 'r', rate: 10, is_compound: true },
      { tax_component_id: 'c3', tax_rate_id: 'r', rate: 2, is_compound: false },
    ] as any);
    const { result } = await both(baseRows({
      client_tax_rates: { tax_rate_id: 'r' },
      tax_rates: { tax_rate_id: 'r', tax_percentage: 0, is_composite: true },
    }));
    // 5% of 10000 = 500; compound 10% of 10500 = 1050; non-compound 2% of net = 200
    expect(result.taxAmount).toBe(500 + 1050 + 200);
  });

  it('zeroes a component during a tax holiday', async () => {
    vi.mocked(ClientTaxSettings.getCompositeTaxComponents).mockResolvedValue([
      { tax_component_id: 'c1', tax_rate_id: 'r', rate: 5, is_compound: false },
    ] as any);
    vi.mocked(ClientTaxSettings.getTaxHolidays).mockResolvedValue([
      { tax_rate_id: 'r', start_date: '2025-03-01', end_date: '2025-03-31' },
    ] as any);
    const { result } = await both(baseRows({
      client_tax_rates: { tax_rate_id: 'r' },
      tax_rates: { tax_rate_id: 'r', tax_percentage: 0, is_composite: true },
    }));
    expect(result.taxAmount).toBe(0);
  });

  it('passes the currency filter to the rate lookup identically', async () => {
    const { taxCalls, engineCalls } = await both(
      baseRows({ tax_rates: [{ tax_percentage: 10, cap_amount: null }] }),
      { regionCode: 'R', currencyCode: 'EUR' },
    );
    expect(taxCalls['tax_rates.orWhere']).toContainEqual(['currency_code', 'EUR']);
    expect(engineCalls['tax_rates.orWhere']).toEqual(taxCalls['tax_rates.orWhere']);
  });

  it('returns zero for an exempt client', async () => {
    const { result } = await both({ clients: { is_tax_exempt: true } }, { regionCode: 'R' });
    expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
  });

  it('returns zero for a reverse-charge client', async () => {
    vi.mocked(ClientTaxSettings.get).mockResolvedValue({
      client_id: 'client-1', tenant: 'tenant-1', is_reverse_charge_applicable: true,
    } as any);
    const { result } = await both(baseRows(), { regionCode: 'R' });
    expect(result).toEqual({ taxAmount: 0, taxRate: 0 });
  });
});
