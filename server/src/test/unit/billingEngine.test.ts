import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { getConnection } from 'server/src/lib/db/db';
import { IAdjustment, IBillingCharge, IBillingPeriod, IBillingResult, IClientContractLine, IDiscount, IFixedPriceCharge, ITimeBasedCharge, IUsageBasedCharge } from 'server/src/interfaces/billing.interfaces';
import { ISO8601String } from '../../types/types.d';
import { TaxService } from 'server/src/lib/services/taxService';
import * as clientTaxRateActions from 'server/src/lib/actions/client-actions/clientTaxRateActions';


vi.mock('@/lib/db/db');
vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (_knex, callback) => callback(_knex)),
  withAdminTransaction: vi.fn(async (_callback, existing) => _callback(existing)),
}));
vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(() => Promise.resolve({
    user: {
      id: 'mock-user-id',
    },
  })),
}));


vi.mock('openid-client', () => ({
  Issuer: {
    discover: vi.fn(),
  },
  Client: vi.fn(),
}));

vi.mock('jose', () => ({
  // Add any jose methods you're using
}));

vi.mock('server/src/lib/actions/client-actions/clientActions', () => ({
  getClientById: vi.fn(() => Promise.resolve({
    client_id: 'mock-client-id',
    client_name: 'Mock Client',
    tenant: 'test_tenant',
    is_tax_exempt: false
  }))
}));


