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
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => {
      const alias = table.match(/\s+as\s+([^\s]+)$/i)?.[1] ?? table.split(/\s+/).pop() ?? table;
      return conn(table).where(`${alias}.tenant`, tenant);
    },
  }),
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

vi.mock('@alga-psa/assets/lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn().mockResolvedValue({}),
  isAssetReadAllowed: vi.fn().mockResolvedValue(true),
}));

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { isAssetReadAllowed } from '@alga-psa/assets/lib/assetReadAuthorization';
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

// Authorization lookups and inventory queries return different row shapes.
// Keeping them separate prevents an empty authorization result from making an
// inventory test pass without ever exercising the inventory query.
function createInventoryKnex(inventory: Partial<Knex.QueryBuilder>) {
  const tables = {
    assets: createMockQueryBuilder({ asset_id: TEST_ASSET_ID, client_id: 'client-123' }),
    clients: createMockQueryBuilder({ client_id: 'client-123' }),
    v_asset_software_details: inventory,
  };
  return vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
    return tables[table as keyof typeof tables];
  });
}

describe('Software Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(isAssetReadAllowed).mockResolvedValue(true);
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

    it('should return a permission error without asset:read', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);
      const mockKnex = vi.fn();
      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({ knex: mockKnex, tenant: TEST_TENANT });

      const result = await getAssetSoftware({ asset_id: TEST_ASSET_ID });

      expect(result).toHaveProperty('permissionError');
      expect(hasPermission).toHaveBeenCalledWith(expect.anything(), 'asset', 'read');
      expect(mockKnex).not.toHaveBeenCalled();
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

      const mockQueryBuilder = createMockQueryBuilder({ count: 51 });
      const mockKnex = createInventoryKnex(mockQueryBuilder);

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
        page: 2,
        limit: 50,
      });

      expect(result).toEqual({ software: mockSoftware, total: 51, page: 2, limit: 50 });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(50);
    });

    it('should apply filters correctly', async () => {
      const mockQueryBuilder = createMockQueryBuilder({ count: 0 });
      const mockKnex = createInventoryKnex(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      (mockQueryBuilder.then as ReturnType<typeof vi.fn>).mockImplementation(
        (callback) => callback([])
      );

      const result = await getAssetSoftware({
        asset_id: TEST_ASSET_ID,
        category: 'Security',
        software_type: 'application',
        search: 'Norton',
        include_uninstalled: true,
      });

      expect(result).toEqual({ software: [], total: 0, page: 1, limit: 50 });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('category', 'Security');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('software_type', 'application');
      expect(mockQueryBuilder.where).not.toHaveBeenCalledWith('is_current', true);
    });
  });

  it('returns empty inventory and summary when per-asset read access is denied', async () => {
    vi.mocked(isAssetReadAllowed).mockResolvedValue(false);
    // Populated inventory would expose this fixture if the read guard regressed.
    const inventory = createMockQueryBuilder({ count: 25 });
    const mockKnex = createInventoryKnex(inventory);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: mockKnex } as any);

    expect(await getAssetSoftware({ asset_id: TEST_ASSET_ID })).toEqual({
      software: [], total: 0, page: 1, limit: 50,
    });
    expect(await getAssetSoftwareSummary(TEST_ASSET_ID)).toEqual({
      total_installed: 0,
      by_category: {},
      by_type: { application: 0, driver: 0, update: 0, system: 0 },
      security_software_count: 0,
      managed_software_count: 0,
      recently_installed_count: 0,
    });
    expect(mockKnex).not.toHaveBeenCalledWith('v_asset_software_details');
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
      // Grouped queries return arrays; scalar counts terminate with .first().
      (mockQueryBuilder.then as ReturnType<typeof vi.fn>).mockImplementation(
        (callback) => callback([])
      ).mockImplementationOnce(
        (callback) => callback([{ category: 'Security', count: '25' }])
      ).mockImplementationOnce(
        (callback) => callback([{ software_type: 'application', count: '25' }])
      );
      const mockKnex = createInventoryKnex(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSoftwareSummary(TEST_ASSET_ID);

      expect(result).toEqual({
        total_installed: 25,
        by_category: { Security: 25 },
        by_type: { application: 25, driver: 0, update: 0, system: 0 },
        security_software_count: 25,
        managed_software_count: 25,
        recently_installed_count: 25,
      });
    });
  });
});
