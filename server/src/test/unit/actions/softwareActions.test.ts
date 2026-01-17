/**
 * Unit tests for Software Actions
 *
 * Tests the server actions for software inventory management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

// Mock the database module
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

import { createTenantKnex } from '@alga-psa/db';
import {
  getAssetSoftware,
  getAssetSoftwareSummary,
} from '@alga-psa/assets/actions/softwareActions';

// Test data
const TEST_TENANT = 'test-tenant-123';
const TEST_ASSET_ID = 'asset-123';

// Mock query builder
function createMockQueryBuilder(returnData: unknown): Partial<Knex.QueryBuilder> {
  const mockBuilder: Partial<Knex.QueryBuilder> = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    clone: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(returnData),
    then: vi.fn().mockImplementation((callback) => callback(returnData)),
  };
  return mockBuilder;
}

describe('Software Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAssetSoftware', () => {
    it('should throw error when no tenant found', async () => {
      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: vi.fn(),
        tenant: null,
      });

      await expect(
        getAssetSoftware({ asset_id: TEST_ASSET_ID })
      ).rejects.toThrow('No tenant found');
    });

    it('should return paginated software list', async () => {
      const mockSoftware = [
        {
          software_id: 'sw-1',
          name: 'Microsoft Office',
          publisher: 'Microsoft',
          category: 'Productivity',
          software_type: 'application',
          version: '365',
          install_date: '2024-01-15',
          size_bytes: 1024000,
          first_seen_at: '2024-01-15T10:00:00Z',
          is_current: true,
          is_managed: true,
          is_security_relevant: false,
        },
      ];

      const mockQueryBuilder = createMockQueryBuilder({ count: 1 });
      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      // Override the then to return the software list
      (mockQueryBuilder.then as ReturnType<typeof vi.fn>).mockImplementation(
        (callback) => callback(mockSoftware)
      );

      const result = await getAssetSoftware({
        asset_id: TEST_ASSET_ID,
        page: 1,
        limit: 50,
      });

      expect(result).toHaveProperty('software');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page', 1);
      expect(result).toHaveProperty('limit', 50);
      expect(mockKnex).toHaveBeenCalledWith('v_asset_software_details');
    });

    it('should apply filters correctly', async () => {
      const mockQueryBuilder = createMockQueryBuilder({ count: 0 });
      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      (mockQueryBuilder.then as ReturnType<typeof vi.fn>).mockImplementation(
        (callback) => callback([])
      );

      await getAssetSoftware({
        asset_id: TEST_ASSET_ID,
        category: 'Security',
        software_type: 'application',
        search: 'Norton',
        include_uninstalled: true,
      });

      // Verify where was called multiple times for filters
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe('getAssetSoftwareSummary', () => {
    it('should throw error when no tenant found', async () => {
      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: vi.fn(),
        tenant: null,
      });

      await expect(
        getAssetSoftwareSummary(TEST_ASSET_ID)
      ).rejects.toThrow('No tenant found');
    });

    it('should return summary statistics', async () => {
      const mockQueryBuilder = createMockQueryBuilder({ count: 25 });
      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSoftwareSummary(TEST_ASSET_ID);

      expect(result).toHaveProperty('total_installed');
      expect(result).toHaveProperty('by_category');
      expect(result).toHaveProperty('by_type');
      expect(result).toHaveProperty('security_software_count');
      expect(result).toHaveProperty('managed_software_count');
      expect(result).toHaveProperty('recently_installed_count');
    });
  });
});
