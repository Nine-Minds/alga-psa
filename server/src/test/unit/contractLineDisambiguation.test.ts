import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { determineDefaultContractLine, getEligibleContractLines, validateContractLineForService, shouldAllocateUnassignedEntry } from 'server/src/lib/utils/contractLineDisambiguation';
import { createTenantKnex } from 'server/src/lib/db';

// Mock the database connection
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('Contract Line Disambiguation Logic', () => {
  let mockKnex: any;
  let serviceCatalogBuilder: any;
  let eligibleLinesBuilder: any;
  const mockTenant = 'test_tenant';
  const mockClientId = 'test_client_id';
  const mockServiceId = 'test_service_id';

  beforeEach(() => {
    serviceCatalogBuilder = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        category_id: null,
        service_type_id: 'service-type-1',
      }),
    };

    eligibleLinesBuilder = {
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

    mockKnex = vi.fn((table: string) => {
      if (table === 'service_catalog') {
        return serviceCatalogBuilder;
      }

      if (table === 'client_contracts') {
        return eligibleLinesBuilder;
      }

      throw new Error(`Unexpected table ${table}`);
    });

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
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 120 }
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

      const result = await getEligibleContractLines(mockKnex, mockTenant, mockClientId, mockServiceId);

      expect(result).toEqual([
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          start_date: '',
          end_date: null,
          bucket_overlay: undefined,
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          start_date: '',
          end_date: null,
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 120 },
        },
      ]);
      expect(eligibleLinesBuilder.join).toHaveBeenCalledTimes(3);
      expect(eligibleLinesBuilder.leftJoin).toHaveBeenCalledTimes(2);
      expect(eligibleLinesBuilder.where).toHaveBeenCalledWith({
        'client_contracts.client_id': mockClientId,
        'client_contracts.is_active': true,
        'client_contracts.tenant': mockTenant,
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

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('contractLine1');
    });

    it('should return null when there are no eligible contract lines', async () => {
      eligibleLinesBuilder.select.mockResolvedValue([]);

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
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 300 }
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return null when there are multiple contract lines with bucket overlays', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_overlay: { config_id: 'bucket-config-1', total_minutes: 180 }
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 45 }
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 120 }
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 240 }
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 600 }
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

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

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });

    it('should return false when there are multiple contract lines with bucket overlays', async () => {
      const mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_overlay: { config_id: 'bucket-config-1', total_minutes: 100 }
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_overlay: { config_id: 'bucket-config-2', total_minutes: 50 }
        },
      ];

      eligibleLinesBuilder.select.mockResolvedValue(mockContractLines);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });
  });
});
