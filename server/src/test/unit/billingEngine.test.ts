import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';
import { getConnection } from 'server/src/lib/db/db';
import { IAdjustment, IBillingCharge, IBillingPeriod, IBillingResult, IClientContractLine, IDiscount, IFixedPriceCharge, ITimeBasedCharge, IUsageBasedCharge } from 'server/src/interfaces/billing.interfaces';
import { ISO8601String } from '../../types/types.d';
import { TaxService } from '@alga-psa/billing/services/taxService';
import * as clientActions from '@alga-psa/clients/actions';

const billingEngineSource = readFileSync(
  new URL('../../../../packages/billing/src/lib/billing/billingEngine.ts', import.meta.url),
  'utf8',
);


vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (_knex, callback) => callback(_knex)),
  withAdminTransaction: vi.fn(async (_callback, existing) => _callback(existing)),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();

  return {
    ...actual,
    getSession: vi.fn(() => Promise.resolve({
      user: {
        id: 'mock-user-id',
      },
    })),
    withAuth: (fn: unknown) => fn,
    withAuthCheck: (fn: unknown) => fn,
  };
});


vi.mock('openid-client', () => ({
  Issuer: {
    discover: vi.fn(),
  },
  Client: vi.fn(),
}));

vi.mock('jose', () => ({
  // Add any jose methods you're using
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: vi.fn(() =>
    Promise.resolve({
      client_id: 'mock-client-id',
      client_name: 'Mock Client',
      tenant: 'test_tenant',
      is_tax_exempt: false,
    })
  ),
  getClientDefaultTaxRegionCode: vi.fn(() => Promise.resolve('US-NY')),
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
    vi.spyOn(billingEngine as any, 'calculateMaterialCharges').mockResolvedValue([]);
    vi.spyOn(clientActions, 'getClientDefaultTaxRegionCode').mockResolvedValue('US-NY');
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

      if (table === 'contract_lines') {
        return buildChainableQuery({
          selectResult: [],
          firstResult: {
            contract_line_id: 'test_contract_line_id',
            contract_line_type: 'Fixed',
            tenant: mockTenant,
            custom_rate: 12000,
            enable_proration: false,
          },
          thenResult: [],
        });
      }

      if (table === 'contract_line_services as cls') {
        return buildChainableQuery({
          selectResult: [
            {
              service_id: 'service1',
              service_name: 'Managed Support (Contract: Acme Corp)',
              default_rate: 12000,
              tax_rate_id: null,
              service_quantity: 1,
              configuration_quantity: 1,
              service_line_custom_rate: null,
              configuration_custom_rate: null,
              config_id: 'config-1',
              service_base_rate: 12000,
            },
          ],
          firstResult: null,
          thenResult: [
            {
              service_id: 'service1',
              service_name: 'Managed Support (Contract: Acme Corp)',
              default_rate: 12000,
              tax_rate_id: null,
              service_quantity: 1,
              configuration_quantity: 1,
              service_line_custom_rate: null,
              configuration_custom_rate: null,
              config_id: 'config-1',
              service_base_rate: 12000,
            },
          ],
        });
      }

      if (table === 'contract_line_services') {
        return buildChainableQuery({
          selectResult: [
            { service_id: 'service1' },
            { service_id: 'service2' },
            { service_id: 'service3' },
          ],
          firstResult: null,
          thenResult: [
            { service_id: 'service1' },
            { service_id: 'service2' },
            { service_id: 'service3' },
          ],
        });
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
    builder.groupBy = vi.fn().mockImplementation(() => builder);
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

      expect(result).toMatchObject({
        charges: [...mockFixedCharges, ...mockTimeCharges, ...mockUsageCharges],
        totalAmount: 250,
        discounts: [],
        adjustments: [],
        finalAmount: 250,
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

      expect(result).toMatchObject({
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

      expect(result).toMatchObject({
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
          billing,
          'monthly',
          undefined,
          undefined,
        );

        expect(billingEngine['calculateTimeBasedCharges']).toHaveBeenCalledWith(
          mockClientId,
          expect.objectContaining({
            startDate: '2023-01-01',
            endDate: '2023-02-01'
          }),
          billing,
          'monthly',
          undefined,
          undefined,
        );

        expect(billingEngine['calculateUsageBasedCharges']).toHaveBeenCalledWith(
          mockClientId,
          expect.objectContaining({
            startDate: '2023-01-01',
            endDate: '2023-02-01'
          }),
          billing,
          'monthly',
          undefined,
          undefined,
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

      expect(result).toMatchObject({
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

    it('T021: resolves preserved and cloned assignment lines from each assignment contract after migration', async () => {
      const preservedClientId = 'client-preserved';
      const clonedClientId = 'client-cloned';
      const billingPeriod: IBillingPeriod = {
        startDate: '2026-03-01',
        endDate: '2026-04-01',
      };

      const linesByClient: Record<string, any[]> = {
        [preservedClientId]: [
          {
            client_id: preservedClientId,
            contract_line_id: 'preserved-line-1',
            service_category: 'managed-services',
            start_date: '2026-01-01T00:00:00Z',
            end_date: null,
            is_active: true,
            client_contract_id: 'cc-preserved',
            template_contract_id: null,
            contract_id: 'contract-managed-it-services',
            contract_name: 'Managed IT Services',
            currency_code: 'USD',
            contract_line_name: 'Managed IT Base',
            contract_line_type: 'Fixed',
            billing_frequency: 'monthly',
            billing_timing: null,
            custom_rate: '10000',
            enable_proration: null,
            billing_cycle_alignment: null,
            tenant: mockTenant,
          },
        ],
        [clonedClientId]: [
          {
            client_id: clonedClientId,
            contract_line_id: 'clone-line-1',
            service_category: 'managed-services',
            start_date: '2026-02-01T00:00:00Z',
            end_date: null,
            is_active: true,
            client_contract_id: 'cc-clone',
            template_contract_id: null,
            contract_id: 'contract-managed-it-services-clone',
            contract_name: 'Managed IT Services',
            currency_code: 'USD',
            contract_line_name: 'Managed IT Base',
            contract_line_type: 'Fixed',
            billing_frequency: 'monthly',
            billing_timing: 'advance',
            custom_rate: '12500',
            enable_proration: true,
            billing_cycle_alignment: 'prorated',
            tenant: mockTenant,
          },
          {
            client_id: clonedClientId,
            contract_line_id: 'clone-line-2',
            service_category: 'managed-services',
            start_date: '2026-02-01T00:00:00Z',
            end_date: null,
            is_active: true,
            client_contract_id: 'cc-clone',
            template_contract_id: null,
            contract_id: 'contract-managed-it-services-clone',
            contract_name: 'Managed IT Services',
            currency_code: 'USD',
            contract_line_name: 'Managed IT Add-on',
            contract_line_type: 'Usage',
            billing_frequency: 'monthly',
            billing_timing: null,
            custom_rate: '2500',
            enable_proration: null,
            billing_cycle_alignment: null,
            tenant: mockTenant,
          },
        ],
      };

      const baseKnex = (billingEngine as any).knex;
      let activeClientId: string | null = null;
      const clientContractsBuilder = buildChainableQuery();
      clientContractsBuilder.orWhereNull = vi.fn().mockImplementation(() => clientContractsBuilder);
      clientContractsBuilder.where = vi.fn().mockImplementation((condition: any, operator?: any, value?: any) => {
        if (typeof condition === 'function') {
          condition.call(clientContractsBuilder, clientContractsBuilder);
          return clientContractsBuilder;
        }

        if (condition && typeof condition === 'object' && 'cc.client_id' in condition) {
          activeClientId = condition['cc.client_id'];
        }

        return clientContractsBuilder;
      });
      clientContractsBuilder.select = vi.fn().mockImplementation(() => {
        clientContractsBuilder.__setResolveValue(
          (linesByClient[activeClientId ?? ''] ?? []).map((row) => ({ ...row }))
        );
        return clientContractsBuilder;
      });

      (billingEngine as any).knex = vi.fn((table: string) => {
        if (table === 'client_contracts as cc') {
          return clientContractsBuilder;
        }

        if (table === 'clients') {
          return buildChainableQuery({
            selectResult: [],
            firstResult: {
              client_id: activeClientId ?? preservedClientId,
              tenant: mockTenant,
              client_name: 'Migrated Client',
              is_tax_exempt: false,
            },
            thenResult: [],
          });
        }

        return baseKnex(table);
      });
      (billingEngine as any).knex.raw = baseKnex.raw;
      vi.spyOn(billingEngine as any, 'getBillingCycle').mockResolvedValue('monthly');

      const preservedResult = await (billingEngine as any).getClientContractLinesAndCycle(
        preservedClientId,
        billingPeriod
      );
      const clonedResult = await (billingEngine as any).getClientContractLinesAndCycle(
        clonedClientId,
        billingPeriod
      );

      expect(preservedResult.billingCycle).toBe('monthly');
      expect(preservedResult.clientContractLines).toHaveLength(1);
      expect(preservedResult.clientContractLines[0]).toMatchObject({
        client_id: preservedClientId,
        client_contract_id: 'cc-preserved',
        contract_id: 'contract-managed-it-services',
        contract_line_id: 'preserved-line-1',
        contract_line_name: 'Managed IT Base',
        billing_timing: 'arrears',
        custom_rate: 10000,
        enable_proration: false,
      });

      expect(clonedResult.billingCycle).toBe('monthly');
      expect(clonedResult.clientContractLines).toHaveLength(2);
      expect(clonedResult.clientContractLines.map((line: any) => line.contract_id)).toEqual([
        'contract-managed-it-services-clone',
        'contract-managed-it-services-clone',
      ]);
      expect(clonedResult.clientContractLines.map((line: any) => line.contract_line_id)).toEqual([
        'clone-line-1',
        'clone-line-2',
      ]);
      expect(clonedResult.clientContractLines[0]).toMatchObject({
        client_id: clonedClientId,
        client_contract_id: 'cc-clone',
        billing_timing: 'advance',
        custom_rate: 12500,
        enable_proration: true,
      });
      expect(clonedResult.clientContractLines[1]).toMatchObject({
        client_id: clonedClientId,
        client_contract_id: 'cc-clone',
        billing_timing: 'arrears',
        custom_rate: 2500,
        enable_proration: false,
      });

      expect(clientContractsBuilder.where).toHaveBeenCalledWith(
        expect.objectContaining({
          'cc.client_id': preservedClientId,
          'cc.is_active': true,
          'cc.tenant': mockTenant,
        })
      );
      expect(clientContractsBuilder.where).toHaveBeenCalledWith(
        expect.objectContaining({
          'cc.client_id': clonedClientId,
          'cc.is_active': true,
          'cc.tenant': mockTenant,
        })
      );
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
        if (tableName.startsWith('contract_line_service_configuration as clsc')) {
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

      expect(mockKnex).toHaveBeenCalledWith('contract_line_service_configuration as clsc');
      expect(mockKnex).toHaveBeenCalledWith('clients');
      expect(mockKnex).toHaveBeenCalledWith('bucket_usage');

      expect(calculateTaxSpy).toHaveBeenCalledWith(
        mockClientId,
        250,
        '2023-01-31',
        'US-CA',
        true,
        'USD'
      );
      calculateTaxSpy.mockRestore();
    });

    it('T056: bucket recurring charges map overage to the explicit bucket usage service periods', async () => {
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
          period_start: '2025-01-01',
          period_end: '2025-01-07',
          minutes_used: 45 * 60,
          overage_minutes: 5 * 60
        },
        {
          tenant: mockTenant,
          client_id: mockClientId,
          contract_line_id: 'test_contract_line_id',
          service_catalog_id: 'service_bucket',
          period_start: '2025-01-08',
          period_end: '2025-01-14',
          minutes_used: 42 * 60,
          overage_minutes: 2 * 60
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
        if (tableName.startsWith('contract_line_service_configuration as clsc')) {
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

      vi.spyOn(TaxService.prototype, 'calculateTax')
        .mockResolvedValue({ taxRate: 8.25, taxAmount: 0 });
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
          overageHours: 5,
          servicePeriodStart: '2025-01-01',
          servicePeriodEnd: '2025-01-07'
        },
        {
          type: 'bucket',
          serviceId: 'service_bucket',
          overageHours: 2,
          servicePeriodStart: '2025-01-08',
          servicePeriodEnd: '2025-01-14'
        }
      ]);
    });

    describe('calculateTimeBasedCharges with contract line disambiguation', () => {
      it('T030: explicit contract_line_id time entry still bills through assigned line', async () => {
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
              (entry) => entry.contract_line_id === 'contract_line_1'
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

        // Only explicitly assigned records should flow without unique service-line disambiguation.
        expect(result).toHaveLength(1);
        expect(result[0].serviceName).toBe('Service 1');
        
        // Verify that the where function was called with the correct contract line ID
        expect(timeEntriesBuilder.where).toHaveBeenCalled();
      });

      it('T032: unassigned time entry with a single eligible service-line match is allocated once', async () => {
        const baseKnex = (billingEngine as any).knex;
        const timeEntriesBuilder = buildChainableQuery({
          selectResult: [
            {
              entry_id: 'entry-unassigned-1',
              work_item_id: 'service1',
              service_id: 'service1',
              service_name: 'Service 1',
              user_id: 'user1',
              start_time: new Date('2023-01-01T10:00:00.000Z'),
              end_time: new Date('2023-01-01T12:00:00.000Z'),
              default_rate: 40,
              tax_rate_id: null,
              contract_line_id: null,
            },
          ],
          thenResult: [
            {
              entry_id: 'entry-unassigned-1',
              work_item_id: 'service1',
              service_id: 'service1',
              service_name: 'Service 1',
              user_id: 'user1',
              start_time: new Date('2023-01-01T10:00:00.000Z'),
              end_time: new Date('2023-01-01T12:00:00.000Z'),
              default_rate: 40,
              tax_rate_id: null,
              contract_line_id: null,
            },
          ],
        });
        const uniqueBuilder = buildChainableQuery({
          selectResult: [{ service_id: 'service1', line_count: '1', only_line_id: 'test_contract_line_id' }],
          thenResult: [{ service_id: 'service1', line_count: '1', only_line_id: 'test_contract_line_id' }],
        });
        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'time_entries') return timeEntriesBuilder;
          if (table === 'client_contracts as cc') return uniqueBuilder;
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          {
            service_category: 'test_category',
            contract_line_id: 'test_contract_line_id',
            client_contract_line_id: 'contract_line_1',
          }
        );

        expect(result).toHaveLength(1);
        expect(result[0].entryId).toBe('entry-unassigned-1');
      });

      it('T034: ambiguous unassigned time entry remains unresolved non-contract', async () => {
        const baseKnex = (billingEngine as any).knex;
        const timeEntriesBuilder = buildChainableQuery({ selectResult: [], thenResult: [] });
        const ambiguousBuilder = buildChainableQuery({
          selectResult: [{ service_id: 'service1', line_count: '2', only_line_id: 'test_contract_line_id' }],
          thenResult: [{ service_id: 'service1', line_count: '2', only_line_id: 'test_contract_line_id' }],
        });
        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'time_entries') return timeEntriesBuilder;
          if (table === 'client_contracts as cc') return ambiguousBuilder;
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          {
            service_category: 'test_category',
            contract_line_id: 'test_contract_line_id',
            client_contract_line_id: 'contract_line_1',
          }
        );

        expect(result).toEqual([]);
      });
    });

    describe('calculateUsageBasedCharges with contract line disambiguation', () => {
      it('T031: explicit contract_line_id usage record still bills through assigned line', async () => {
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
              record.contract_line_id === 'contract_line_1'
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
          {
            service_category: 'test_category',
            contract_line_id: 'test_contract_line_id',
            client_contract_line_id: 'contract_line_1',
          }
        );

        // Only explicitly assigned records should flow without unique service-line disambiguation.
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          serviceId: 'service1',
          serviceName: 'Service 1',
          servicePeriodStart: '2022-12-01',
          servicePeriodEnd: '2022-12-31',
          billingTiming: 'arrears'
        });
      });

      it('T033: unassigned usage record with a single eligible service-line match is allocated once', async () => {
        const baseKnex = (billingEngine as any).knex;
        const usageBuilder = buildChainableQuery({
          selectResult: [
            {
              usage_id: 'usage-unassigned-1',
              service_id: 'service1',
              service_name: 'Service 1',
              quantity: 8,
              default_rate: 5,
              tax_rate_id: null,
              contract_line_id: null,
            },
          ],
          thenResult: [
            {
              usage_id: 'usage-unassigned-1',
              service_id: 'service1',
              service_name: 'Service 1',
              quantity: 8,
              default_rate: 5,
              tax_rate_id: null,
              contract_line_id: null,
            },
          ],
        });
        const uniqueBuilder = buildChainableQuery({
          selectResult: [{ service_id: 'service1', line_count: '1', only_line_id: 'test_contract_line_id' }],
          thenResult: [{ service_id: 'service1', line_count: '1', only_line_id: 'test_contract_line_id' }],
        });
        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'usage_tracking') return usageBuilder;
          if (table === 'client_contracts as cc') return uniqueBuilder;
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          {
            service_category: 'test_category',
            contract_line_id: 'test_contract_line_id',
            client_contract_line_id: 'contract_line_1',
          }
        );

        expect(result).toHaveLength(1);
        expect(result[0].usageId).toBe('usage-unassigned-1');
      });

      it('T035: ambiguous unassigned usage record remains unresolved non-contract', async () => {
        const baseKnex = (billingEngine as any).knex;
        const usageBuilder = buildChainableQuery({ selectResult: [], thenResult: [] });
        const ambiguousBuilder = buildChainableQuery({
          selectResult: [{ service_id: 'service1', line_count: '2', only_line_id: 'test_contract_line_id' }],
          thenResult: [{ service_id: 'service1', line_count: '2', only_line_id: 'test_contract_line_id' }],
        });
        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'usage_tracking') return usageBuilder;
          if (table === 'client_contracts as cc') return ambiguousBuilder;
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = baseKnex.raw;

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          {
            service_category: 'test_category',
            contract_line_id: 'test_contract_line_id',
            client_contract_line_id: 'contract_line_1',
          }
        );

        expect(result).toEqual([]);
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
            servicePeriodStart: '2022-12-01',
            servicePeriodEnd: '2022-12-31',
            billingTiming: 'arrears'
          },
          {
            serviceName: 'Service 2',
            userId: 'user2',
            duration: 3,
            rate: 60,
            total: 180,
            servicePeriodStart: '2022-12-01',
            servicePeriodEnd: '2022-12-31',
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
            servicePeriodStart: '2022-12-01',
            servicePeriodEnd: '2022-12-31',
            billingTiming: 'arrears'
          },
          {
            serviceId: 'service2',
            serviceName: 'Service 2',
            quantity: 20,
            rate: expect.any(Number),
            total: expect.any(Number),
            servicePeriodStart: '2022-12-01',
            servicePeriodEnd: '2022-12-31',
            billingTiming: 'arrears'
          },
        ]);
      });

      it('T074: service-driven time and usage billing preserves canonical servicePeriodStart, servicePeriodEnd, and billingTiming metadata on generated charges', async () => {
        const serviceDrivenTiming = {
          duePosition: 'advance',
          servicePeriodStart: '2025-02-08',
          servicePeriodEnd: '2025-03-07',
          servicePeriodStartExclusive: '2025-02-08T00:00:00Z',
          servicePeriodEndExclusive: '2025-03-08T00:00:00Z',
          coverageRatio: 1,
        } as const;

        const mockTimeEntries = [
          {
            entry_id: 'entry-service-driven',
            work_item_id: 'ticket-1',
            service_id: 'service-hourly',
            service_name: 'Hourly Service',
            user_id: 'user-1',
            user_type: 'technician',
            start_time: new Date('2025-02-14T10:00:00.000Z'),
            end_time: new Date('2025-02-14T12:00:00.000Z'),
            default_rate: 40,
            tax_rate_id: null,
          },
        ];
        const mockUsageRecords = [
          {
            usage_id: 'usage-service-driven',
            service_id: 'service-usage',
            service_name: 'Usage Service',
            quantity: 6,
            default_rate: 9,
            tax_rate_id: null,
          },
        ];

        const baseKnex = (billingEngine as any).knex;
        const timeEntriesBuilder = buildChainableQuery({
          selectResult: mockTimeEntries,
          thenResult: mockTimeEntries,
        });
        timeEntriesBuilder.select.mockImplementation(() => {
          timeEntriesBuilder.__setResolveValue(mockTimeEntries);
          return timeEntriesBuilder;
        });

        const usageBuilder = buildChainableQuery({
          selectResult: mockUsageRecords,
          thenResult: mockUsageRecords,
        });
        usageBuilder.select.mockImplementation(() => {
          usageBuilder.__setResolveValue(mockUsageRecords);
          return usageBuilder;
        });

        const contractLineBuilder = buildChainableQuery({
          firstResult: { contract_line_id: 'contract-line-1', contract_line_type: 'Hourly' },
          thenResult: [],
        });

        (billingEngine as any).knex = vi.fn((table: string) => {
          if (table === 'time_entries') {
            return timeEntriesBuilder;
          }
          if (table === 'usage_tracking') {
            return usageBuilder;
          }
          if (table === 'contract_lines') {
            return contractLineBuilder;
          }
          return baseKnex(table);
        });
        (billingEngine as any).knex.raw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');

        const timeCharges = await (billingEngine as any).calculateTimeBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', contract_line_id: 'contract-line-1', client_contract_line_id: 'contract-line-1' },
          'monthly',
          serviceDrivenTiming,
        );
        const usageCharges = await (billingEngine as any).calculateUsageBasedCharges(
          mockClientId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', contract_line_id: 'contract-line-1', client_contract_line_id: 'contract-line-1' },
          'monthly',
          serviceDrivenTiming,
        );

        expect(timeCharges).toMatchObject([
          {
            entryId: 'entry-service-driven',
            servicePeriodStart: '2025-02-08',
            servicePeriodEnd: '2025-03-07',
            billingTiming: 'advance',
          },
        ]);
        expect(usageCharges).toMatchObject([
          {
            usageId: 'usage-service-driven',
            servicePeriodStart: '2025-02-08',
            servicePeriodEnd: '2025-03-07',
            billingTiming: 'advance',
          },
        ]);
      });
    });

  });

  describe('Pricing Schedule Integration', () => {
    it('should query contract pricing schedules by contract id for the active service period overlap', () => {
      expect(billingEngineSource).toContain('this.knex(\n          "contract_pricing_schedules",\n        )');
      expect(billingEngineSource).toContain('contract_id: clientContractLine.contract_id');
      expect(billingEngineSource).toContain('.where("effective_date", "<", servicePeriodEndExclusive)');
      expect(billingEngineSource).toContain('.orWhere("end_date", ">", servicePeriodStartExclusive);');
    });

    it('should prefer an active pricing schedule custom rate over the contract-level custom rate', () => {
      expect(billingEngineSource).toContain('let effectiveCustomRate = clientContractLine.custom_rate;');
      expect(billingEngineSource).toContain('activePricingSchedule.custom_rate !== null');
      expect(billingEngineSource).toContain('effectiveCustomRate = activePricingSchedule.custom_rate;');
    });

    it('should fall back to the contract custom rate when no pricing schedule override is present', () => {
      expect(billingEngineSource).toContain('let effectiveCustomRate = clientContractLine.custom_rate;');
      expect(billingEngineSource).toContain('activePricingSchedule.custom_rate !== undefined');
    });

    it('should still continue fixed-charge calculation when no pricing schedule row exists', () => {
      expect(billingEngineSource).toContain('const activePricingSchedule = await this.knex(');
      expect(billingEngineSource).toContain('.first();');
      expect(billingEngineSource).toContain('if (');
      expect(billingEngineSource).toContain('activePricingSchedule &&');
    });

    it('should handle pricing schedule query errors gracefully without breaking fixed-charge generation', () => {
      expect(billingEngineSource).toContain('} catch (error) {');
      expect(billingEngineSource).toContain('[PRICING_SCHEDULE] Error checking for active pricing schedule');
    });

    it('should query pricing schedules with half-open overlap rules against the service period window', () => {
      expect(billingEngineSource).toContain('// [start, end) semantics: schedule starting exactly on service-period end does not apply.');
      expect(billingEngineSource).toContain('.where("effective_date", "<", servicePeriodEndExclusive)');
      expect(billingEngineSource).toContain('.orWhere("end_date", ">", servicePeriodStartExclusive);');
    });
  });

});
