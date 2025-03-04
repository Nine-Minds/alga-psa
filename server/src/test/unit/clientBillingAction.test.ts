import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClientBilling, updateClientBilling, getClientBilling, getOverlappingBillings } from 'server/src/lib/actions/clientBillingAction';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { ICompanyBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { parseISO } from 'date-fns';

vi.mock('@/lib/models/clientBilling');
vi.mock('@/lib/db/db');

describe('Client Billing Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClientBilling', () => {
    it('should create a new company billing plan when there are no overlaps', async () => {
      const newBillingPlan: Omit<ICompanyBillingPlan, 'company_billing_plan_id'> = {
        company_id: 'company1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: '2024-01-01T00:00:00.000Z',
        is_active: true,
        tenant: ''
      };

      const createdBillingPlan: ICompanyBillingPlan = { ...newBillingPlan, company_billing_plan_id: 'billing1' };

      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (CompanyBillingPlan.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdBillingPlan);

      const result = await createClientBilling(newBillingPlan);

      expect(result).toEqual(createdBillingPlan);
      expect(CompanyBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        newBillingPlan.company_id,
        newBillingPlan.service_category,
        parseISO(newBillingPlan.start_date),
        parseISO(newBillingPlan.end_date!)
      );
      expect(CompanyBillingPlan.create).toHaveBeenCalledWith(newBillingPlan);
    });

    it('should throw an error when there are overlapping billing entries', async () => {
      const newBillingPlan: Omit<ICompanyBillingPlan, 'company_billing_plan_id'> = {
        company_id: 'company1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingBillingPlan: ICompanyBillingPlan = {
        ...newBillingPlan,
        company_billing_plan_id: 'existing1',
        start_date: '2023-06-01T00:00:00Z',
        end_date: '2024-05-31T00:00:00Z',
      };

      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingBillingPlan]);

      await expect(createClientBilling(newBillingPlan)).rejects.toThrow(
        'Cannot create billing plan: overlapping billing plan exists for the same company and service category. Conflicting entry: ID existing1, Start Date: 2023-06-01, End Date: 2024-05-31'
      );
      expect(CompanyBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        newBillingPlan.company_id,
        newBillingPlan.service_category,
        parseISO(newBillingPlan.start_date),
        parseISO(newBillingPlan.end_date!)
      );
      expect(CompanyBillingPlan.create).not.toHaveBeenCalled();
    });
  });

  describe('updateClientBilling', () => {
    it('should update a company billing plan when there are no overlaps', async () => {
      const billingPlanId = 'billing1';
      const updateData: Partial<ICompanyBillingPlan> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingBillingPlan: ICompanyBillingPlan = {
        company_billing_plan_id: billingPlanId,
        company_id: 'company1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const updatedBillingPlan: ICompanyBillingPlan = { ...existingBillingPlan, ...updateData };

      (CompanyBillingPlan.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingBillingPlan);
      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (CompanyBillingPlan.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedBillingPlan);

      const result = await updateClientBilling(billingPlanId, updateData);

      expect(result).toEqual(updatedBillingPlan);
      expect(CompanyBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        existingBillingPlan.company_id,
        existingBillingPlan.service_category,
        parseISO(existingBillingPlan.start_date),
        parseISO(updateData.end_date!),
        billingPlanId
      );
      expect(CompanyBillingPlan.update).toHaveBeenCalledWith(billingPlanId, updateData);
    });

    it('should throw an error when updating creates an overlap', async () => {
      const billingPlanId = 'billing1';
      const updateData: Partial<ICompanyBillingPlan> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingBillingPlan: ICompanyBillingPlan = {
        company_billing_plan_id: billingPlanId,
        company_id: 'company1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingBillingPlan: ICompanyBillingPlan = {
        ...existingBillingPlan,
        company_billing_plan_id: 'existing2',
        start_date: '2024-01-01T00:00:00Z',
        end_date: '2025-12-31T00:00:00Z',
      };

      (CompanyBillingPlan.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingBillingPlan);
      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingBillingPlan]);

      await expect(updateClientBilling(billingPlanId, updateData)).rejects.toThrow(
        'Cannot update billing plan: overlapping billing plan exists for the same company and service category. Conflicting entry: ID existing2, Start Date: 2024-01-01, End Date: 2025-12-31'
      );
      expect(CompanyBillingPlan.update).not.toHaveBeenCalled();
    });
  });

  describe('getClientBilling', () => {
    it('should return company billing plans for a company', async () => {
      const companyId = 'company1';
      const mockBillingPlans: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'billing1',
          company_id: companyId,
          plan_id: 'plan1',
          service_category: 'category1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        },
        {
          company_billing_plan_id: 'billing2',
          company_id: companyId,
          plan_id: 'plan2',
          service_category: 'category2',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        }
      ];

      (CompanyBillingPlan.getByCompanyId as ReturnType<typeof vi.fn>).mockResolvedValue(mockBillingPlans);

      const result = await getClientBilling(companyId);

      expect(result).toEqual(mockBillingPlans);
      expect(CompanyBillingPlan.getByCompanyId).toHaveBeenCalledWith(companyId);
    });

    it('should throw an error if fetching company billing plans fails', async () => {
      const companyId = 'company1';

      (CompanyBillingPlan.getByCompanyId as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getClientBilling(companyId)).rejects.toThrow('Failed to fetch company billing plans');
    });
  });

  describe('getOverlappingBillings', () => {
    it('should return overlapping billing plan entries', async () => {
      const companyId = 'company1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');
      const excludeBillingPlanId = 'billing1';

      const overlappingBillingPlans: ICompanyBillingPlan[] = [
        {
          company_billing_plan_id: 'billing2',
          company_id: companyId,
          plan_id: 'plan2',
          service_category: serviceCategory,
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        }
      ];

      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue(overlappingBillingPlans);

      const result = await getOverlappingBillings(companyId, serviceCategory, startDate, endDate, excludeBillingPlanId);

      expect(result).toEqual(overlappingBillingPlans);
      expect(CompanyBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        companyId,
        serviceCategory,
        startDate,
        endDate,
        excludeBillingPlanId
      );
    });

    it('should throw an error if checking for overlapping billing plans fails', async () => {
      const companyId = 'company1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');

      (CompanyBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getOverlappingBillings(companyId, serviceCategory, startDate, endDate)).rejects.toThrow('Failed to check for overlapping billing plans');
    });
  });
});
