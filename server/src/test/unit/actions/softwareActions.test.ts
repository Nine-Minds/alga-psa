/**
 * Unit tests for Software Actions
 *
 * Tests the server actions for software inventory management.
 *
 * NOTE: Tenant resolution now happens at the `withAuth` boundary (the action
 * reads `tenant` from the authenticated user's context, not from
 * `createTenantKnex`). The previous "No tenant found" guard inside the action
 * was removed; the equivalent now is `withAuth` throwing when there is no
 * authenticated user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

const TEST_TENANT = 'test-tenant-123';
const TEST_ASSET_ID = 'asset-123';

// Mock the database module. `withAuth` (mocked in setup.ts) resolves the tenant
// through getCurrentTenantId() -> getTenantContext(), so the db mock must
// expose getTenantContext/runWithTenant in addition to createTenantKnex.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  getTenantContext: vi.fn(() => TEST_TENANT),
  runWithTenant: vi.fn((_tenant: string, cb: () => unknown) => cb()),
  withTransaction: vi.fn(async (knex: unknown, cb: (trx: unknown) => unknown) => cb(knex)),
}));

// Faithful withAuth: reads tenant from the authenticated user and throws when
// there is no user (mirrors packages/auth/src/lib/withAuth.ts). The shared
// setup.ts mock intentionally never throws, so we override it here to exercise
// the auth boundary.
const { mockGetCurrentUser } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: mockGetCurrentUser,
  hasPermission: vi.fn().mockResolvedValue(true),
  withAuth: (handler: (...args: any[]) => any) => async (...args: any[]) => {
    const user = await mockGetCurrentUser();
    if (!user) {
      throw new Error('User not authenticated');
    }
    return handler(user, { tenant: user.tenant }, ...args);
  },
}));

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import {
  getAssetSoftware,
  getAssetSoftwareSummary,
} from '@alga-psa/assets/actions/softwareActions';

// Mock query builder
function createMockQueryBuilder(returnData: unknown): Partial<Knex.QueryBuilder> {
  const mockBuilder: Partial<Knex.QueryBuilder> = {
    where: vi.fn().mockReturnThis(),
    whereILike: vi.fn().mockReturnThis(),
    orWhereILike: vi.fn().mockReturnThis(),
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
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000001',
      tenant: TEST_TENANT,
      roles: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAssetSoftware', () => {
    it('should throw when there is no authenticated user', async () => {
      (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        getAssetSoftware({ asset_id: TEST_ASSET_ID })
      ).rejects.toThrow();
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
    it('should throw when there is no authenticated user', async () => {
      (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        getAssetSoftwareSummary(TEST_ASSET_ID)
      ).rejects.toThrow();
    });

    it('should return summary statistics', async () => {
      const mockQueryBuilder = createMockQueryBuilder({ count: 25 });
      // groupBy-terminated stat queries are awaited as arrays, while count
      // queries terminate with .first() and return { count }.
      (mockQueryBuilder.then as ReturnType<typeof vi.fn>).mockImplementation(
        (callback) => callback([])
      );
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
