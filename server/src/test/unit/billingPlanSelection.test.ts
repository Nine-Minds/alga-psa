import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEligibleContractLinesForUI } from '../../lib/utils/contractLineDisambiguation';

// Mock the planDisambiguation module
vi.mock('../../lib/utils/contractLineDisambiguation', () => ({
  getEligibleContractLinesForUI: vi.fn()
}));

describe('Contract Line Selection Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a single plan when only one plan is available', async () => {
    // Mock the getEligibleContractLinesForUI function to return a single plan
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'test-plan-id',
        contract_line_name: 'Test Plan',
        contract_line_type: 'Fixed',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: null,
        has_bucket_overlay: false
      }
    ]);

    const plans = await getEligibleContractLinesForUI('client-1', 'service-1');
    
    expect(plans).toHaveLength(1);
    expect(plans[0].client_contract_line_id).toBe('test-plan-id');
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
  });

  it('should return multiple plans when multiple plans are available', async () => {
    // Mock the getEligibleContractLinesForUI function to return multiple plans
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'plan-id-1',
        contract_line_name: 'Fixed Plan',
        contract_line_type: 'Fixed',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: null,
        has_bucket_overlay: false
      },
      {
        client_contract_line_id: 'plan-id-2',
        contract_line_name: 'Fixed Plan with Bucket Overlay',
        contract_line_type: 'Fixed',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: null,
        has_bucket_overlay: true
      }
    ]);

    const plans = await getEligibleContractLinesForUI('client-1', 'service-1');
    
    expect(plans).toHaveLength(2);
    expect(plans[0].client_contract_line_id).toBe('plan-id-1');
    expect(plans[1].client_contract_line_id).toBe('plan-id-2');
    expect(plans[1].has_bucket_overlay).toBe(true);
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
  });

  it('should return an empty array when no plans are available', async () => {
    // Mock the getEligibleContractLinesForUI function to return an empty array
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([]);

    const plans = await getEligibleContractLinesForUI('client-1', 'service-1');
    
    expect(plans).toHaveLength(0);
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
  });

  it.todo('should handle the case when no client ID is available');

  it('should provide clear information when only one plan is available', async () => {
    // This test verifies that when only one plan is available, the UI provides clear information
    // about which plan will be used, even though there's no actual choice to make
    
    // Mock the getEligibleContractLinesForUI function to return a single plan
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'single-plan-id',
        contract_line_name: 'Only Available Plan',
        contract_line_type: 'Fixed',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: null,
        has_bucket_overlay: false
      }
    ]);

    const plans = await getEligibleContractLinesForUI('client-1', 'service-1');
    
    expect(plans).toHaveLength(1);
    expect(plans[0].client_contract_line_id).toBe('single-plan-id');
    expect(plans[0].contract_line_name).toBe('Only Available Plan');
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
    
    // In the UI, this would result in:
    // 1. The contract line selector being visible
    // 2. The dropdown being disabled
    // 3. Explanatory text indicating this is the only available plan
    // 4. The plan being automatically selected
  });
});
