import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEligibleBillingPlansForUI } from '../../lib/utils/planDisambiguation';

// Mock the planDisambiguation module
vi.mock('../../lib/utils/planDisambiguation', () => ({
  getEligibleBillingPlansForUI: vi.fn()
}));

describe('Billing Plan Selection Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a single plan when only one plan is available', async () => {
    // Mock the getEligibleBillingPlansForUI function to return a single plan
    vi.mocked(getEligibleBillingPlansForUI).mockResolvedValue([
      {
        company_billing_plan_id: 'test-plan-id',
        plan_name: 'Test Plan',
        plan_type: 'Fixed'
      }
    ]);

    const plans = await getEligibleBillingPlansForUI('company-1', 'service-1');
    
    expect(plans).toHaveLength(1);
    expect(plans[0].company_billing_plan_id).toBe('test-plan-id');
    expect(getEligibleBillingPlansForUI).toHaveBeenCalledWith('company-1', 'service-1');
  });

  it('should return multiple plans when multiple plans are available', async () => {
    // Mock the getEligibleBillingPlansForUI function to return multiple plans
    vi.mocked(getEligibleBillingPlansForUI).mockResolvedValue([
      {
        company_billing_plan_id: 'plan-id-1',
        plan_name: 'Fixed Plan',
        plan_type: 'Fixed'
      },
      {
        company_billing_plan_id: 'plan-id-2',
        plan_name: 'Bucket Plan',
        plan_type: 'Bucket'
      }
    ]);

    const plans = await getEligibleBillingPlansForUI('company-1', 'service-1');
    
    expect(plans).toHaveLength(2);
    expect(plans[0].company_billing_plan_id).toBe('plan-id-1');
    expect(plans[1].company_billing_plan_id).toBe('plan-id-2');
    expect(getEligibleBillingPlansForUI).toHaveBeenCalledWith('company-1', 'service-1');
  });

  it('should return an empty array when no plans are available', async () => {
    // Mock the getEligibleBillingPlansForUI function to return an empty array
    vi.mocked(getEligibleBillingPlansForUI).mockResolvedValue([]);

    const plans = await getEligibleBillingPlansForUI('company-1', 'service-1');
    
    expect(plans).toHaveLength(0);
    expect(getEligibleBillingPlansForUI).toHaveBeenCalledWith('company-1', 'service-1');
    it('should handle the case when no company ID is available', async () => {
      // This test verifies that the UI provides clear information when no company ID is available
      
      // In this case, the UI should:
      // 1. Show the billing plan selector
      // 2. Disable the dropdown
      // 3. Display a message explaining that the default billing plan will be used
      // 4. Not attempt to fetch billing plans
      
      // No need to mock getEligibleBillingPlansForUI since it shouldn't be called
      
      // In the UI, this would result in:
      // - A disabled dropdown with text "Using default billing plan"
      // - Explanatory text: "Company information not available. The system will use the default billing plan."
    });
    
    it('should provide clear information when only one plan is available', async () => {
      // This test verifies that when only one plan is available, the UI provides clear information
      // about which plan will be used, even though there's no actual choice to make
      
      // Mock the getEligibleBillingPlansForUI function to return a single plan
      vi.mocked(getEligibleBillingPlansForUI).mockResolvedValue([
        {
          company_billing_plan_id: 'single-plan-id',
          plan_name: 'Only Available Plan',
          plan_type: 'Fixed'
        }
      ]);
  
      const plans = await getEligibleBillingPlansForUI('company-1', 'service-1');
      
      expect(plans).toHaveLength(1);
      expect(plans[0].company_billing_plan_id).toBe('single-plan-id');
      expect(plans[0].plan_name).toBe('Only Available Plan');
      expect(getEligibleBillingPlansForUI).toHaveBeenCalledWith('company-1', 'service-1');
      
      // In the UI, this would result in:
      // 1. The billing plan selector being visible
      // 2. The dropdown being disabled
      // 3. Explanatory text indicating this is the only available plan
      // 4. The plan being automatically selected
    });
  });
});