import { describe, it, expect, afterEach, vi } from 'vitest';
import { getBillingPlans, createBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import BillingPlan from 'server/src/lib/models/billingPlan';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';

vi.mock('@/lib/models/billingPlan');
vi.mock('@/lib/db/db');

describe('Billing Plan Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getBillingPlans', () => {
    it('should return all billing plans', async () => {
      const mockPlans: IBillingPlan[] = [
        { 
          plan_id: '1', 
          plan_name: 'Basic', 
          billing_frequency: 'monthly', 
          is_custom: false,
          plan_type: 'fixed'
        },
        { 
          plan_id: '2', 
          plan_name: 'Pro', 
          billing_frequency: 'yearly', 
          is_custom: false,
          plan_type: 'time-based'
        },
      ];

      (BillingPlan.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(mockPlans);

      const result = await getBillingPlans();

      expect(result).toEqual(mockPlans);
      expect(BillingPlan.getAll).toHaveBeenCalled();
    });

    it('should throw an error if fetching plans fails', async () => {
      (BillingPlan.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getBillingPlans()).rejects.toThrow('Failed to fetch company billing plans');
    });
  });

  describe('createBillingPlan', () => {
    it('should create a new billing plan', async () => {
      const newPlan: Omit<IBillingPlan, 'plan_id'> = {
        plan_name: 'New Plan',
        billing_frequency: 'monthly',
        is_custom: true,
        plan_type: 'fixed',
      };

      const createdPlan: IBillingPlan = { ...newPlan, plan_id: '3' };

      (BillingPlan.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdPlan);

      const result = await createBillingPlan(newPlan);

      expect(result).toEqual(createdPlan);
      expect(BillingPlan.create).toHaveBeenCalledWith(newPlan);
    });

    it('should throw an error if creating a plan fails', async () => {
      const newPlan: Omit<IBillingPlan, 'plan_id'> = {
        plan_name: 'New Plan',
        billing_frequency: 'monthly',
        is_custom: true,
        plan_type: 'fixed',
      };

      (BillingPlan.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(createBillingPlan(newPlan)).rejects.toThrow('Failed to create billing plan');
    });
  });
});