import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { determineDefaultContractLine, getEligibleContractLines, validateContractLineForService, shouldAllocateUnassignedEntry } from 'server/src/lib/utils/contractLineDisambiguation';
import { createTenantKnex } from 'server/src/lib/db';

// Mock the database connection
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('Contract Line Disambiguation Logic', () => {
  let mockKnex: any;
  const mockTenant = 'test_tenant';
  const mockClientId = 'test_client_id';
  const mockServiceId = 'test_service_id';

  beforeEach(() => {
    mockKnex = {
      join: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      andOn: vi.fn().mockReturnThis(),
      andOnVal: vi.fn().mockReturnThis(),
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

  describe('getEligibleContractLines', () => {
    it('should query for eligible contract lines', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 120 }
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await getEligibleContractLines(mockKnex, mockTenant, mockClientId, mockServiceId);

      expect(result).toEqual(mockContractLines);
      expect(mockKnex.join).toHaveBeenCalledTimes(2);
      expect(mockKnex.leftJoin).toHaveBeenCalledTimes(2);
      expect(mockKnex.where).toHaveBeenCalledWith({
        'client_contract_lines.client_id': mockClientId,
        'client_contract_lines.is_active': true,
        'client_contract_lines.tenant': mockTenant,
        'contract_line_services.service_id': mockServiceId,
      });
    });
  });

  describe('determineDefaultContractLine', () => {
    it('should return the only contract line when there is just one eligible contract line', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('contractLine1');
    });

    it('should return null when there are no eligible contract lines', async () => {
      mockKnex.select.mockResolvedValue([]);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return the contract line with a bucket overlay when there is only one overlay', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 300 }
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('contractLine2');
    });

    it('should return null when there are multiple eligible contract lines with no clear default', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return null when there are multiple contract lines with bucket overlays', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 180 }
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 45 }
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });
  });

  describe('validateContractLineForService', () => {
    it('should return true when the contract line is valid for the service', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 120 }
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(true);
    });

    it('should return false when the contract line is not valid for the service', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 240 }
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'contractLine3');

      expect(result).toBe(false);
    });
  });

  describe('shouldAllocateUnassignedEntry', () => {
    it('should return true when this is the only eligible contract line', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(true);
    });

    it('should return true when this is the only contract line with a bucket overlay', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 600 }
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine2');

      expect(result).toBe(true);
    });

    it('should return false when this is not the only eligible contract line and has no bucket overlay', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });

    it('should return false when there are multiple contract lines with bucket overlays', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 100 }
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { remaining_minutes: 50 }
        },
      ];

      mockKnex.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });
  });
});
