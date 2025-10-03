import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClientBilling, updateClientBilling, getClientBilling, getOverlappingBillings } from 'server/src/lib/actions/clientBillingAction';
import ClientBillingPlan from 'server/src/lib/models/clientBilling';
import { IClientBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { parseISO } from 'date-fns';

vi.mock('@/lib/models/clientBilling');
vi.mock('@/lib/db/db');

describe('Client Billing Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClientBilling', () => {
    it('should create a new client billing plan when there are no overlaps', async () => {
      const newBillingPlan: Omit<IClientBillingPlan, 'client_billing_plan_id'> = {
        client_id: 'client1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: '2024-01-01T00:00:00.000Z',
        is_active: true,
        tenant: ''
      };

      const createdBillingPlan: IClientBillingPlan = { ...newBillingPlan, client_billing_plan_id: 'billing1' };

      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (ClientBillingPlan.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdBillingPlan);

      const result = await createClientBilling(newBillingPlan);

      expect(result).toEqual(createdBillingPlan);
      expect(ClientBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        newBillingPlan.client_id,
        newBillingPlan.service_category,
        parseISO(newBillingPlan.start_date),
        parseISO(newBillingPlan.end_date!)
      );
      expect(ClientBillingPlan.create).toHaveBeenCalledWith(newBillingPlan);
    });

    it('should throw an error when there are overlapping billing entries', async () => {
      const newBillingPlan: Omit<IClientBillingPlan, 'client_billing_plan_id'> = {
        client_id: 'client1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingBillingPlan: IClientBillingPlan = {
        ...newBillingPlan,
        client_billing_plan_id: 'existing1',
        start_date: '2023-06-01T00:00:00Z',
        end_date: '2024-05-31T00:00:00Z',
      };

      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingBillingPlan]);

      await expect(createClientBilling(newBillingPlan)).rejects.toThrow(
        'Cannot create billing plan: overlapping billing plan exists for the same client and service category. Conflicting entry: ID existing1, Start Date: 2023-06-01, End Date: 2024-05-31'
      );
      expect(ClientBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        newBillingPlan.client_id,
        newBillingPlan.service_category,
        parseISO(newBillingPlan.start_date),
        parseISO(newBillingPlan.end_date!)
      );
      expect(ClientBillingPlan.create).not.toHaveBeenCalled();
    });
  });

  describe('updateClientBilling', () => {
    it('should update a client billing plan when there are no overlaps', async () => {
      const billingPlanId = 'billing1';
      const updateData: Partial<IClientBillingPlan> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingBillingPlan: IClientBillingPlan = {
        client_billing_plan_id: billingPlanId,
        client_id: 'client1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const updatedBillingPlan: IClientBillingPlan = { ...existingBillingPlan, ...updateData };

      (ClientBillingPlan.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingBillingPlan);
      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (ClientBillingPlan.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedBillingPlan);

      const result = await updateClientBilling(billingPlanId, updateData);

      expect(result).toEqual(updatedBillingPlan);
      expect(ClientBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        existingBillingPlan.client_id,
        existingBillingPlan.service_category,
        parseISO(existingBillingPlan.start_date),
        parseISO(updateData.end_date!),
        billingPlanId
      );
      expect(ClientBillingPlan.update).toHaveBeenCalledWith(billingPlanId, updateData);
    });

    it('should throw an error when updating creates an overlap', async () => {
      const billingPlanId = 'billing1';
      const updateData: Partial<IClientBillingPlan> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingBillingPlan: IClientBillingPlan = {
        client_billing_plan_id: billingPlanId,
        client_id: 'client1',
        plan_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingBillingPlan: IClientBillingPlan = {
        ...existingBillingPlan,
        client_billing_plan_id: 'existing2',
        start_date: '2024-01-01T00:00:00Z',
        end_date: '2025-12-31T00:00:00Z',
      };

      (ClientBillingPlan.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingBillingPlan);
      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingBillingPlan]);

      await expect(updateClientBilling(billingPlanId, updateData)).rejects.toThrow(
        'Cannot update billing plan: overlapping billing plan exists for the same client and service category. Conflicting entry: ID existing2, Start Date: 2024-01-01, End Date: 2025-12-31'
      );
      expect(ClientBillingPlan.update).not.toHaveBeenCalled();
    });
  });

  describe('getClientBilling', () => {
    it('should return client billing plans for a client', async () => {
      const clientId = 'client1';
      const mockBillingPlans: IClientBillingPlan[] = [
        {
          client_billing_plan_id: 'billing1',
          client_id: clientId,
          plan_id: 'plan1',
          service_category: 'category1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        },
        {
          client_billing_plan_id: 'billing2',
          client_id: clientId,
          plan_id: 'plan2',
          service_category: 'category2',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        }
      ];

      (ClientBillingPlan.getByClientId as ReturnType<typeof vi.fn>).mockResolvedValue(mockBillingPlans);

      const result = await getClientBilling(clientId);

      expect(result).toEqual(mockBillingPlans);
      expect(ClientBillingPlan.getByClientId).toHaveBeenCalledWith(clientId);
    });

    it('should throw an error if fetching client billing plans fails', async () => {
      const clientId = 'client1';

      (ClientBillingPlan.getByClientId as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getClientBilling(clientId)).rejects.toThrow('Failed to fetch client billing plans');
    });
  });

  describe('getOverlappingBillings', () => {
    it('should return overlapping billing plan entries', async () => {
      const clientId = 'client1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');
      const excludeBillingPlanId = 'billing1';

      const overlappingBillingPlans: IClientBillingPlan[] = [
        {
          client_billing_plan_id: 'billing2',
          client_id: clientId,
          plan_id: 'plan2',
          service_category: serviceCategory,
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        }
      ];

      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue(overlappingBillingPlans);

      const result = await getOverlappingBillings(clientId, serviceCategory, startDate, endDate, excludeBillingPlanId);

      expect(result).toEqual(overlappingBillingPlans);
      expect(ClientBillingPlan.checkOverlappingBilling).toHaveBeenCalledWith(
        clientId,
        serviceCategory,
        startDate,
        endDate,
        excludeBillingPlanId
      );
    });

    it('should throw an error if checking for overlapping billing plans fails', async () => {
      const clientId = 'client1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');

      (ClientBillingPlan.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getOverlappingBillings(clientId, serviceCategory, startDate, endDate)).rejects.toThrow('Failed to check for overlapping billing plans');
    });
  });
});
