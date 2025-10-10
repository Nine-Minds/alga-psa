import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { determineDefaultContractLine, getEligibleContractLines, validateContractLineForService, shouldAllocateUnassignedEntry } from 'server/src/lib/utils/planDisambiguation';
import { createTenantKnex } from 'server/src/lib/db';

// Mock the database connection
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('Plan Disambiguation Logic', () => {
  let mockKnex: any;
  const mockTenant = 'test_tenant';
  const mockClientId = 'test_client_id';
  const mockServiceId = 'test_service_id';

  beforeEach(() => {
    mockKnex = {
      join: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
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
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await getEligibleContractLines(mockKnex, mockTenant, mockClientId, mockServiceId);

      expect(result).toEqual(mockPlans);
      expect(mockKnex.join).toHaveBeenCalledTimes(2);
      expect(mockKnex.where).toHaveBeenCalledWith({
        'client_contract_lines.client_id': mockClientId,
        'client_contract_lines.is_active': true,
        'client_contract_lines.tenant': mockTenant,
        'contract_line_services.service_id': mockServiceId,
      });
    });
  });

  describe('determineDefaultContractLine', () => {
    it('should return the only plan when there is just one eligible plan', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('plan1');
    });

    it('should return null when there are no eligible plans', async () => {
      mockKnex.select.mockResolvedValue([]);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return the bucket plan when there is only one bucket plan', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
        {
          client_contract_line_id: 'plan3',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBe('plan2');
    });

    it('should return null when there are multiple eligible plans with no clear default', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });

    it('should return null when there are multiple bucket plans', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Bucket',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await determineDefaultContractLine(mockClientId, mockServiceId);

      expect(result).toBeNull();
    });
  });

  describe('validateContractLineForService', () => {
    it('should return true when the contract line is valid for the service', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'plan1');

      expect(result).toBe(true);
    });

    it('should return false when the contract line is not valid for the service', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await validateContractLineForService(mockClientId, mockServiceId, 'plan3');

      expect(result).toBe(false);
    });
  });

  describe('shouldAllocateUnassignedEntry', () => {
    it('should return true when this is the only eligible plan', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'plan1');

      expect(result).toBe(true);
    });

    it('should return true when this is the only bucket plan', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
        {
          client_contract_line_id: 'plan3',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'plan2');

      expect(result).toBe(true);
    });

    it('should return false when this is not the only eligible plan and not a bucket plan', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Fixed',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Fixed',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'plan1');

      expect(result).toBe(false);
    });

    it('should return false when there are multiple bucket plans', async () => {
      const mockPlans = [
        {
          client_contract_line_id: 'plan1',
          contract_line_type: 'Bucket',
        },
        {
          client_contract_line_id: 'plan2',
          contract_line_type: 'Bucket',
        },
      ];

      mockKnex.select.mockResolvedValue(mockPlans);

      const result = await shouldAllocateUnassignedEntry(mockClientId, mockServiceId, 'plan1');

      expect(result).toBe(false);
    });
  });
});