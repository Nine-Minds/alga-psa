import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { determineDefaultContractLine, getEligibleContractLines, validateContractLineForService, shouldAllocateUnassignedEntry } from 'server/src/lib/utils/contractLineDisambiguation';
import { createTenantKnex } from 'server/src/lib/db';

// Mock the database connection
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('Contract Line Disambiguation Logic', () => {
  let mockKnex: any;
  let contractLinesBuilder: any;
  let serviceCatalogBuilder: any;
  let mockServiceInfo: any;
  let mockContractLines: any[];
  const mockTenant = 'test_tenant';
  const mockClientId = 'test_client_id';
  const mockServiceId = 'test_service_id';

  beforeEach(() => {
    mockServiceInfo = { category_id: 'category-1', service_type_id: 'type-1' };
    mockContractLines = [];

    serviceCatalogBuilder = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(async () => mockServiceInfo),
    };

    contractLinesBuilder = {
      join: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(function (arg: unknown) {
        if (typeof arg === 'function') {
          arg.call(contractLinesBuilder);
          return contractLinesBuilder;
        }
        return contractLinesBuilder;
      }),
      whereNull: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      andOn: vi.fn().mockReturnThis(),
      andOnVal: vi.fn().mockReturnThis(),
      select: vi.fn().mockImplementation(async () => mockContractLines),
    };

    mockKnex = vi.fn((tableName: string) => {
      if (tableName === 'service_catalog') {
        return serviceCatalogBuilder;
      }
      return contractLinesBuilder;
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
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 120
        },
      ];

      const result = await getEligibleContractLines(mockKnex, mockTenant, mockClientId, mockServiceId);

      expect(result).toHaveLength(2);
      expect(result[1].bucket_overlay?.config_id).toBe('bucket-1');
      expect(contractLinesBuilder.join).toHaveBeenCalledTimes(3);
      expect(contractLinesBuilder.leftJoin).toHaveBeenCalledTimes(2);
      expect(contractLinesBuilder.where).toHaveBeenCalledWith({
        'client_contracts.client_id': mockClientId,
        'client_contracts.is_active': true,
        'client_contracts.tenant': mockTenant,
        'contract_line_services.service_id': mockServiceId,
      });
    });
  });

  describe('determineDefaultContractLine', () => {
    it('should return the only contract line when there is just one eligible contract line', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('contractLine1');
    });

    it('should return null when there are no eligible contract lines', async () => {
      mockContractLines = [];

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return the contract line with a bucket overlay when there is only one overlay', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 300
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('contractLine2');
    });

    it('should return null when there are multiple eligible contract lines with no clear default', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return null when there are multiple contract lines with bucket overlays', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 180
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-2',
          bucket_total_minutes: 45
        },
      ];

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });
  });

  describe('validateContractLineForService', () => {
    it('should return true when the contract line is valid for the service', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 120
        },
      ];

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(true);
    });

    it('should return false when the contract line is not valid for the service', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 240
        },
      ];

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'contractLine3');

      expect(result).toBe(false);
    });
  });

  describe('shouldAllocateUnassignedEntry', () => {
    it('should return true when this is the only eligible contract line', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(true);
    });

    it('should return true when this is the only contract line with a bucket overlay', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 600
        },
        {
          client_contract_line_id: 'contractLine3',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine2');

      expect(result).toBe(true);
    });

    it('should return false when this is not the only eligible contract line and has no bucket overlay', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
        },
      ];

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });

    it('should return false when there are multiple contract lines with bucket overlays', async () => {
      mockContractLines = [
        {
          client_contract_line_id: 'contractLine1',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-1',
          bucket_total_minutes: 100
        },
        {
          client_contract_line_id: 'contractLine2',
          contract_line_type: 'Fixed',
          bucket_config_id: 'bucket-2',
          bucket_total_minutes: 50
        },
      ];

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'contractLine1');

      expect(result).toBe(false);
    });
  });
});
