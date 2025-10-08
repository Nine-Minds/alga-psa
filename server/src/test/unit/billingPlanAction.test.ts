import { describe, it, expect, afterEach, vi } from 'vitest';
import { getContractLines, createContractLine } from 'server/src/lib/actions/contractLineAction';
import ContractLine from 'server/src/lib/models/contractLine';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';

vi.mock('@/lib/models/contractLine');
vi.mock('@/lib/db/db');

describe('Billing Plan Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getContractLines', () => {
    it('should return all contract lines', async () => {
      const mockPlans: IContractLine[] = [
        { 
          contract_line_id: '1', 
          contract_line_name: 'Basic', 
          billing_frequency: 'monthly', 
          is_custom: false,
          contract_line_type: 'Fixed'
        },
        { 
          contract_line_id: '2', 
          contract_line_name: 'Pro', 
          billing_frequency: 'yearly', 
          is_custom: false,
          contract_line_type: 'Hourly'
        },
      ];

      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(mockPlans);

      const result = await getContractLines();

      expect(result).toEqual(mockPlans);
      expect(ContractLine.getAll).toHaveBeenCalled();
    });

    it('should throw an error if fetching plans fails', async () => {
      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getContractLines()).rejects.toThrow('Failed to fetch client contract lines');
    });
  });

  describe('createContractLine', () => {
    it('should create a new contract line', async () => {
      const newPlan: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Plan',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      const createdPlan: IContractLine = { ...newPlan, contract_line_id: '3' };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdPlan);

      const result = await createContractLine(newPlan);

      expect(result).toEqual(createdPlan);
      expect(ContractLine.create).toHaveBeenCalledWith(newPlan);
    });

    it('should throw an error if creating a plan fails', async () => {
      const newPlan: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Plan',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(createContractLine(newPlan)).rejects.toThrow('Failed to create contract line');
    });
  });
});