import { describe, expect, it, vi } from 'vitest';
import type { IBillingPeriod } from '@alga-psa/types';
import type { Knex } from 'knex';

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: () => h.db,
}));

import { BillingEngine } from './billingEngine';

describe('ticket fixed-fee billing window', () => {
  it('includes older unbilled fees before the period end without a lower date bound', async () => {
    const period: IBillingPeriod = {
      tenant: 'tenant-1',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    };
    const olderFee = {
      entry_id: 'fee-from-prior-period',
      client_id: 'client-1',
      service_id: 'service-1',
      quantity: 1,
      rate: 100,
      currency_code: 'USD',
      created_at: '2026-02-15',
      source_updated_at: '2026-02-15T12:00:00Z',
      service_name: 'Setup',
      tax_rate_id: null,
    };
    const feeFilters: Array<[unknown, ...unknown[]]> = [];
    const feeQuery: any = {
      where: (...args: [unknown, ...unknown[]]) => {
        feeFilters.push(args);
        return feeQuery;
      },
      orderBy: () => feeQuery,
      select: () => feeQuery,
      then: (resolve: (value: typeof olderFee[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([olderFee].filter((row) => {
          for (const [column, operator, value] of feeFilters) {
            if (typeof column !== 'string' || column !== 'f.created_at') continue;
            const comparison = Date.parse(row.created_at) - Date.parse(String(value));
            if (operator === '>=' && comparison < 0) return false;
            if (operator === '<' && comparison >= 0) return false;
          }
          return true;
        })).then(resolve, reject),
    };
    const clientQuery = {
      where: () => clientQuery,
      first: async () => ({ is_tax_exempt: true }),
    };
    h.db = {
      table: (name: string) => name === 'ticket_fixed_fee_services as f' ? feeQuery : clientQuery,
      tenantJoin: vi.fn(),
    };
    const trx = { raw: vi.fn(() => 'source-updated-at-expression') };
    const engine = BillingEngine.forTransaction(trx as unknown as Knex.Transaction, 'tenant-1');
    const engineInternals = engine as unknown as {
      getTaxInfoFromService: (input: { service_id: string; tax_rate_id: string | null }) =>
        Promise<{ taxRegion: string | null; isTaxable: boolean }>;
      getClientDefaultTaxRegionCode: (clientId: string) => Promise<string | null>;
      calculateTicketFixedFeeCharges: (
        clientId: string,
        billingPeriod: IBillingPeriod,
        currencyCode: string,
      ) => Promise<Array<{ ticket_fixed_fee_id?: string }>>;
    };
    vi.spyOn(engineInternals, 'getTaxInfoFromService').mockResolvedValue({ taxRegion: null, isTaxable: false });
    vi.spyOn(engineInternals, 'getClientDefaultTaxRegionCode').mockResolvedValue(null);
    const calculate = engineInternals.calculateTicketFixedFeeCharges.bind(engine);

    await expect(calculate('client-1', period, 'USD')).resolves.toMatchObject([
      { ticket_fixed_fee_id: 'fee-from-prior-period' },
    ]);
    expect(feeFilters).toContainEqual(['f.created_at', '<', period.endDate]);
    expect(feeFilters).not.toContainEqual(['f.created_at', '>=', period.startDate]);
    // Without a lower date bound, only the unbilled predicate keeps billed fees out of later invoices.
    expect(feeFilters).toContainEqual([expect.objectContaining({ 'f.is_billed': false, 'f.currency_code': 'USD' })]);
  });

  it('includes older unbilled ticket materials before the period end without a lower date bound', async () => {
    const period: IBillingPeriod = {
      tenant: 'tenant-1',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    };
    const olderMaterial = {
      source_type: 'ticket',
      source_id: 'material-from-prior-period',
      project_id: null,
      service_id: 'service-1',
      quantity: 1,
      rate: 100,
      currency_code: 'USD',
      description: 'Material',
      created_at: '2026-02-15',
      source_updated_at: '2026-02-15T12:00:00Z',
      service_name: 'Material',
      tax_rate_id: null,
    };
    const materialFilters: Array<[unknown, ...unknown[]]> = [];
    const materialQuery: any = {
      where: (...args: [unknown, ...unknown[]]) => {
        materialFilters.push(args);
        return materialQuery;
      },
      andWhere: (...args: [unknown, ...unknown[]]) => {
        materialFilters.push(args);
        return materialQuery;
      },
      select: () => materialQuery,
      then: (resolve: (value: typeof olderMaterial[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([olderMaterial].filter((row) => {
          for (const [column, operator, value] of materialFilters) {
            if (column !== 'tm.created_at') continue;
            const comparison = Date.parse(row.created_at) - Date.parse(String(value));
            if (operator === '>=' && comparison < 0) return false;
            if (operator === '<' && comparison >= 0) return false;
          }
          return true;
        })).then(resolve, reject),
    };
    const clientQuery = {
      where: () => clientQuery,
      first: async () => ({ client_id: 'client-1', is_tax_exempt: true }),
    };
    h.db = {
      table: (name: string) => name === 'ticket_materials as tm' ? materialQuery : clientQuery,
      tenantJoin: vi.fn(),
    };
    const trx = { raw: vi.fn(() => 'source-updated-at-expression') };
    const engine = BillingEngine.forTransaction(trx as unknown as Knex.Transaction, 'tenant-1');
    const engineInternals = engine as unknown as {
      getTaxInfoFromService: (input: { service_id: string; tax_rate_id: string | null }) =>
        Promise<{ taxRegion: string | null; isTaxable: boolean }>;
      getClientDefaultTaxRegionCode: (clientId: string) => Promise<string | null>;
      calculateMaterialCharges: (
        clientId: string,
        billingPeriod: IBillingPeriod,
        currencyCode: string,
      ) => Promise<Array<{ material_source_id?: string }>>;
    };
    vi.spyOn(engineInternals, 'getTaxInfoFromService').mockResolvedValue({ taxRegion: null, isTaxable: false });
    vi.spyOn(engineInternals, 'getClientDefaultTaxRegionCode').mockResolvedValue(null);
    const calculate = engineInternals.calculateMaterialCharges.bind(engine);

    await expect(calculate('client-1', period, 'USD')).resolves.toMatchObject([
      { material_source_id: 'material-from-prior-period' },
    ]);
    expect(materialFilters).toContainEqual(['tm.created_at', '<', period.endDate]);
    expect(materialFilters).not.toContainEqual(['tm.created_at', '>=', period.startDate]);
    expect(materialFilters).toContainEqual([expect.objectContaining({ 'tm.is_billed': false, 'tm.currency_code': 'USD' })]);
  });
});
