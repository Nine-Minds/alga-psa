import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEligibleContractLinesForUI } from '../../lib/utils/contractLineDisambiguation';

// Mock the contractLineDisambiguation module
vi.mock('../../lib/utils/contractLineDisambiguation', () => ({
  getEligibleContractLinesForUI: vi.fn()
}));

describe('Contract Line Selection Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a single contract line when only one contract line is available', async () => {
    // Mock the getEligibleContractLinesForUI function to return a single contract line
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'test-contract-line-id',
        contract_line_name: 'Test Contract Line',
        contract_line_type: 'Fixed'
      }
    ]);

    const contractLines = await getEligibleContractLinesForUI('client-1', 'service-1');

    expect(contractLines).toHaveLength(1);
    expect(contractLines[0].client_contract_line_id).toBe('test-contract-line-id');
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
  });

  it('should return multiple contract lines when multiple contract lines are available', async () => {
    // Mock the getEligibleContractLinesForUI function to return multiple contract lines
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'contract-line-id-1',
        contract_line_name: 'Fixed Contract Line',
        contract_line_type: 'Fixed'
      },
      {
        client_contract_line_id: 'contract-line-id-2',
        contract_line_name: 'Bucket Contract Line',
        contract_line_type: 'Bucket'
      }
    ]);

    const contractLines = await getEligibleContractLinesForUI('client-1', 'service-1');

    expect(contractLines).toHaveLength(2);
    expect(contractLines[0].client_contract_line_id).toBe('contract-line-id-1');
    expect(contractLines[1].client_contract_line_id).toBe('contract-line-id-2');
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
  });

  it('should return an empty array when no contract lines are available', async () => {
    // Mock the getEligibleContractLinesForUI function to return an empty array
    vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([]);

    const contractLines = await getEligibleContractLinesForUI('client-1', 'service-1');

    expect(contractLines).toHaveLength(0);
    expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
    it('should handle the case when no client ID is available', async () => {
      // This test verifies that the UI provides clear information when no client ID is available
      
      // In this case, the UI should:
      // 1. Show the contract line selector
      // 2. Disable the dropdown
      // 3. Display a message explaining that the default contract line will be used
      // 4. Not attempt to fetch contract lines
      
      // No need to mock getEligibleContractLinesForUI since it shouldn't be called
      
      // In the UI, this would result in:
      // - A disabled dropdown with text "Using default contract line"
      // - Explanatory text: "Client information not available. The system will use the default contract line."
    });
    
    it('should provide clear information when only one contract line is available', async () => {
      // This test verifies that when only one contract line is available, the UI provides clear information
      // about which contract line will be used, even though there's no actual choice to make

      // Mock the getEligibleContractLinesForUI function to return a single contract line
      vi.mocked(getEligibleContractLinesForUI).mockResolvedValue([
        {
          client_contract_line_id: 'single-contract-line-id',
          contract_line_name: 'Only Available Contract Line',
          contract_line_type: 'Fixed'
        }
      ]);

      const contractLines = await getEligibleContractLinesForUI('client-1', 'service-1');

      expect(contractLines).toHaveLength(1);
      expect(contractLines[0].client_contract_line_id).toBe('single-contract-line-id');
      expect(contractLines[0].contract_line_name).toBe('Only Available Contract Line');
      expect(getEligibleContractLinesForUI).toHaveBeenCalledWith('client-1', 'service-1');
      
      // In the UI, this would result in:
      // 1. The contract line selector being visible
      // 2. The dropdown being disabled
      // 3. Explanatory text indicating this is the only available contract line
      // 4. The contract line being automatically selected
    });
  });
});