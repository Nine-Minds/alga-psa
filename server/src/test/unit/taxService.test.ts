import { TaxService } from '@alga-psa/billing/services/taxService';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '../../interfaces/tax.interfaces';
import ClientTaxSettings from '@alga-psa/billing/models/clientTaxSettings';

import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';

vi.mock('@alga-psa/billing/models/clientTaxSettings');

// TaxService now resolves tenant context and a knex connection through
// createTenantKnex() and queries the clients / client_tax_rates / tax_rates
// tables directly. Mock @alga-psa/db so these unit tests supply both the tenant
// context and per-table rows without ever touching a live database.
const db = vi.hoisted(() => ({
    rows: {} as Record<string, unknown>,
    queriedTables: [] as string[],
}));

vi.mock('@alga-psa/db', () => {
    const makeBuilder = (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const method of [
            'where', 'andWhere', 'orWhere', 'andWhereNot',
            'whereNull', 'whereNotNull', 'select', 'orderBy',
        ]) {
            builder[method] = (..._args: unknown[]) => builder;
        }
        builder.first = async () => db.rows[table];
        return builder;
    };
    const knex = (table: string) => {
        db.queriedTables.push(table);
        return makeBuilder(table);
    };
    (knex as unknown as { fn: { now: () => string } }).fn = { now: () => 'now()' };
    return {
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
        createTenantKnex: async () => ({ knex, tenant: 'test_tenant' }),
        runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
        withTransaction: async (knexOrTrx: unknown, fn: (trx: unknown) => unknown) => fn(knexOrTrx),
        getTenantContext: async () => 'test_tenant',
    };
});

