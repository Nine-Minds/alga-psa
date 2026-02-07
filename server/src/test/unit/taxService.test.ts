import { TaxService } from '../../lib/services/taxService';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '../../interfaces/tax.interfaces';
import ClientTaxSettings from '@alga-psa/billing/models/clientTaxSettings';

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll, Mocked } from 'vitest';

vi.mock('@alga-psa/billing/models/clientTaxSettings');

describe('TaxService', () => {
    let taxService: TaxService;
    const mockClientTaxSettings = ClientTaxSettings as Mocked<typeof ClientTaxSettings>;

    beforeEach(() => {
        taxService = new TaxService('test_tenant');
        vi.clearAllMocks();
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
            mockClientTaxSettings.getTaxRate.mockResolvedValue(mockTaxRate);
            mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue([]);

            const result = await taxService.calculateTax('client1', 100, '2023-06-01');

            expect(result.taxAmount).toBe(10);
            expect(result.taxRate).toBe(10);
        });

        it.todo('should calculate composite tax correctly', async () => {
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
            mockClientTaxSettings.getTaxRate.mockResolvedValue(mockTaxRate);
            mockClientTaxSettings.getCompositeTaxComponents.mockResolvedValue(mockTaxComponents);
            mockClientTaxSettings.getTaxHolidays.mockResolvedValue([]);

            const result = await taxService.calculateTax('client1', 100, '2023-06-01');

            // Expected calculation:
            // State Tax: 100 * 5% = 5
            // City Tax: (100 + 5) * 2% = 2.1
            // Total Tax: 5 + 2.1 = 7.1
            expect(result.taxAmount).toBeCloseTo(7.1, 2);
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
            mockClientTaxSettings.getTaxRate.mockResolvedValue(mockTaxRate);
            mockClientTaxSettings.getTaxRateThresholds.mockResolvedValue(mockThresholds);

            const result = await taxService.calculateTax('client1', 250, '2023-06-01');

            // Expected calculation:
            // 0-100: 100 * 5% = 5
            // 100-200: 100 * 10% = 10
            // 200-250: 50 * 15% = 7.5
            // Total Tax: 5 + 10 + 7.5 = 22.5
            expect(result.taxAmount).toBeCloseTo(22.5, 2);
            expect(result.taxRate).toBeCloseTo(9, 2); // 22.5 / 250 = 9%
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
            mockClientTaxSettings.getTaxRate.mockResolvedValue(mockTaxRate);
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
            mockClientTaxSettings.getTaxRate.mockResolvedValue(mockTaxRate);

            const result = await taxService.getTaxType('client1');

            expect(result).toBe('VAT');
        });
    });

    it.todo('should handle overlapping tax holidays correctly');
    it.todo('should apply the correct tax rate based on the transaction date');
    it.todo('should handle tax exemptions correctly');
    it.todo('should calculate taxes correctly for negative amounts (refunds)');
    it.todo('should handle tax rounding correctly for small amounts');
    it.todo('should apply the correct tax rate for international transactions');
    it.todo('should handle tax calculation for multi-item invoices with different tax rates');
    it.todo('should apply tax caps correctly when present');
    it.todo('should handle tax calculation for different currencies correctly');
    it.todo('should apply reverse charge mechanism correctly for B2B transactions');
    it.todo('should handle tax calculation for subscriptions spanning multiple tax periods');
    it.todo('should apply progressive tax rates correctly');
    it.todo('should handle tax calculation for items with mixed taxable and non-taxable components');
});
