import { describe, it, expect, afterEach, vi } from 'vitest';
import { getContractLines, createContractLine } from 'server/src/lib/actions/contractLineAction';
import ContractLine from 'server/src/lib/models/contractLine';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';

vi.mock('@/lib/models/contractLine');
vi.mock('@/lib/db/db');

describe('Contract Line Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getContractLines', () => {
    it('should return all contract lines', async () => {
      const mockContractLines: IContractLine[] = [
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

      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(mockContractLines);

      const result = await getContractLines();

      expect(result).toEqual(mockContractLines);
      expect(ContractLine.getAll).toHaveBeenCalled();
    });

    it('should throw an error if fetching contract lines fails', async () => {
      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getContractLines()).rejects.toThrow('Failed to fetch client contract lines');
    });
  });

  describe('createContractLine', () => {
    it('should create a new contract line', async () => {
      const newContractLine: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Contract Line',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      const createdContractLine: IContractLine = { ...newContractLine, contract_line_id: '3' };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdContractLine);

      const result = await createContractLine(newContractLine);

      expect(result).toEqual(createdContractLine);
      expect(ContractLine.create).toHaveBeenCalledWith(newContractLine);
    });

    it('should throw an error if creating a contract line fails', async () => {
      const newContractLine: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Contract Line',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(createContractLine(newContractLine)).rejects.toThrow('Failed to create contract line');
    });
  });
});