describe('TaxService', () => {
    let taxService: TaxService;
    const mockClientTaxSettings = ClientTaxSettings as Mocked<typeof ClientTaxSettings>;

    beforeEach(() => {
        taxService = new TaxService();
        vi.resetAllMocks();
        db.rows = {};
        db.queriedTables.length = 0;
        // Every calculateTax call first checks the client's tax-exempt flag.
        db.rows['clients'] = { is_tax_exempt: false };
        db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
        db.rows['tax_rates'] = { tax_rate_id: 'rate1', tax_percentage: 10, is_composite: false };
        mockClientTaxSettings.get.mockResolvedValue({
            tenant: 'test_tenant', client_id: 'client1', tax_rate_id: 'rate1',
            is_reverse_charge_applicable: false,
        });
        mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue([]);
        mockClientTaxSettings.getCompositeTaxComponents.mockResolvedValue([]);
        mockClientTaxSettings.getTaxHolidays.mockResolvedValue([]);
    });

    describe('calculateTax', () => {
        it('should calculate simple tax correctly', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: false,
            };

            const mockTaxRate: ITaxRate = {
                tax_rate_id: 'rate1',
                tax_type: 'VAT',
                country_code: 'US',
                tax_percentage: 10,
                is_reverse_charge_applicable: false,
                is_composite: false,
                start_date: '2023-01-01',
                is_active: true,
                name: 'Standard VAT',
            };

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);
            db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
            db.rows['tax_rates'] = mockTaxRate;
            mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue([]);

            const result = await taxService.calculateTax('client1', 100, '2023-06-01');

            expect(result.taxAmount).toBe(10);
            expect(result.taxRate).toBe(10);
        });

        it('should calculate composite tax correctly', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: false,
            };

            const mockTaxRate: ITaxRate = {
                tax_rate_id: 'rate1',
                tax_type: 'VAT',
                country_code: 'US',
                tax_percentage: 15,
                is_reverse_charge_applicable: false,
                is_composite: true,
                start_date: '2023-01-01',
                is_active: true,
                name: 'Composite VAT',
            };

            const mockTaxComponents: ITaxComponent[] = [
                {
                    tax_component_id: 'comp1',
                    tax_rate_id: 'rate1',
                    name: 'State Tax',
                    rate: 5,
                    sequence: 1,
                    is_compound: false,
                },
                {
                    tax_component_id: 'comp2',
                    tax_rate_id: 'rate1',
                    name: 'City Tax',
                    rate: 2,
                    sequence: 2,
                    is_compound: true,
                },
            ];

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);
            db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
            db.rows['tax_rates'] = mockTaxRate;
            mockClientTaxSettings.getCompositeTaxComponents.mockResolvedValue(mockTaxComponents);
            mockClientTaxSettings.getTaxHolidays.mockResolvedValue([]);

            const result = await taxService.calculateTax('client1', 10000, '2023-06-01');

            // Expected calculation:
            // Amounts are cents. State Tax: 10000 * 5% = 500
            // City Tax: (10000 + 500) * 2% = 210
            // Total Tax: 500 + 210 = 710 cents (7.1%).
            expect(result.taxAmount).toBe(710);
            expect(result.taxRate).toBeCloseTo(7.1, 2);
            expect(result.taxComponents).toEqual(mockTaxComponents);
        });

        it('should apply threshold-based tax correctly', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: false,
            };

            const mockTaxRate: ITaxRate = {
                tax_rate_id: 'rate1',
                tax_type: 'VAT',
                country_code: 'US',
                tax_percentage: 0,
                is_reverse_charge_applicable: false,
                is_composite: false,
                start_date: '2023-01-01',
                is_active: true,
                name: 'Threshold VAT',
            };

            const mockThresholds: ITaxRateThreshold[] = [
                {
                    tax_rate_threshold_id: 'threshold1',
                    tax_rate_id: 'rate1',
                    min_amount: 0,
                    max_amount: 100,
                    rate: 5,
                },
                {
                    tax_rate_threshold_id: 'threshold2',
                    tax_rate_id: 'rate1',
                    min_amount: 100,
                    max_amount: 200,
                    rate: 10,
                },
                {
                    tax_rate_threshold_id: 'threshold3',
                    tax_rate_id: 'rate1',
                    min_amount: 200,
                    rate: 15,
                },
            ];

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);
            db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
            db.rows['tax_rates'] = mockTaxRate;
            mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue(mockThresholds);

            const result = await taxService.calculateTax('client1', 250, '2023-06-01');

            // Expected calculation (amounts are smallest currency units, each
            // threshold's tax is rounded up with Math.ceil):
            // 0-100: ceil(100 * 5%) = 5
            // 100-200: ceil(100 * 10%) = 10
            // 200-250: ceil(50 * 15%) = ceil(7.5) = 8
            // Total Tax: 5 + 10 + 8 = 23
            expect(result.taxAmount).toBe(23);
            expect(result.taxRate).toBeCloseTo(9.2, 2); // 23 / 250 = 9.2%
            expect(result.appliedThresholds).toEqual(mockThresholds);
        });

        it('should apply tax holiday correctly', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: false,
            };

            const mockTaxRate: ITaxRate = {
                tax_rate_id: 'rate1',
                tax_type: 'VAT',
                country_code: 'US',
                tax_percentage: 10,
                is_reverse_charge_applicable: false,
                is_composite: true,
                start_date: '2023-01-01',
                is_active: true,
                name: 'Standard VAT',
            };

            const mockTaxComponents: ITaxComponent[] = [
                {
                    tax_component_id: 'comp1',
                    tax_rate_id: 'rate1',
                    name: 'Standard VAT',
                    rate: 10,
                    sequence: 1,
                    is_compound: false,
                },
            ];

            const mockHolidays: ITaxHoliday[] = [
                {
                    tax_holiday_id: 'holiday1',
                    tax_component_id: 'comp1',
                    start_date: '2023-06-01',
                    end_date: '2023-06-30',
                    description: 'June Tax Holiday',
                },
            ];

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);
            db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
            db.rows['tax_rates'] = mockTaxRate;
            mockClientTaxSettings.getCompositeTaxComponents.mockResolvedValue(mockTaxComponents);
            mockClientTaxSettings.getTaxHolidays.mockResolvedValue(mockHolidays);

            const result = await taxService.calculateTax('client1', 100, '2023-06-15');

            expect(result.taxAmount).toBe(0);
            expect(result.taxRate).toBe(0);
            expect(result.taxComponents).toEqual(mockTaxComponents);
        });

        it('should apply reverse charge correctly', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: true,
            };

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);

            const result = await taxService.calculateTax('client1', 100, '2023-06-01');

            expect(result.taxAmount).toBe(0);
            expect(result.taxRate).toBe(0);
        });
    });

    describe('isReverseChargeApplicable', () => {
        it('should return correct reverse charge applicability', async () => {
            const mockTaxSettings: IClientTaxSettings = {
                tenant: 'test_tenant',
                client_id: 'client1',
                tax_rate_id: 'rate1',
                is_reverse_charge_applicable: true,
            };

            mockClientTaxSettings.get.mockResolvedValue(mockTaxSettings);

            const result = await taxService.isReverseChargeApplicable('client1');

            expect(result).toBe(true);
        });
    });

    describe('getTaxType', () => {
        it('should return correct tax type', async () => {
            const mockTaxRate: ITaxRate = {
                tax_rate_id: 'rate1',
                tax_type: 'VAT',
                country_code: 'US',
                tax_percentage: 10,
                is_reverse_charge_applicable: false,
                is_composite: false,
                start_date: '2023-01-01',
                is_active: true,
                name: 'Standard VAT',
            };

            db.rows['client_tax_rates'] = { tax_rate_id: 'rate1' };
            db.rows['tax_rates'] = mockTaxRate;

            const result = await taxService.getTaxType('client1');

            expect(result).toBe('VAT');
        });
    });

    it.each([
        ['2023-05-31', 1000], ['2023-06-01', 0], ['2023-06-15', 0],
        ['2023-06-30', 0], ['2023-07-01', 1000],
    ] as const)('applies overlapping tax holidays once, including their boundaries (%s)', async (date, taxAmount) => {
        db.rows['tax_rates'] = { tax_rate_id: 'rate1', is_composite: true };
        mockClientTaxSettings.getCompositeTaxComponents.mockResolvedValue([{
            tenant: 'test_tenant', tax_component_id: 'component1', tax_rate_id: 'rate1',
            name: 'Tax', rate: 10, sequence: 1, is_compound: false,
        }]);
        mockClientTaxSettings.getTaxHolidays.mockResolvedValue([
            { tenant: 'test_tenant', tax_holiday_id: 'h1', tax_rate_id: 'rate1', start_date: '2023-06-01', end_date: '2023-06-20' },
            { tenant: 'test_tenant', tax_holiday_id: 'h2', tax_rate_id: 'rate1', start_date: '2023-06-10', end_date: '2023-06-30' },
        ]);
        const result = await taxService.calculateTax('client1', 10000, date);
        expect(result.taxAmount).toBe(taxAmount);
        expect(result.taxRate).toBe(taxAmount / 100);
    });
    // Transaction-date and currency SQL filtering run against PostgreSQL in
    // packages/billing/src/services/taxService.rateSelection.db.test.ts.
    // Three placeholders were removed here rather than left to read as coverage.
    // International rates are region codes, already exercised by
    // taxService.rateSelection.db.test.ts. Tax caps and period-spanning tax are
    // not implemented at all -- calculateTax resolves a single date and no cap
    // concept exists -- so they are product gaps tracked on the board, not
    // missing tests for existing behavior.
    it('does not tax an exempt client even when a default rate is available', async () => {
        db.rows['clients'] = { is_tax_exempt: true };
        expect(await taxService.calculateTax('client1', 10000, '2023-06-01')).toEqual({ taxAmount: 0, taxRate: 0 });
        expect(db.queriedTables).toEqual(['clients']);
    });
    it.each([-10000, -1, 0])('applies the no-positive-base policy for a simple rate (%s cents)', async amount => {
        expect(await taxService.calculateTax('client1', amount, '2023-06-01')).toEqual({ taxAmount: 0, taxRate: 10 });
    });
    it.each([[1, 1], [9, 1], [11, 2]])('rounds fractional tax cents upward (%s cents)', async (amount, taxAmount) => {
        expect(await taxService.calculateTax('client1', amount, '2023-06-01')).toEqual({ taxAmount, taxRate: 10 });
    });
    // Multi-item invoice tax persistence is exercised in the infrastructure
    // billing/invoices/billingInvoiceGeneration_tax.test.ts suite.
    it('applies reverse charge before looking up an otherwise taxable default rate', async () => {
        mockClientTaxSettings.get.mockResolvedValue({
            tenant: 'test_tenant', client_id: 'client1', tax_rate_id: 'rate1',
            is_reverse_charge_applicable: true,
        });
        expect(await taxService.calculateTax('client1', 10000, '2023-06-01')).toEqual({ taxAmount: 0, taxRate: 0 });
        expect(db.queriedTables).toEqual(['clients']);
    });
    it.each([[10000, 500, 1], [10001, 501, 2], [25000, 2250, 3]])('taxes each reached progressive bracket separately (%s cents)', async (amount, taxAmount, reached) => {
        mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue([
            { tenant: 'test_tenant', tax_rate_threshold_id: 't1', tax_rate_id: 'rate1', min_amount: 0, max_amount: 10000, rate: 5 },
            { tenant: 'test_tenant', tax_rate_threshold_id: 't2', tax_rate_id: 'rate1', min_amount: 10000, max_amount: 20000, rate: 10 },
            { tenant: 'test_tenant', tax_rate_threshold_id: 't3', tax_rate_id: 'rate1', min_amount: 20000, rate: 15 },
        ]);
        const result = await taxService.calculateTax('client1', amount, '2023-06-01');
        expect(result.taxAmount).toBe(taxAmount);
        expect(result.taxRate).toBeCloseTo(taxAmount / amount * 100);
        expect(result.appliedThresholds?.map(t => t.tax_rate_threshold_id)).toEqual(['t1', 't2', 't3'].slice(0, reached));
    });
    it('taxes only the taxable portion when callers calculate mixed components separately', async () => {
        const taxable = await taxService.calculateTax('client1', 10000, '2023-06-01', undefined, true);
        const exempt = await taxService.calculateTax('client1', 20000, '2023-06-01', undefined, false);
        expect(taxable).toEqual({ taxAmount: 1000, taxRate: 10 });
        expect(exempt).toEqual({ taxAmount: 0, taxRate: 0 });
        expect(taxable.taxAmount + exempt.taxAmount).toBe(1000);
    });
});
