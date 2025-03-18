import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { determineDefaultBillingPlan, getEligibleBillingPlans, validateBillingPlanForService, shouldAllocateUnassignedEntry } from 'server/src/lib/utils/planDisambiguation';
import { createTenantKnex } from 'server/src/lib/db';

// Mock the database connection
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('Plan Disambiguation Logic', () => {
  let mockKnex: any;
  const mockTenant = 'test_tenant';
  const mockCompanyId = 'test_company_id';
  const mockServiceId = 'test_service_id';

  beforeEach(() => {
    mockKnex = {
      join: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };

    (createTenantKnex as Mock).mockResolvedValue({
      knex: mockKnex,
      tenant: mockTenant,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getEligibleBillingPlans', () => {
    it('should query for eligible billing plans', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await getEligibleBillingPlans(mockKnex, mockTenant, mockCompanyId, mockServiceId);

      expect(result).toEqual(mockPlans);
      expect(mockKnex.join).toHaveBeenCalledTimes(2);
      expect(mockKnex.where).toHaveBeenCalledWith({
        'company_billing_plans.company_id': mockCompanyId,
        'company_billing_plans.is_active': true,
        'company_billing_plans.tenant': mockTenant,
        'plan_services.service_id': mockServiceId,
      });
    });
  });

  describe('determineDefaultBillingPlan', () => {
    it('should return the only plan when there is just one eligible plan', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultBillingPlan(mockCompanyId, mockServiceId);

      expect(result).toBe('plan1');
    });

    it('should return null when there are no eligible plans', async () => {
      mockKnex.select.mockResolvedValue([]);

      const result = await determineDefaultBillingPlan(mockCompanyId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return the bucket plan when there is only one bucket plan', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
        {
          company_billing_plan_id: 'plan3',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultBillingPlan(mockCompanyId, mockServiceId);

      expect(result).toBe('plan2');
    });

    it('should return null when there are multiple eligible plans with no clear default', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultBillingPlan(mockCompanyId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return null when there are multiple bucket plans', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Bucket',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultBillingPlan(mockCompanyId, mockServiceId);

      expect(result).toBeNull();
    });
  });

  describe('validateBillingPlanForService', () => {
    it('should return true when the billing plan is valid for the service', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await validateBillingPlanForService(mockCompanyId, mockServiceId, 'plan1');

      expect(result).toBe(true);
    });

    it('should return false when the billing plan is not valid for the service', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await validateBillingPlanForService(mockCompanyId, mockServiceId, 'plan3');

      expect(result).toBe(false);
    });
  });

  describe('shouldAllocateUnassignedEntry', () => {
    it('should return true when this is the only eligible plan', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockCompanyId, mockServiceId, 'plan1');

      expect(result).toBe(true);
    });

    it('should return true when this is the only bucket plan', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
        {
          company_billing_plan_id: 'plan3',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockCompanyId, mockServiceId, 'plan2');

      expect(result).toBe(true);
    });

    it('should return false when this is not the only eligible plan and not a bucket plan', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Fixed',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockCompanyId, mockServiceId, 'plan1');

      expect(result).toBe(false);
    });

    it('should return false when there are multiple bucket plans', async () => {
      const mockPlans = [
        {
          company_billing_plan_id: 'plan1',
          plan_type: 'Bucket',
        },
        {
          company_billing_plan_id: 'plan2',
          plan_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockCompanyId, mockServiceId, 'plan1');

      expect(result).toBe(false);
    });
  });
});