/**
 * Unit tests for Asset Summary Actions
 *
 * Tests the server actions for computing asset summary metrics.
 *
 * NOTE: getAssetSummaryMetrics now runs inside `withAuth` + `withTransaction`
 * and performs an asset-read authorization check before computing metrics.
 * Tenant resolution moved to the `withAuth` boundary (read from the
 * authenticated user), so the old "No tenant found" guard inside the action was
 * removed; the equivalent now is `withAuth` throwing when there is no user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TEST_TENANT = 'test-tenant-123';
const TEST_ASSET_ID = 'asset-123';

// Faithful withAuth/withTransaction. The shared setup.ts withAuth mock never
// throws and resolves tenant from db context; here we drive the tenant directly
// from the (mocked) authenticated user so the auth-boundary behavior is exact.
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

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  getTenantContext: vi.fn(() => TEST_TENANT),
  runWithTenant: vi.fn((_tenant: string, cb: () => unknown) => cb()),
  withTransaction: vi.fn(async (knex: unknown, cb: (trx: unknown) => unknown) => cb(knex)),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

// Asset-read authorization always allows so the metric computation is exercised.
vi.mock('@alga-psa/authorization/kernel', () => ({
  RequestLocalAuthorizationCache: class {},
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(..._args: unknown[]) {}
  },
  createAuthorizationKernel: () => ({
    authorizeResource: vi.fn().mockResolvedValue({ allowed: true }),
  }),
}));

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import { getAssetSummaryMetrics } from '@alga-psa/assets/actions/assetActions';

/**
 * Build a chainable knex mock keyed by table name.
 *
 * @param tableConfig - per-table behavior:
 *   - `first`: value resolved by `.first()`
 *   - `rows`: value resolved when the builder is awaited directly (list queries)
 */
function createKnexMock(tableConfig: Record<string, { first?: unknown; rows?: unknown[] }>) {
  return vi.fn((tableName: string) => {
    const cfg = tableConfig[tableName] ?? {};
    const rows = cfg.rows ?? [];
    const builder: any = {
      where: vi.fn(() => builder),
      whereIn: vi.fn(() => builder),
      whereNot: vi.fn(() => builder),
      andWhere: vi.fn(() => builder),
      orWhere: vi.fn(() => builder),
      join: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      select: vi.fn(() => builder),
      count: vi.fn(() => builder),
      groupBy: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      offset: vi.fn(() => builder),
      clone: vi.fn(() => builder),
      modify: vi.fn(() => builder),
      first: vi.fn().mockResolvedValue(cfg.first ?? null),
      // Make the builder awaitable as a list query.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      catch: () => Promise.resolve(rows),
    };
    return builder;
  });
}

function mockAssetMetrics(asset: Record<string, unknown>) {
  const mockKnex = createKnexMock({
    user_roles: { rows: [] },
    team_members: { rows: [] },
    users: { rows: [] },
    asset_associations: { rows: [], first: { count: 0 } },
    // resolveAssetAuthorizationInputById + main asset lookup both query `assets`.
    assets: { first: { asset_id: TEST_ASSET_ID, client_id: null, ...asset } },
    workstation_assets: { first: null },
    server_assets: { first: null },
  });

  (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
    knex: mockKnex,
    tenant: TEST_TENANT,
  });

  return mockKnex;
}

describe('Asset Summary Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000001',
      tenant: TEST_TENANT,
      user_type: 'internal',
      roles: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAssetSummaryMetrics', () => {
    it('should throw when there is no authenticated user', async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      await expect(
        getAssetSummaryMetrics(TEST_ASSET_ID)
      ).rejects.toThrow();
    });

    it('should throw error when asset not found', async () => {
      const mockKnex = createKnexMock({
        user_roles: { rows: [] },
        team_members: { rows: [] },
        users: { rows: [] },
        asset_associations: { rows: [] },
        // Authorization lookup throws "Asset not found" when assets.first() is null.
        assets: { first: null },
      });

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      await expect(
        getAssetSummaryMetrics(TEST_ASSET_ID)
      ).rejects.toThrow('Failed to get asset summary metrics');
    });

    it('should return healthy status for online agent', async () => {
      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: null,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('healthy');
      expect(result.health_reason).toBeNull();
    });

    it('should return warning status for offline agent within 24 hours', async () => {
      const twentyHoursAgo = new Date();
      twentyHoursAgo.setHours(twentyHoursAgo.getHours() - 20);

      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: 'offline',
        last_seen_at: twentyHoursAgo.toISOString(),
        warranty_end_date: null,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('warning');
      expect(result.health_reason).toBe('Device offline');
    });

    it('should return critical status for offline agent over 72 hours', async () => {
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: 'offline',
        last_seen_at: fourDaysAgo.toISOString(),
        warranty_end_date: null,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('critical');
      expect(result.health_reason).toContain('days');
    });

    it('should return unknown status when no RMM data', async () => {
      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: null,
        last_seen_at: null,
        warranty_end_date: null,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('unknown');
      expect(result.health_reason).toBe('No RMM data available');
    });

    it('should calculate warranty status correctly', async () => {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: thirtyDaysFromNow.toISOString(),
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.warranty_status).toBe('expiring_soon');
      expect(result.warranty_days_remaining).toBeGreaterThan(0);
      expect(result.warranty_days_remaining).toBeLessThanOrEqual(90);
    });

    it('should return expired warranty status', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      mockAssetMetrics({
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: thirtyDaysAgo.toISOString(),
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.warranty_status).toBe('expired');
      expect(result.warranty_days_remaining).toBeLessThan(0);
    });
  });
});
