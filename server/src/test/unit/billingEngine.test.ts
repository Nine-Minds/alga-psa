import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { getConnection } from 'server/src/lib/db/db';
import { IAdjustment, IBillingCharge, IBillingPeriod, IBillingResult, ICompanyBillingPlan, IDiscount, IFixedPriceCharge, IPlanService, ITimeBasedCharge, IBucketPlan, IBucketUsage, IUsageBasedCharge } from 'server/src/interfaces/billing.interfaces';
import { ISO8601String } from '../../types/types.d';
import { getCompanyTaxRate } from 'server/src/lib/actions/invoiceActions';


vi.mock('@/lib/actions/invoiceActions', () => ({
  getCompanyTaxRate: vi.fn().mockResolvedValue(8.25),
  // Add other functions from invoiceActions if needed
}));

vi.mock('@/lib/db/db');
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(() => Promise.resolve({
    user: {
      id: 'mock-user-id',
    },
  })),
}));

vi.mock("@/app/api/auth/[...nextauth]/options", () => ({
  options: {},
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

vi.mock('@/lib/billing/taxRates', () => ({
  getCompanyTaxRate: vi.fn(),
}));


describe('BillingEngine', () => {
  let billingEngine: BillingEngine;
  const mockTenant = 'test_tenant';
  const mockCompanyId = 'test_company_id';
  const mockBillingCycleId = 'test_billing_cycle_id';

  const mockStartDate: ISO8601String = '2023-01-01T00:00:00Z';
  const mockEndDate: ISO8601String = '2023-02-01T00:00:00Z';

  beforeEach(() => {
    billingEngine = new BillingEngine();
    (billingEngine as any).tenant = mockTenant;
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

    (billingEngine as any).knex = vi.fn().mockReturnValue(mockQueryBuilder);
    (billingEngine as any).knex.raw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');
    vi.spyOn(billingEngine as any, 'fetchDiscounts').mockResolvedValue([]);

    (getConnection as any).mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateBilling', () => {
    it('should calculate billing correctly', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];

      const mockFixedCharges = [
        { serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100, type: 'fixed', tax_amount: 0, tax_rate: 0 },
      ];

      const mockTimeCharges = [
        { serviceId: 'service2', serviceName: 'Service 2', userId: 'user1', duration: 2, rate: 50, total: 100, type: 'time', tax_amount: 0, tax_rate: 0 },
      ];

      const mockUsageCharges = [
        { serviceId: 'service3', serviceName: 'Service 3', quantity: 10, rate: 5, total: 50, type: 'usage', tax_amount: 0, tax_rate: 0 },
      ];

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue(mockTimeCharges);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue(mockUsageCharges);

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: [
          ...mockFixedCharges.map((c): IFixedPriceCharge => ({ ...c, type: 'fixed', tax_amount: 0, tax_rate: 0 })),
          ...mockTimeCharges.map((c): ITimeBasedCharge => ({ ...c, type: 'time', tax_amount: 0, tax_rate: 0, entryId: 'mock-entry-id' })),
          ...mockUsageCharges.map((c): IUsageBasedCharge => ({ ...c, type: 'usage', tax_amount: 0, tax_rate: 0, usageId: 'mock-usage-id' })),
        ],
        totalAmount: 250,
        discounts: [],
        adjustments: [],
        finalAmount: 250,
      });
    });

    it('should throw an error if no active billing plans are found', async () => {
      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: [],
        billingCycle: 'monthly'
      });

      await expect(billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId))
        .rejects.toThrow('No active billing plans found for company test_company_id in the given period');
    });

    it('should calculate billing correctly with multiple charge types', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
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

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue(mockTimeCharges);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue(mockUsageCharges);

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

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
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
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

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);

      const result = await billingEngine.calculateBilling(mockCompanyId, mockClientBilling[0].start_date, mockEndDate, mockBillingCycleId);

      const expectedProration = 17 / 31;
      expect(result.totalAmount).toBeCloseTo(100 * expectedProration, 2);
      expect(result.finalAmount).toBeCloseTo(100 * expectedProration, 2);
    });

    it('should apply discounts and adjustments correctly', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
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

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
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

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result).toEqual({
        charges: mockFixedCharges,
        totalAmount: 100,
        discounts: mockDiscounts,
        adjustments: mockAdjustments,
        finalAmount: 85, // 100 - 10 - 5
      });
    });


    it('should calculate billing correctly for multiple active plans', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'billing_id_1',
          company_id: mockCompanyId,
          plan_id: 'plan_id_1',
          service_category: 'category_1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
        {
          company_billing_plan_id: 'billing_id_2',
          company_id: mockCompanyId,
          plan_id: 'plan_id_2',
          service_category: 'category_2',
          start_date: '2023-01-15T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
      ];

      const mockPlanServices: IPlanService[] = [
        { tenant: mockTenant, plan_id: 'plan_id_1', service_id: 'service1', quantity: 1 },
        { tenant: mockTenant, plan_id: 'plan_id_1', service_id: 'service3', quantity: 1 },
        { tenant: mockTenant, plan_id: 'plan_id_2', service_id: 'service2', quantity: 1 },
        { tenant: mockTenant, plan_id: 'plan_id_2', service_id: 'service4', quantity: 1 },
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

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
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

      // Mock the knex query for plan_services
      (billingEngine as any).knex = vi.fn().mockImplementation((tableName: string) => {
        if (tableName === 'plan_services') {
          return {
            join: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue(mockPlanServices),
          };
        }
        if (tableName === 'bucket_plans') {
          return {
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(null), // or mock a bucket plan if needed
          };
        }
        if (tableName === 'bucket_usage') {
          return {
            where: vi.fn().mockReturnThis(),
            whereBetween: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(null), // or mock bucket usage if needed
          };
        }
        return {
          join: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue(null), // Add this line for other queries
        };
      });

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

      expect(result.charges).toEqual([
        ...mockFixedCharges1,
        ...mockTimeCharges1,
        ...mockFixedCharges2,
        ...mockTimeCharges2,
      ]);
      expect(result.totalAmount).toBe(290); // 100 + 50 + 50 + 90
      expect(result.finalAmount).toBe(290);

      // Replace the existing expectations with these:
      expect(billingEngine['getCompanyBillingPlansAndCycle']).toHaveBeenCalledWith(
        mockCompanyId,
        expect.objectContaining({
          startDate: mockStartDate,
          endDate: mockEndDate
        })
      );

      mockClientBilling.forEach(billing => {
        expect(billingEngine['calculateFixedPriceCharges']).toHaveBeenCalledWith(
          mockCompanyId,
          expect.objectContaining({
            startDate: mockStartDate,
            endDate: mockEndDate
          }),
          billing
        );

        expect(billingEngine['calculateTimeBasedCharges']).toHaveBeenCalledWith(
          mockCompanyId,
          expect.objectContaining({
            startDate: mockStartDate,
            endDate: mockEndDate
          }),
          billing
        );

        expect(billingEngine['calculateUsageBasedCharges']).toHaveBeenCalledWith(
          mockCompanyId,
          expect.objectContaining({
            startDate: mockStartDate,
            endDate: mockEndDate
          }),
          billing
        );
      });
    });

    it('should not apply taxes to non-taxable items based on service catalog', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
          service_category: 'test_category',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        },
      ];
    
      const mockServiceCatalog = [
        {
          service_id: 'service1',
          service_name: 'Non-Taxable Service',
          is_taxable: false
        },
        {
          service_id: 'service2',
          service_name: 'Taxable Service',
          is_taxable: true
        }
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
    
      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
    
      // Mock the knex query for fetching service catalog entries
      const mockKnex = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation((serviceId) => {
          return Promise.resolve(mockServiceCatalog.find(service => service.service_id === serviceId));
        }),
      };
      (billingEngine as any).knex = vi.fn().mockReturnValue(mockKnex);
    
      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);
    
      // Check non-taxable item
      expect(result.charges[0].tax_amount).toBe(0);
    
      // Check taxable item
      expect(result.charges[1].tax_amount).toBe(8.25);
    });
    
    


    it('should handle proration correctly for multiple plans with different start dates', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'billing_id_1',
          company_id: mockCompanyId,
          plan_id: 'plan_id_1',
          service_category: 'category_1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
        {
          company_billing_plan_id: 'billing_id_2',
          company_id: mockCompanyId,
          plan_id: 'plan_id_2',
          service_category: 'category_2',
          start_date: '2023-01-15T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: '',
        },
      ];

      const mockPlanServices: IPlanService[] = [
        { tenant: mockTenant, plan_id: 'plan_id_1', service_id: 'service1', quantity: 1 },
        { tenant: mockTenant, plan_id: 'plan_id_2', service_id: 'service2', quantity: 1 },
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

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges')
        .mockResolvedValueOnce(mockFixedCharges1)
        .mockResolvedValueOnce(mockFixedCharges2);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);

      // Mock the knex query for plan_services
      (billingEngine as any).knex.mockImplementation((tableName: string) => {
        if (tableName === 'plan_services') {
          return {
            join: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue(mockPlanServices),
          };
        }
        if (tableName === 'bucket_plans') {
          return {
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(null), // or mock a bucket plan if needed
          };
        }
        if (tableName === 'bucket_usage') {
          return {
            where: vi.fn().mockReturnThis(),
            whereBetween: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(null), // or mock bucket usage if needed
          };
        }
        return {
          join: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue(null), // Add this line for other queries
        };
      });

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

      // Plan 1 should be charged for the full month
      expect(result.charges[0].total).toBeCloseTo(100, 2);

      // Plan 2 should be prorated for half the month (17 days out of 31)
      expect(result.charges[1].total).toBeCloseTo(27.42, 2); // 50 * (17 / 31) ≈ 27.42

      expect(result.totalAmount).toBeCloseTo(127.42, 2);
      expect(result.finalAmount).toBeCloseTo(127.42, 2);
    });
    it('should calculate billing correctly with bucket plan charges', async () => {
      const mockClientBilling: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'test_billing_id',
          company_id: mockCompanyId,
          plan_id: 'test_plan_id',
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
        { serviceId: 'bucket1', serviceName: 'Bucket Plan Hours', quantity: 40, rate: 0, total: 0, type: 'bucket' },
        { serviceId: 'bucket1', serviceName: 'Bucket Plan Overage Hours', quantity: 5, rate: 50, total: 250, type: 'bucket' },
      ];

      vi.spyOn(billingEngine as any, 'getCompanyBillingPlansAndCycle').mockResolvedValue({
        companyBillingPlans: mockClientBilling,
        billingCycle: 'monthly'
      });
      vi.spyOn(billingEngine as any, 'calculateFixedPriceCharges').mockResolvedValue(mockFixedCharges);
      vi.spyOn(billingEngine as any, 'calculateTimeBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
      vi.spyOn(billingEngine as any, 'calculateBucketPlanCharges').mockResolvedValue(mockBucketCharges);

      const result = await billingEngine.calculateBilling(mockCompanyId, mockStartDate, mockEndDate, mockBillingCycleId);

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


    it('should calculate bucket plan charges correctly', async () => {
      const mockCompany = {
        company_id: mockCompanyId,
        company_name: 'Test Company',
        tax_region: 'US-CA', // Add a tax region to the mock company
        // Add other necessary company fields here
      };

      const mockBucketPlan: IBucketPlan = {
        bucket_plan_id: 'bucket1',
        plan_id: 'test_plan_id',
        total_hours: 40,
        billing_period: 'Monthly',
        overage_rate: 50,
      };

      const mockBucketUsage: IBucketUsage = {
        usage_id: 'usage1',
        company_id: mockCompanyId,
        period_start: '2023-01-01T00:00:00Z',
        period_end: '2023-02-01T00:00:00Z',
        minutes_used: 45,
        overage_minutes: 5,
        rolled_over_minutes: 0,
        service_catalog_id: ''
      };

      const mockServiceCatalog = {
        service_id: 'service1',
        service_name: 'Emerald City Consulting Hours',
        description: 'Consulting hours for Emerald City projects',
        service_type: 'Bucket',
        default_rate: 0,
        unit_of_measure: 'hour',
      };

      // Create a mock knex function that returns an object with the necessary methods
      const mockKnex = vi.fn().mockImplementation((tableName: string) => {
        const mockQueryBuilder = {
          where: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          first: vi.fn().mockImplementation(() => {
            if (tableName === 'companies') return Promise.resolve(mockCompany);
            if (tableName === 'bucket_plans') return Promise.resolve(mockBucketPlan);
            if (tableName === 'bucket_usage') return Promise.resolve(mockBucketUsage);
            if (tableName === 'service_catalog') return Promise.resolve(mockServiceCatalog);
            return Promise.resolve(null);
          }),
        };
        return mockQueryBuilder;
      });

      // Assign the mock knex function to the billingEngine
      (billingEngine as any).knex = mockKnex;

      const result = await (billingEngine as any).calculateBucketPlanCharges(
        mockCompanyId,
        { startDate: mockStartDate, endDate: mockEndDate },
        { plan_id: 'test_plan_id' }
      );
      const mockTaxRate = 8.25;
      const expectedTaxAmount = 250 * (mockTaxRate / 100);

      expect(result).toMatchObject([
        {
          type: 'bucket',
          serviceName: 'Emerald City Consulting Hours',
          rate: 50,
          total: 250,
          hoursUsed: 45,
          overageHours: 5,
          overageRate: 50,
          tax_rate: mockTaxRate,
          tax_amount: Math.ceil(expectedTaxAmount * 100),
        },
      ]);

      // Verify that knex was called with the correct table names
      expect(mockKnex).toHaveBeenCalledWith('companies');
      expect(mockKnex).toHaveBeenCalledWith('bucket_plans');
      expect(mockKnex).toHaveBeenCalledWith('bucket_usage');
      expect(mockKnex).toHaveBeenCalledWith('service_catalog');

      // Verify that getCompanyTaxRate was called with the correct arguments
      expect(getCompanyTaxRate).toHaveBeenCalledWith(mockCompany.tax_region, mockBucketUsage.period_end);
    });

    describe('calculateTimeBasedCharges with billing plan disambiguation', () => {
      it('should filter time entries by billing plan ID', async () => {
        const mockTimeEntries = [
          {
            work_item_id: 'service1',
            service_name: 'Service 1',
            user_id: 'user1',
            start_time: '2023-01-01T10:00:00.000Z',
            end_time: '2023-01-01T12:00:00.000Z',
            user_rate: 50,
            default_rate: 40,
            billing_plan_id: 'billing_plan_1'
          },
          {
            work_item_id: 'service2',
            service_name: 'Service 2',
            user_id: 'user2',
            start_time: '2023-01-02T14:00:00.000Z',
            end_time: '2023-01-02T17:00:00.000Z',
            user_rate: null,
            default_rate: 60,
            billing_plan_id: 'billing_plan_2'
          },
          {
            work_item_id: 'service3',
            service_name: 'Service 3',
            user_id: 'user3',
            start_time: '2023-01-03T09:00:00.000Z',
            end_time: '2023-01-03T11:00:00.000Z',
            user_rate: null,
            default_rate: 70,
            billing_plan_id: null
          },
        ];

        const mockRaw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');

        const mockKnexInstance = {
          join: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          whereNull: vi.fn().mockReturnThis(),
          orWhere: vi.fn().mockReturnThis(),
          select: vi.fn().mockImplementation(() => {
            // Filter entries based on billing_plan_id
            return Promise.resolve(mockTimeEntries.filter(entry =>
              entry.billing_plan_id === 'billing_plan_1' || entry.billing_plan_id === null
            ));
          }),
          raw: mockRaw,
        };

        // Mock the knex function at the class level
        (billingEngine as any).knex = vi.fn().mockReturnValue(mockKnexInstance);
        (billingEngine as any).knex.raw = mockRaw;

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockCompanyId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', plan_id: 'test_plan_id', company_billing_plan_id: 'billing_plan_1' }
        );

        // Should only include entries with billing_plan_id = 'billing_plan_1' or null
        expect(result).toHaveLength(2);
        expect(result[0].serviceName).toBe('Service 1');
        expect(result[1].serviceName).toBe('Service 3');
        
        // Verify that the where function was called with the correct billing plan ID
        expect(mockKnexInstance.where).toHaveBeenCalled();
      });
    });

    describe('calculateUsageBasedCharges with billing plan disambiguation', () => {
      it('should filter usage records by billing plan ID', async () => {
        const mockUsageRecords = [
          {
            service_id: 'service1',
            service_name: 'Service 1',
            quantity: 10,
            default_rate: 5,
            billing_plan_id: 'billing_plan_1'
          },
          {
            service_id: 'service2',
            service_name: 'Service 2',
            quantity: 20,
            default_rate: 3,
            billing_plan_id: 'billing_plan_2'
          },
          {
            service_id: 'service3',
            service_name: 'Service 3',
            quantity: 15,
            default_rate: 4,
            billing_plan_id: null
          },
        ];

        (billingEngine as any).knex.mockReturnValue({
          join: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          whereNull: vi.fn().mockReturnThis(),
          orWhere: vi.fn().mockReturnThis(),
          select: vi.fn().mockImplementation(() => {
            // Filter records based on billing_plan_id
            return Promise.resolve(mockUsageRecords.filter(record =>
              record.billing_plan_id === 'billing_plan_1' || record.billing_plan_id === null
            ));
          }),
        });

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockCompanyId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', company_billing_plan_id: 'billing_plan_1' }
        );

        // Should only include records with billing_plan_id = 'billing_plan_1' or null
        expect(result).toHaveLength(2);
        expect(result[0].serviceName).toBe('Service 1');
        expect(result[1].serviceName).toBe('Service 3');
      });
    });

    describe('calculateTimeBasedCharges', () => {
      it('should calculate time-based charges correctly', async () => {
        const mockTimeEntries = [
          {
            work_item_id: 'service1',
            service_name: 'Service 1',
            user_id: 'user1',
            start_time: '2023-01-01T10:00:00.000Z',
            end_time: '2023-01-01T12:00:00.000Z',
            user_rate: 50,
            default_rate: 40,
          },
          {
            work_item_id: 'service2',
            service_name: 'Service 2',
            user_id: 'user2',
            start_time: '2023-01-02T14:00:00.000Z',
            end_time: '2023-01-02T17:00:00.000Z',
            user_rate: null,
            default_rate: 60,
          },
        ];

        const mockRaw = vi.fn().mockReturnValue('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');

        const mockKnexInstance = {
          join: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue(mockTimeEntries),
          raw: mockRaw,
        };

        // Mock the knex function at the class level
        (billingEngine as any).knex = vi.fn().mockReturnValue(mockKnexInstance);
        (billingEngine as any).knex.raw = mockRaw;

        const result = await (billingEngine as any).calculateTimeBasedCharges(
          mockCompanyId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category', plan_id: 'test_plan_id' }
        );

        expect(result).toMatchObject([
          {
            serviceName: 'Service 1',
            userId: 'user1',
            duration: 2,
            rate: 40,
            total: 80,
          },
          {
            serviceName: 'Service 2',
            userId: 'user2',
            duration: 3,
            rate: 60,
            total: 180,
          },
        ]);

        // Verify that the correct methods were called
        expect(mockKnexInstance.join).toHaveBeenCalled();
        expect(mockKnexInstance.leftJoin).toHaveBeenCalled();
        expect(mockKnexInstance.where).toHaveBeenCalled();
        expect(mockKnexInstance.andWhere).toHaveBeenCalled();
        expect(mockKnexInstance.select).toHaveBeenCalled();
        expect(mockRaw).toHaveBeenCalledWith('COALESCE(project_tasks.task_name, tickets.title) as work_item_name');
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

        (billingEngine as any).knex.mockReturnValue({
          join: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          whereBetween: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue(mockUsageRecords),
        });

        const result = await (billingEngine as any).calculateUsageBasedCharges(
          mockCompanyId,
          { startDate: mockStartDate, endDate: mockEndDate },
          { service_category: 'test_category' }
        );

        expect(result).toMatchObject([
          {
            serviceId: 'service1',
            serviceName: 'Service 1',
            quantity: 10,
            rate: 5,
            total: 50,
          },
          {
            serviceId: 'service2',
            serviceName: 'Service 2',
            quantity: 20,
            rate: 3,
            total: 60,
          },
        ]);
      });
    });

    describe('applyProration', () => {
      it('should apply proration correctly for partial billing periods', () => {
        const charges: IBillingCharge[] = [
          {
            type: 'fixed', serviceId: 'service1', serviceName: 'Service 1', quantity: 1, rate: 100, total: 100,
            tax_amount: 0,
            tax_rate: 0
          },
        ];
        const billingPeriod: IBillingPeriod = {
          startDate: '2023-01-01T00:00:00Z',
          endDate: '2023-02-01T00:00:00Z', // 15 days instead of full month
        };
        const mockStartDate = '2023-01-17T00:00:00Z';
        const mockBillingCycle = 'monthly';

        const proratedCharges = (billingEngine as any).applyProrationToPlan(charges, billingPeriod, mockStartDate, mockBillingCycle);

        expect(proratedCharges[0].total).toBeCloseTo(48.39, 2); // 100 * (15 / 31) ≈ 48.39
      });
    });
  })
});
