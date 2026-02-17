import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaxService } from '@alga-psa/billing/services/taxService';
import { IClientTaxSettings, ITaxRate, ITaxCalculationResult, ITaxComponent, ITaxRateThreshold } from 'server/src/interfaces/tax.interfaces';
import ClientTaxSettings from '@alga-psa/billing/models/clientTaxSettings';
import { ISO8601String } from 'server/src/types/types.d';
import { createTenantKnex } from '@alga-psa/db';

// Set up mock for ClientTaxSettings
vi.mock('@alga-psa/billing/models/clientTaxSettings', () => ({
  default: {
    get: vi.fn(),
    getTaxRate: vi.fn(),
    getCompositeTaxComponents: vi.fn(),
    getTaxRateThresholds: vi.fn(),
    getTaxHolidays: vi.fn(),
  },
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('TaxService', () => {
  let taxService: TaxService;
  const tenantId = 'test-tenant-id';
  const clientId = 'test-client-id';
  const date: ISO8601String = '2024-01-01T00:00:00Z';
  let mockTaxRateResult: ITaxRate;

  beforeEach(() => {
    taxService = new TaxService();
    vi.resetAllMocks();
    mockTaxRateResult = createMockTaxRate(15, false);

    const makeBuilder = (tableName: string) => {
      const builder: {
        where: ReturnType<typeof vi.fn>;
        andWhere: ReturnType<typeof vi.fn>;
        orWhere: ReturnType<typeof vi.fn>;
        whereNull: ReturnType<typeof vi.fn>;
        whereNotNull: ReturnType<typeof vi.fn>;
        whereNot: ReturnType<typeof vi.fn>;
        select: ReturnType<typeof vi.fn>;
        first: ReturnType<typeof vi.fn>;
      } = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockImplementation(function (arg1: unknown) {
          if (typeof arg1 === 'function') {
            arg1.call(builder);
          }
          return builder;
        }),
        orWhere: vi.fn().mockImplementation(function (arg1: unknown) {
          if (typeof arg1 === 'function') {
            arg1.call(builder);
          }
          return builder;
        }),
        whereNull: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          if (tableName === 'clients') {
            return { is_tax_exempt: false };
          }
          if (tableName === 'client_tax_rates') {
            return { tax_rate_id: 'test-tax-rate-id' };
          }
          if (tableName === 'tax_rates') {
            return mockTaxRateResult;
          }
          return undefined;
        }),
      };
      return builder;
    };

    const mockKnex = vi.fn((tableName: string) => makeBuilder(tableName));
    (createTenantKnex as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      tenant: tenantId,
      knex: mockKnex,
    });
  });

  describe('Standard Tax Application', () => {
    it('should correctly apply standard tax rate to a single taxable item', async () => {
        const netAmount = 100;
        const mockTaxSettings = createMockTaxSettings(tenantId, clientId, false);
        const mockTaxRate = createMockTaxRate(15, false);
        mockTaxRateResult = mockTaxRate;
    
        (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
        // Mock getTaxRateThresholds to return an empty array
        (ClientTaxSettings.getTaxRateThresholds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    
        const result = await taxService.calculateTax(clientId, netAmount, date);
    
        expect(result.taxAmount).toBe(15); // 15% of 100
        expect(result.taxRate).toBe(15);
    
        expect(ClientTaxSettings.get).toHaveBeenCalledWith(clientId);
      });

      it('should correctly apply standard tax rate to multiple taxable items', async () => {
        const netAmount = 250; // Simulating multiple items: 100 + 150
        const mockTaxSettings = createMockTaxSettings(tenantId, clientId, false);
        const mockTaxRate = createMockTaxRate(15, false);
        mockTaxRateResult = mockTaxRate;
    
        (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
        // Mock getTaxRateThresholds to return an empty array
        (ClientTaxSettings.getTaxRateThresholds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    
        const result = await taxService.calculateTax(clientId, netAmount, date);
    
        expect(result.taxAmount).toBe(38); // 15% of 250, rounded up
        expect(result.taxRate).toBe(15);
      });

      it('should return zero tax when reverse charge is applicable', async () => {
        const netAmount = 100;
        const mockTaxSettings = createMockTaxSettings(tenantId, clientId, true);
    
        (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
        // Mock getTaxRateThresholds to return an empty array
        (ClientTaxSettings.getTaxRateThresholds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    
        const result = await taxService.calculateTax(clientId, netAmount, date);
    
        expect(result.taxAmount).toBe(0);
        expect(result.taxRate).toBe(0);
      });
  });

  describe('Composite Tax Application', () => {
    it('should correctly apply composite tax rate', async () => {
      const netAmount = 100;
      const mockTaxSettings = createMockTaxSettings(tenantId, clientId, false);
      const mockTaxRate = createMockTaxRate(0, true); // Composite tax
      mockTaxRateResult = mockTaxRate;
      const mockComponents: ITaxComponent[] = [
        { tax_component_id: 'comp1', tax_rate_id: 'test-tax-rate-id', name: 'Component 1', sequence: 1, rate: 5, is_compound: false },
        { tax_component_id: 'comp2', tax_rate_id: 'test-tax-rate-id', name: 'Component 2', sequence: 2, rate: 10, is_compound: true },
      ];

      (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
      (ClientTaxSettings.getTaxRate as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxRate);
      (ClientTaxSettings.getCompositeTaxComponents as ReturnType<typeof vi.fn>).mockResolvedValue(mockComponents);
      (ClientTaxSettings.getTaxHolidays as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await taxService.calculateTax(clientId, netAmount, date);

      // Expected calculation:
      // Component 1: 5% of 100 = 5
      // Component 2: 10% of (100) = 10
      // Total tax: 5 + 10 = 15
      expect(result.taxAmount).toBeCloseTo(15);
      expect(result.taxRate).toBeCloseTo(15);
    });
  });

  describe('Threshold-Based Tax Application', () => {
    it('should correctly apply threshold-based tax rate', async () => {
      const netAmount = 1000;
      const mockTaxSettings = createMockTaxSettings(tenantId, clientId, false);
      const mockTaxRate = createMockTaxRate(0, false); // Simple tax with thresholds
      mockTaxRateResult = mockTaxRate;
      const mockThresholds: ITaxRateThreshold[] = [
        { tax_rate_threshold_id: 'threshold1', tax_rate_id: 'test-tax-rate-id', min_amount: 0, max_amount: 500, rate: 10 },
        { tax_rate_threshold_id: 'threshold2', tax_rate_id: 'test-tax-rate-id', min_amount: 500, max_amount: undefined, rate: 20 },
      ];

      (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
      (ClientTaxSettings.getTaxRate as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxRate);
      (ClientTaxSettings.getTaxRateThresholds as ReturnType<typeof vi.fn>).mockResolvedValue(mockThresholds);

      const result = await taxService.calculateTax(clientId, netAmount, date);

      // Expected calculation:
      // First 500: 10% of 500 = 50
      // Remaining 500: 20% of 500 = 100
      // Total tax: 50 + 100 = 150
      expect(result.taxAmount).toBe(150);
      expect(result.taxRate).toBe(15); // (150 / 1000) * 100
    });

    it('should correctly apply tax rates based on defined thresholds', async () => {
      const mockTaxSettings = createMockTaxSettings(tenantId, clientId, false);
      const mockTaxRate = createMockTaxRate(0, false); // Simple tax with thresholds
      mockTaxRateResult = mockTaxRate;
      const mockThresholds: ITaxRateThreshold[] = [
        { tax_rate_threshold_id: 'threshold1', tax_rate_id: 'test-tax-rate-id', min_amount: 0, max_amount: 1000, rate: 0 },
        { tax_rate_threshold_id: 'threshold2', tax_rate_id: 'test-tax-rate-id', min_amount: 1001, max_amount: 5000, rate: 10 },
        { tax_rate_threshold_id: 'threshold3', tax_rate_id: 'test-tax-rate-id', min_amount: 5001, max_amount: undefined, rate: 15 },
      ];

      (ClientTaxSettings.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxSettings);
      (ClientTaxSettings.getTaxRate as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaxRate);
      (ClientTaxSettings.getTaxRateThresholds as ReturnType<typeof vi.fn>).mockResolvedValue(mockThresholds);

      // Test case 1: Below first threshold
      const result1 = await taxService.calculateTax(clientId, 800, date);
      expect(result1.taxAmount).toBe(0);
      expect(result1.taxRate).toBe(0);

      // Test case 2: Within second threshold
      const result2 = await taxService.calculateTax(clientId, 3000, date);
      expect(result2.taxAmount).toBe(200); // 10% of 3000-1000 = 200
      expect(result2.taxRate).toBeCloseTo(6.67);

      // Test case 3: Above highest threshold
      const result3 = await taxService.calculateTax(clientId, 6000, date);
      expect(result3.taxAmount).toBe(551); // 0% of 1000 + 10% of 3999 + 15% of 1001, rounded up
      expect(result3.taxRate).toBeCloseTo(9.18, 2);
    });
  });
});

function createMockTaxSettings(tenantId: string, clientId: string, isReverseCharge: boolean): IClientTaxSettings {
  return {
    tenant: tenantId,
    client_id: clientId,
    tax_rate_id: 'test-tax-rate-id',
    is_reverse_charge_applicable: isReverseCharge,
  };
}

function createMockTaxRate(percentage: number, isComposite: boolean): ITaxRate {
  return {
    tax_rate_id: 'test-tax-rate-id',
    tax_percentage: percentage,
    is_composite: isComposite,
    tax_type: 'VAT',
    country_code: 'US',
    is_reverse_charge_applicable: false,
    start_date: '2024-01-01',
    is_active: true,
    name: 'Test Tax Rate',
  };
}