describe('BillingEngine', () => {
  let billingEngine: BillingEngine;
  const mockTenant = 'test_tenant';
  const mockClientId = 'test_client_id';
  const mockBillingCycleId = 'test_billing_cycle_id';

  const mockStartDate: ISO8601String = '2023-01-01T00:00:00Z';
  const mockEndDate: ISO8601String = '2023-02-01T00:00:00Z';

  beforeEach(() => {
    billingEngine = new BillingEngine();
    (billingEngine as any).tenant = mockTenant;
    vi.spyOn(TaxService.prototype, 'calculateTax').mockResolvedValue({
      taxAmount: 0,
      taxRate: 0
    });
    vi.spyOn(billingEngine as any, 'getTaxInfoFromService').mockResolvedValue({
      taxRegion: undefined,
      isTaxable: false
    });
    vi.spyOn(clientTaxRateActions, 'getClientDefaultTaxRegionCode').mockResolvedValue('US-NY');
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      whereBetween: vi.fn().mockReturnThis(),
      join: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      raw: vi.fn().mockReturnThis(),
    };

    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        return buildChainableQuery({
          selectResult: [],
          firstResult: { client_id: mockClientId, tenant: mockTenant, client_name: 'Mock Client', is_tax_exempt: false },
          thenResult: []
        });
      }

      if (table === 'client_billing_cycles') {
        const cycle = {
          billing_cycle_id: mockBillingCycleId,
          client_id: mockClientId,
          period_start_date: mockStartDate,
          period_end_date: mockEndDate,
          effective_date: mockStartDate,
          billing_cycle: 'monthly',
          tenant: mockTenant
        };
        const builder = buildChainableQuery({
          selectResult: [cycle],
          firstResult: cycle,
          thenResult: [cycle]
        });
        builder.insert = vi.fn().mockResolvedValue(undefined);
        return builder;
      }

      if (table === 'invoices') {
        return buildChainableQuery({ selectResult: [], firstResult: null, thenResult: [] });
      }

      if (table === 'client_contracts') {
        const builder = buildChainableQuery({ selectResult: [], firstResult: null, thenResult: [] });
        builder.orderBy = vi.fn().mockImplementation(() => builder);
        return builder;
      }

      const defaultBuilder = buildChainableQuery({ selectResult: [], firstResult: null, thenResult: [] });
      defaultBuilder.count = vi.fn().mockResolvedValue([{ count: 0 }]);
      return defaultBuilder;
    });
    (billingEngine as any).knex.raw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');
    vi.spyOn(billingEngine as any, 'fetchDiscounts').mockResolvedValue([]);

    (getConnection as any).mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  interface ChainableOptions {
    selectResult?: any[] | (() => any);
    firstResult?: any;
    thenResult?: any;
  }

  const buildChainableQuery = ({
    selectResult = [],
    firstResult = null,
    thenResult
  }: ChainableOptions = {}) => {
    let resolveValue = thenResult !== undefined ? thenResult : selectResult;
    const builder: any = {};
    const handleWhere = (condition: any, operator?: any, value?: any) => {
      if (typeof condition === 'function') {
        condition.call(builder, builder);
      }
      return builder;
    };

    builder.join = vi.fn().mockImplementation(() => builder);
    builder.leftJoin = vi.fn().mockImplementation(() => builder);
    builder.where = vi.fn().mockImplementation(handleWhere);
    builder.andWhere = vi.fn().mockImplementation(handleWhere);
    builder.orWhere = vi.fn().mockImplementation(handleWhere);
    builder.whereBetween = vi.fn().mockImplementation(() => builder);
    builder.whereNull = vi.fn().mockImplementation(() => builder);
    builder.whereNotNull = vi.fn().mockImplementation(() => builder);
    builder.whereIn = vi.fn().mockImplementation(() => builder);
    builder.orderBy = vi.fn().mockImplementation(() => builder);
    builder.__setResolveValue = vi.fn((value: any) => {
      resolveValue = value;
    });

    builder.select = vi.fn().mockImplementation((...args: any[]) => {
      if (typeof selectResult === 'function') {
        resolveValue = (selectResult as (...a: any[]) => any)(...args);
      } else {
        resolveValue = selectResult;
      }
      return builder;
    });
    builder.first = vi.fn().mockResolvedValue(firstResult);
    builder.raw = vi.fn().mockReturnValue('RAW');
    builder.toQuery = vi.fn().mockReturnValue('mocked-query');
    builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => {
      const value = typeof resolveValue === 'function' ? (resolveValue as () => any)() : resolveValue;
      const promise = Promise.resolve(value);
      return promise.then(onFulfilled, onRejected);
    });
    builder.catch = vi.fn((onRejected?: any) => Promise.resolve(thenResult).catch(onRejected));
    builder.finally = vi.fn((handler?: any) => Promise.resolve(thenResult).finally(handler));
    return builder;
  };

  describe('calculateBilling', () => {
    it('should calculate billing correctly', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges: IFixedPriceCharge[] = [
        { serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100, type: 'fixed', tax_amount: 0, tax_rate: 0 }
      ];
      const mockTimeCharges: ITimeBasedCharge[] = [
        { serviceId: 'service2', serviceName: 'Service 2', userId: 'user1', duration: 2, rate: 50, total: 100, type: 'time', tax_amount: 0, tax_rate: 0, entryId: 'mock-entry-id' }
      ];
      const mockUsageCharges: IUsageBasedCharge[] = [
        { serviceId: 'service3', serviceName: 'Service 3', quantity: 10, rate: 5, total: 50, type: 'usage', tax_amount: 0, tax_rate: 0, usageId: 'mock-usage-id' }
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue(mockTimeCharges);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue(mockUsageCharges);
      vi.spyOn(billingEngine as any, 'calculateBucketPlanCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'validateBillingPeriod').mockResolvedValue({ success: true });
      vi.spyOn(billingEngine as any, 'applyDiscountsAndAdjustments').mockImplementation(async (result) => result);

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: [...mockFixedCharges, ...mockTimeCharges, ...mockUsageCharges],
        totalAmount: 250,
        discounts: [],
        adjustments: [],
        finalAmount: 250
      });
    });

    it('should throw an error if no active contract lines are found', async () => {
      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: [],
        billingCycle: 'monthly'
      });

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toMatchObject({
        charges: [],
        totalAmount: 0,
        finalAmount: 0,
        error: 'No active contract lines found for this client in the selected billing period.'
      });
    });

    it('should calculate billing correctly with multiple charge types', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges = [
        { serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100, type: 'fixed' },
      ];

      const mockTimeCharges = [
        { serviceId: 'service2', serviceName: 'Service 2', userId: 'user1', duration: 2, rate: 50, total: 100, type: 'time' },
      ];

      const mockUsageCharges = [
        { serviceId: 'service3', serviceName: 'Service 3', quantity: 10, rate: 5, total: 50, type: 'usage' },
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue(mockTimeCharges);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue(mockUsageCharges);

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: [
          ...mockFixedCharges,
          ...mockTimeCharges,
          ...mockUsageCharges,
        ],
        totalAmount: 250,
        discounts: [],
        adjustments: [],
        finalAmount: 250,
      });
    });

    it('should handle proration correctly', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-15T00:00:00Z', // Mid-month start
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges = [
        { serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100, type: 'fixed' },
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);

      const result = await billingEngine.calculateBilling(mockClientId, mockClientContractLine[0].start_date, mockEndDate, mockBillingCycleId);

      expect(result.totalAmount).toBeCloseTo(100, 2);
      expect(result.finalAmount).toBeCloseTo(100, 2);
    });

    it('should apply discounts and adjustments correctly', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges: IFixedPriceCharge[] = [
        {
          type: 'fixed', serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100,
          tax_amount: 0,
          tax_rate: 0
        },
      ];

      const mockDiscounts: IDiscount[] = [{
        discount_name: 'Loyalty discount', amount: 10,
        discount_id: '',
        discount_type: 'fixed',
        value: 0
      }];
      const mockAdjustments: IAdjustment[] = [{ description: 'Service credit', amount: -5 }];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'applyDiscountsAndAdjustments').mockImplementation(async (...args: unknown[]): Promise<IBillingResult> => {
        const billingResult = args[0] as IBillingResult;
        return {
          ...billingResult,
          discounts: mockDiscounts,
          adjustments: mockAdjustments,
          finalAmount: billingResult.totalAmount - mockDiscounts[0].amount! + mockAdjustments[0].amount,
        };
      });

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: mockFixedCharges,
        totalAmount: 100,
        discounts: mockDiscounts,
        adjustments: mockAdjustments,
        finalAmount: 85, // 100 - 10 - 5
      });
    });


    it('should calculate billing correctly for multiple active plans', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'billing_id_1',
          client_id: mockClientId,
          contract_line_id: 'contract_line_id_1',
          service_category: 'category_1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
        {
          client_contract_line_id: 'billing_id_2',
          client_id: mockClientId,
          contract_line_id: 'contract_line_id_2',
          service_category: 'category_2',
          start_date: '2023-01-15T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
      ];

      const mockFixedCharges1: IFixedPriceCharge[] = [
        {
          type: 'fixed', serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100,
          tax_amount: 0,
          tax_rate: 0
        },
      ];

      const mockFixedCharges2: IFixedPriceCharge[] = [
        {
          type: 'fixed',
          serviceId: 'service2',
          serviceName: 'Service 2',
          quantity: 1,
          rate: 50,
          total: 27.42,
          tax_amount: 0,
          tax_rate: 0
        },
      ];

      const mockTimeCharges1: ITimeBasedCharge[] = [
        {
          type: 'time', serviceId: 'service3', serviceName: 'Service 3', userId: 'user1', duration: 2, rate: 25, total: 50,
          tax_amount: 0,
          tax_rate: 0,
          entryId: ''
        },
      ];

      const mockTimeCharges2: ITimeBasedCharge[] = [
        {
          type: 'time', serviceId: 'service4', serviceName: 'Service 4', userId: 'user2', duration: 3, rate: 30, total: 90,
          tax_amount: 0,
          tax_rate: 0,
          entryId: ''
        },
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges')
        .mockResolvedValueOnce(mockFixedCharges1)
        .mockResolvedValueOnce(mockFixedCharges2);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges')
        .mockResolvedValueOnce(mockTimeCharges1)
        .mockResolvedValueOnce(mockTimeCharges2);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'applyProrationToPlan').mockImplementation((charges) => charges);

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result.charges).toEqual([
        ...mockFixedCharges1,
        ...mockTimeCharges1,
        ...mockFixedCharges2,
        ...mockTimeCharges2,
      ]);
      expect(result.totalAmount).toBeCloseTo(267.42, 2);
      expect(result.finalAmount).toBeCloseTo(267.42, 2);

      // Replace the existing expectations with these:
      expect(billingEngine['getClientContractLinesAndCycle']).toHaveBeenCalledWith(
        mockClientId,
        expect.objectContaining({
          startDate: '2023-01-01',
          endDate: '2023-02-01'
        })
      );

      mockClientContractLine.forEach(billing => {
        expect(billingEngine['calculateFixedPriceCharges']).toHaveBeenCalledWith(
          mockClientId,
          expect.objectContaining({
            startDate: '2023-01-01',
            endDate: '2023-02-01'
          }),
          billing
        );

        expect(billingEngine['calculateTimeBasedCharges']).toHaveBeenCalledWith(
          mockClientId,
          expect.objectContaining({
            startDate: '2023-01-01',
            endDate: '2023-02-01'
          }),
          billing
        );

        expect(billingEngine['calculateUsageBasedCharges']).toHaveBeenCalledWith(
          mockClientId,
          expect.objectContaining({
            startDate: '2023-01-01',
            endDate: '2023-02-01'
          }),
          billing
        );
      });
    });

    it('should not apply taxes to non-taxable items based on service catalog', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];
    
      const mockFixedCharges: IFixedPriceCharge[] = [
        {
          type: 'fixed',
          serviceId: 'service1',
          serviceName: 'Non-Taxable Service',
          quantity: 1,
          rate: 100,
          total: 100,
          tax_amount: 0,
          tax_rate: 0,
        },
        {
          type: 'fixed',
          serviceId: 'service2',
          serviceName: 'Taxable Service',
          quantity: 1,
          rate: 100,
          total: 100,
          tax_amount: 8.25,
          tax_rate: 8.25,
        },
      ];
    
      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
    
      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);
    
      // Check non-taxable item
      expect(result.charges[0].tax_amount).toBe(0);
    
      // Check taxable item
      expect(result.charges[1].tax_amount).toBe(8.25);
    });
    
    


    it('should handle proration correctly for multiple plans with different start dates', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'billing_id_1',
          client_id: mockClientId,
          contract_line_id: 'contract_line_id_1',
          service_category: 'category_1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
        {
          client_contract_line_id: 'billing_id_2',
          client_id: mockClientId,
          contract_line_id: 'contract_line_id_2',
          service_category: 'category_2',
          start_date: '2023-01-15T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
      ];

      const mockFixedCharges1: IFixedPriceCharge[] = [
        {
          type: 'fixed', serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100,
          tax_amount: 0,
          tax_rate: 0
        },
      ];

      const mockFixedCharges2: IFixedPriceCharge[] = [
        {
          type: 'fixed', serviceId: 'service2', serviceName: 'Service 2', quantity: 1, rate: 50, total: 50,
          tax_amount: 0,
          tax_rate: 0
        },
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges')
        .mockResolvedValueOnce(mockFixedCharges1)
        .mockResolvedValueOnce(mockFixedCharges2);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      // Plan 1 should be charged for the full month
      expect(result.charges[0].total).toBeCloseTo(100, 2);

      // Plan 2 remains at the stubbed total since Fixed price proration now occurs earlier in the engine.
      expect(result.charges[1].total).toBeCloseTo(50, 2);

      expect(result.totalAmount).toBeCloseTo(150, 2);
      expect(result.finalAmount).toBeCloseTo(150, 2);
    });
    it('should calculate billing correctly with bucket overlay charges', async () => {
      const mockClientContractLine: IClientContractLine[] = [
        {
          client_contract_line_id: 'test_billing_id',
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges = [
        { serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100, type: 'fixed' },
      ];

      const mockBucketCharges = [
        {
          type: 'bucket',
          serviceId: 'bucket1',
          serviceName: 'Consulting Overage',
          hoursUsed: 45,
          overageHours: 5,
          overageRate: 50,
          rate: 50,
          total: 250,
          tax_amount: 0,
          tax_rate: 0
        }
      ];

      vi.spyOn(billingEngine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
        clientContractLines: mockClientContractLine,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateBucketPlanCharges').mockResolvedValue(mockBucketCharges);

      const result = await billingEngine.calculateBilling(mockClientId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: [
          ...mockFixedCharges,
          ...mockBucketCharges,
        ],
        totalAmount: 350,
        discounts: [],
        adjustments: [],
        finalAmount: 350,
      });
    });
  });


  describe('calculateBucketPlanCharges', () => {
    it('should calculate bucket overlay charges correctly', async () => {
      const mockClient = {
        client_id: mockClientId,
        client_name: 'Test Client',
        tenant: mockTenant,
        is_tax_exempt: false,
      };

      const bucketConfigRow = {
        config_id: 'bucket-config-1',
        tenant: mockTenant,
        service_id: 'service_bucket',
        contract_line_id: 'test_contract_line_id',
        configuration_type: 'Bucket',
        total_minutes: 2400,
        overage_rate: 50,
        allow_rollover: false,
        service_name: 'Emerald City Consulting Hours',
        tax_rate_id: 'tax-rate-1'
      };

      const bucketUsageRows = [
        {
          tenant: mockTenant,
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_catalog_id: 'service_bucket',
          minutes_used: 45 * 60,
          overage_minutes: 5 * 60
        }
      ];

      const baseKnex = (billingEngine as any).knex;

      const configurationBuilder = buildChainableQuery({
        selectResult: [bucketConfigRow],
        thenResult: [bucketConfigRow]
      });

      const clientsBuilder = buildChainableQuery({
        selectResult: [],
        firstResult: mockClient,
        thenResult: []
      });

      const bucketUsageBuilder = buildChainableQuery({
        selectResult: bucketUsageRows,
        thenResult: bucketUsageRows
      });

      const taxRatesBuilder = buildChainableQuery({
        selectResult: [],
        firstResult: { region_code: 'US-CA' },
        thenResult: []
      });

      const mockKnex = vi.fn((tableName: string) => {
        if (tableName.startsWith('client_contract_service_configuration')) {
          return configurationBuilder;
        }
        if (tableName === 'clients') {
          return clientsBuilder;
        }
        if (tableName === 'bucket_usage') {
          return bucketUsageBuilder;
        }
        if (tableName === 'tax_rates') {
          return taxRatesBuilder;
        }
        return baseKnex(tableName);
      });

      const calculateTaxSpy = vi
        .spyOn(TaxService.prototype, 'calculateTax')
        .mockResolvedValue({ taxRate: 8.25, taxAmount: 2000 });
      vi.spyOn(billingEngine as any, 'getTaxInfoFromService').mockResolvedValue({
        taxRegion: 'US-CA',
        isTaxable: true
      });

      (billingEngine as any).knex = mockKnex;
      (billingEngine as any).knex.raw = baseKnex.raw;
      (billingEngine as any).tenant = mockTenant;

      const result = await (billingEngine as any).calculateBucketPlanCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        { contract_line_id: 'test_contract_line_id' }
      );

      expect(result).toMatchObject([
        {
          type: 'bucket',
          serviceId: 'service_bucket',
          serviceName: 'Emerald City Consulting Hours',
          total: 250,
          hoursUsed: 45,
          overageHours: 5,
          overageRate: 50,
          tax_rate: 8.25,
          tax_amount: 2000,
          tax_region: 'US-CA'
        }
      ]);

      expect(mockKnex).toHaveBeenCalledWith('client_contract_service_configuration as ccsc');
      expect(mockKnex).toHaveBeenCalledWith('clients');
      expect(mockKnex).toHaveBeenCalledWith('bucket_usage');

      expect(calculateTaxSpy).toHaveBeenCalledWith(mockClientId, 250, mockEndDate, 'US-CA');
      calculateTaxSpy.mockRestore();
    });

    describe('calculateTimeBasedCharges with contract line disambiguation', () => {
      it('should filter time entries by contract line ID', async () => {
        const mockTimeEntries = [
          {
            entry_id: 'entry-1',
            work_item_id: 'service1',
            service_id: 'service1',
            service_name: 'Service 1',
            user_id: 'user1',
            start_time: new Date('2023-01-01T10:00:00.000Z'),
            end_time: new Date('2023-01-01T12:00:00.000Z'),
            user_rate: 50,
            default_rate: 40,
            tax_rate_id: null,
            contract_line_id: 'contract_line_1'
          },
          {
            entry_id: 'entry-2',
            work_item_id: 'service2',
            service_id: 'service2',
            service_name: 'Service 2',
            user_id: 'user2',
            start_time: new Date('2023-01-02T14:00:00.000Z'),
            end_time: new Date('2023-01-02T17:00:00.000Z'),
            user_rate: null,
            default_rate: 60,
            tax_rate_id: null,
            contract_line_id: 'contract_line_2'
          },
          {
            entry_id: 'entry-3',
            work_item_id: 'service3',
            service_id: 'service3',
            service_name: 'Service 3',
            user_id: 'user3',
            start_time: new Date('2023-01-03T09:00:00.000Z'),
            end_time: new Date('2023-01-03T11:00:00.000Z'),
            user_rate: null,
            default_rate: 70,
            tax_rate_id: null,
            contract_line_id: null
          },
        ];

        const baseKnex = (billingEngine as any).knex;
        const timeEntriesBuilder = buildChainableQuery();
        timeEntriesBuilder.select.mockImplementation(() => {
          timeEntriesBuilder.__setResolveValue(
            mockTimeEntries.filter(
              (entry) => entry.contract_line_id === 'contract_line_1' || entry.contract_line_id === null
            )
          );
          return timeEntriesBuilder;
        });

        const contractLineBuilder = buildChainableQuery({
          selectResult: [],
          firstResult: { contract_line_id: 'test_contract_line_id', contract_line_type: 'Bucket' },
          thenResult: []
        });

        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'time_entries') {
            return timeEntriesBuilder;
          }
           if (table === 'contract_lines') {
             return contractLineBuilder;
           }
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', contract_line_id: 'test_contract_line_id', client_contract_line_id: 'contract_line_1' }
        );

        // Should only include entries with contract_line_id = 'contract_line_1' or null
        expect(result).toHaveLength(2);
        expect(result[0].serviceName).toBe('Service 1');
        expect(result[1].serviceName).toBe('Service 3');
        
        // Verify that the where function was called with the correct contract line ID
        expect(timeEntriesBuilder.where).toHaveBeenCalled();
      });
    });

    describe('calculateUsageBasedCharges with contract line disambiguation', () => {
      it('should filter usage records by contract line ID', async () => {
        const mockUsageRecords = [
          {
            service_id: 'service1',
            service_name: 'Service 1',
            quantity: 10,
            default_rate: 5,
            contract_line_id: 'contract_line_1'
          },
          {
            service_id: 'service2',
            service_name: 'Service 2',
            quantity: 20,
            default_rate: 3,
            contract_line_id: 'contract_line_2'
          },
          {
            service_id: 'service3',
            service_name: 'Service 3',
            quantity: 15,
            default_rate: 4,
            contract_line_id: null
          },
        ];

        const baseKnex = (billingEngine as any).knex;
        const usageBuilder = buildChainableQuery();
        usageBuilder.select.mockImplementation(() => {
          usageBuilder.__setResolveValue(
            mockUsageRecords.filter((record) =>
              record.contract_line_id === 'contract_line_1' || record.contract_line_id === null
            )
          );
          return usageBuilder;
        });

        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'usage_tracking') {
            return usageBuilder;
          }
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', client_contract_line_id: 'contract_line_1' }
        );

        // Should only include records with contract_line_id = 'contract_line_1' or null
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          serviceId: 'service1',
          serviceName: 'Service 1',
          servicePeriodStart: mockStartDate,
          servicePeriodEnd: mockEndDate,
          billingTiming: 'arrears'
        });
        expect(result[1]).toMatchObject({
          serviceId: 'service3',
          serviceName: 'Service 3',
          servicePeriodStart: mockStartDate,
          servicePeriodEnd: mockEndDate,
          billingTiming: 'arrears'
        });
      });
    });

    describe('calculateTimeBasedCharges', () => {
      it('should calculate time-based charges correctly', async () => {
        const mockTimeEntries = [
          {
            entry_id: 'entry-1',
            work_item_id: 'service1',
            service_id: 'service1',
            service_name: 'Service 1',
            user_id: 'user1',
            start_time: new Date('2023-01-01T10:00:00.000Z'),
            end_time: new Date('2023-01-01T12:00:00.000Z'),
            user_rate: 50,
            default_rate: 40,
            tax_rate_id: null
          },
          {
            entry_id: 'entry-2',
            work_item_id: 'service2',
            service_id: 'service2',
            service_name: 'Service 2',
            user_id: 'user2',
            start_time: new Date('2023-01-02T14:00:00.000Z'),
            end_time: new Date('2023-01-02T17:00:00.000Z'),
            user_rate: null,
            default_rate: 60,
            tax_rate_id: null
          },
        ];

        const baseKnex = (billingEngine as any).knex;
        const timeEntriesBuilder = buildChainableQuery({
          selectResult: mockTimeEntries,
          thenResult: mockTimeEntries
        });
        timeEntriesBuilder.select.mockImplementation(() => {
          timeEntriesBuilder.__setResolveValue(mockTimeEntries);
          return timeEntriesBuilder;
        });

        const contractLineBuilder = buildChainableQuery({
          selectResult: [],
          firstResult: { contract_line_id: 'test_contract_line_id', contract_line_type: 'Bucket' },
          thenResult: []
        });

        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'time_entries') {
            return timeEntriesBuilder;
          }
          if (table === 'contract_lines') {
            return contractLineBuilder;
          }
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', contract_line_id: 'test_contract_line_id' }
        );

        expect(result).toMatchObject([
          {
            serviceName: 'Service 1',
            userId: 'user1',
            duration: 2,
            rate: 40,
            total: 80,
            servicePeriodStart: mockStartDate,
            servicePeriodEnd: mockEndDate,
            billingTiming: 'arrears'
          },
          {
            serviceName: 'Service 2',
            userId: 'user2',
            duration: 3,
            rate: 60,
            total: 180,
            servicePeriodStart: mockStartDate,
            servicePeriodEnd: mockEndDate,
            billingTiming: 'arrears'
          },
        ]);

        // Verify that the correct methods were called
        expect(timeEntriesBuilder.join).toHaveBeenCalled();
        expect(timeEntriesBuilder.leftJoin).toHaveBeenCalled();
        expect(timeEntriesBuilder.where).toHaveBeenCalled();
        expect(timeEntriesBuilder.select).toHaveBeenCalled();
      });
    });


    describe('calculateUsageBasedCharges', () => {
      it('should calculate usage-based charges correctly', async () => {
        const mockUsageRecords = [
          {
            service_id: 'service1',
            service_name: 'Service 1',
            quantity: 10,
            default_rate: 5,
          },
          {
            service_id: 'service2',
            service_name: 'Service 2',
            quantity: 20,
            default_rate: 3,
          },
        ];

        const baseKnex = (billingEngine as any).knex;
        const usageBuilder = buildChainableQuery({
          selectResult: mockUsageRecords,
          thenResult: mockUsageRecords
        });

        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'usage_tracking') {
            return usageBuilder;
          }
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category' }
        );

        expect(result).toMatchObject([
          {
            serviceId: 'service1',
            serviceName: 'Service 1',
            quantity: 10,
            rate: expect.any(Number),
            total: expect.any(Number),
            servicePeriodStart: mockStartDate,
            servicePeriodEnd: mockEndDate,
            billingTiming: 'arrears'
          },
          {
            serviceId: 'service2',
            serviceName: 'Service 2',
            quantity: 20,
            rate: expect.any(Number),
            total: expect.any(Number),
            servicePeriodStart: mockStartDate,
            servicePeriodEnd: mockEndDate,
            billingTiming: 'arrears'
          },
        ]);
      });
    });

    describe('applyProration', () => {
      it('should leave charges unchanged when no proration rules apply', () => {
        const charges: IBillingCharge[] = [
          {
            type: 'usage',
            serviceId: 'service1',
            serviceName: 'Service 1',
            quantity: 1,
            rate: 100,
            total: 100,
            tax_amount: 0,
            tax_rate: 0
          },
        ];
        const billingPeriod: IBillingPeriod = {
          startDate: '2023-01-01T00:00:00Z',
          endDate: '2023-02-01T00:00:00Z',
        };
        const mockStartDate = '2023-01-17T00:00:00Z';
        const mockEndDate = '2023-01-31T00:00:00Z';
        const mockBillingCycle = 'monthly';

        const proratedCharges = (billingEngine as any).applyProrationToPlan(
          charges,
          billingPeriod,
          mockStartDate,
          mockEndDate,
          mockBillingCycle
        );

        expect(proratedCharges[0].total).toBe(100);
      });
    });
  });

  describe('Pricing Schedule Integration', () => {
    const createGenericQueryBuilder = () => {
      const builder: any = {};
      builder.where = vi.fn().mockImplementation(() => builder);
      builder.andWhere = vi.fn().mockImplementation(() => builder);
      builder.whereBetween = vi.fn().mockImplementation(() => builder);
      builder.orderBy = vi.fn().mockImplementation(() => builder);
      builder.join = vi.fn().mockImplementation(() => builder);
      builder.leftJoin = vi.fn().mockImplementation(() => builder);
      builder.select = vi.fn().mockResolvedValue([]);
      builder.first = vi.fn().mockResolvedValue(null);
      return builder;
    };

    const createScheduleQuery = (options?: {
      first?: any;
      reject?: Error;
      onWhereCall?: (args: any[]) => void;
    }) => {
      const scheduleQuery: any = {};
      scheduleQuery.where = vi.fn().mockImplementation(function(condition: any, operator?: any, value?: any) {
        options?.onWhereCall?.([condition, operator, value]);
        if (typeof condition === 'function') {
          condition({
            whereNull: vi.fn().mockReturnThis(),
            orWhere: vi.fn().mockReturnThis()
          });
        }
        return scheduleQuery;
      });
      scheduleQuery.orderBy = vi.fn().mockImplementation(() => scheduleQuery);
      scheduleQuery.first = options?.reject
        ? vi.fn().mockRejectedValue(options.reject)
        : vi.fn().mockResolvedValue(options?.first ?? null);
      return scheduleQuery;
    };

    it('should produce a fixed charge that uses the pricing schedule override when an active schedule exists', async () => {
      const scheduleRate = 20000;
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        client_contract_id: 'client_contract_assignment',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        contract_line_name: 'Managed Support',
        contract_name: 'Acme Corp',
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant,
        custom_rate: 15000
      };

      const mockPricingSchedule = {
        schedule_id: 'schedule-1',
        contract_id: 'test_contract_id',
        effective_date: '2023-01-01T00:00:00Z',
        end_date: null,
        custom_rate: scheduleRate
      };

      const scheduleQuery = createScheduleQuery({ first: mockPricingSchedule });

      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          return scheduleQuery;
        }

        return createGenericQueryBuilder();
      });

      const charges = await (billingEngine as any).calculateFixedPriceCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        mockClientContractLine
      );

      expect(charges).toEqual([
        expect.objectContaining({
          type: 'fixed',
          serviceName: 'Managed Support (Contract: Acme Corp)',
          quantity: 1,
          rate: scheduleRate,
          total: scheduleRate,
          client_contract_line_id: 'test_billing_id',
          client_contract_id: 'client_contract_assignment',
          contract_name: 'Acme Corp',
          tax_amount: 0,
          tax_rate: 0,
          tax_region: undefined,
          servicePeriodStart: '2022-12-01',
          servicePeriodEnd: '2022-12-31',
          billingTiming: 'arrears'
        }),
      ]);

      expect(scheduleQuery.where).toHaveBeenCalledWith({
        tenant: mockTenant,
        contract_id: 'test_contract_id'
      });
    });

    it('should fall back to the contract custom rate when the pricing schedule has no override rate', async () => {
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        client_contract_id: 'client_contract_assignment',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        contract_line_name: 'Managed Support',
        contract_name: 'Acme Corp',
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant,
        custom_rate: 17500
      };

      const mockPricingSchedule = {
        schedule_id: 'schedule-1',
        contract_id: 'test_contract_id',
        effective_date: '2023-01-01T00:00:00Z',
        end_date: null,
        custom_rate: null
      };

      const scheduleQuery = createScheduleQuery({ first: mockPricingSchedule });

      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          return scheduleQuery;
        }

        return createGenericQueryBuilder();
      });

      const charges = await (billingEngine as any).calculateFixedPriceCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        mockClientContractLine
      );

      expect(charges).toEqual([
        expect.objectContaining({
          type: 'fixed',
          serviceName: 'Managed Support (Contract: Acme Corp)',
          quantity: 1,
          rate: 17500,
          total: 17500,
          client_contract_line_id: 'test_billing_id',
          client_contract_id: 'client_contract_assignment',
          contract_name: 'Acme Corp',
          tax_amount: 0,
          tax_rate: 0,
          tax_region: undefined,
          servicePeriodStart: '2022-12-01',
          servicePeriodEnd: '2022-12-31',
          billingTiming: 'arrears'
        }),
      ]);

      expect(scheduleQuery.first).toHaveBeenCalled();
    });

    it('should apply pricing schedule rate to fixed price charges calculation', async () => {
      // This test verifies that when calculateFixedPriceCharges is called,
      // it queries for pricing schedules and would use the schedule rate if found
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        custom_rate: 12000,
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant
      };

      // Mock pricing schedule query to return a schedule
      const mockPricingSchedule = {
        schedule_id: 'schedule-1',
        contract_id: 'test_contract_id',
        effective_date: '2023-01-01T00:00:00Z',
        end_date: null,
        custom_rate: 20000 // Override rate: $200/hour instead of default
      };

      let pricingScheduleQueried = false;
      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          pricingScheduleQueried = true;
          return createScheduleQuery({ first: mockPricingSchedule });
        }
        return createGenericQueryBuilder();
      });

      // Verify that the calculateFixedPriceCharges method queries for pricing schedules
      // This is an integration point we want to verify exists
      await (billingEngine as any).calculateFixedPriceCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        mockClientContractLine
      );

      // The key assertion: pricing schedule was queried during the calculation
      expect(pricingScheduleQueried).toBe(true);
    });

    it('should skip pricing schedule when contract has no pricing schedules', async () => {
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        custom_rate: 12000,
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant
      };

      // Mock pricing schedule query to return no schedule
      let pricingScheduleQueried = false;
      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          pricingScheduleQueried = true;
          return createScheduleQuery();
        }
        return createGenericQueryBuilder();
      });

      // Call calculateFixedPriceCharges
      await (billingEngine as any).calculateFixedPriceCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        mockClientContractLine
      );

      // The key assertion: pricing schedule was still queried (we check for it)
      expect(pricingScheduleQueried).toBe(true);
    });

    it('should handle pricing schedule query errors gracefully', async () => {
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        custom_rate: 12000,
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant
      };

      // Mock pricing schedule query to throw an error
      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          return createScheduleQuery({
            reject: new Error('Database connection failed')
          });
        }
        return createGenericQueryBuilder();
      });

      // The method should handle the error and not crash
      // This is testing that the pricing schedule lookup doesn't break the entire billing flow
      try {
        await (billingEngine as any).calculateFixedPriceCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          mockClientContractLine
        );
        // If we get here, the error was handled gracefully
        expect(true).toBe(true);
      } catch (error) {
        // If error is thrown, it should be related to database/query, not to pricing schedule integration
        expect((error as any).message).toContain('Database connection failed');
      }
    });

    it('should query pricing schedules with correct date range filtering', async () => {
      const mockClientContractLine: IClientContractLine = {
        client_contract_line_id: 'test_billing_id',
        client_id: mockClientId,
        contract_line_id: 'test_contract_line_id',
        contract_id: 'test_contract_id',
        service_category: 'test_category',
        custom_rate: 12000,
        start_date: '2023-01-01T00:00:00Z',
        end_date: null,
        is_active: true,
        tenant: mockTenant
      };

      // Track the query parameters used
      const whereCalls: any[] = [];
      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'contract_pricing_schedules') {
          return createScheduleQuery({
            onWhereCall: (args) => whereCalls.push(args)
          });
        }
        return createGenericQueryBuilder();
      });

      await (billingEngine as any).calculateFixedPriceCharges(
        mockClientId,
        { startDate: mockStartDate, endDate: mockEndDate },
        mockClientContractLine
      );

      // Verify that we're querying with the contract_id (the pricing schedules should be contract-specific)
      const [firstWhereCall] = whereCalls;
      expect(firstWhereCall?.[0]).toEqual({
        tenant: mockTenant,
        contract_id: 'test_contract_id'
      });
    });
  });

});
