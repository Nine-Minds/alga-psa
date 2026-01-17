/**
 * Unit tests for Asset Summary Actions
 *
 * Tests the server actions for computing asset summary metrics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

import { createTenantKnex } from '@alga-psa/db';
import { getAssetSummaryMetrics } from '@alga-psa/assets/actions/assetActions';

// Test data
const TEST_TENANT = 'test-tenant-123';
const TEST_ASSET_ID = 'asset-123';

describe('Asset Summary Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAssetSummaryMetrics', () => {
    it('should throw error when no tenant found', async () => {
      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: vi.fn(),
        tenant: null,
      });

      await expect(
        getAssetSummaryMetrics(TEST_ASSET_ID)
      ).rejects.toThrow('No tenant found');
    });

    it('should throw error when asset not found', async () => {
      const mockKnex = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
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
      const mockAsset = {
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: null,
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(mockAsset),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      // First call returns asset, second returns ticket count, third returns null extension data
      mockQueryBuilder.first
        .mockResolvedValueOnce(mockAsset)
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce(null);

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('healthy');
      expect(result.health_reason).toBeNull();
    });

    it('should return warning status for offline agent within 24 hours', async () => {
      const twentyHoursAgo = new Date();
      twentyHoursAgo.setHours(twentyHoursAgo.getHours() - 20);

      const mockAsset = {
        asset_type: 'workstation',
        agent_status: 'offline',
        last_seen_at: twentyHoursAgo.toISOString(),
        warranty_end_date: null,
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(mockAsset)
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce(null),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('warning');
      expect(result.health_reason).toBe('Device offline');
    });

    it('should return critical status for offline agent over 72 hours', async () => {
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      const mockAsset = {
        asset_type: 'workstation',
        agent_status: 'offline',
        last_seen_at: fourDaysAgo.toISOString(),
        warranty_end_date: null,
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(mockAsset)
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce(null),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('critical');
      expect(result.health_reason).toContain('days');
    });

    it('should return unknown status when no RMM data', async () => {
      const mockAsset = {
        asset_type: 'workstation',
        agent_status: null,
        last_seen_at: null,
        warranty_end_date: null,
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(mockAsset)
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce(null),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.health_status).toBe('unknown');
      expect(result.health_reason).toBe('No RMM data available');
    });

    it('should calculate warranty status correctly', async () => {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const mockAsset = {
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: thirtyDaysFromNow.toISOString(),
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(mockAsset)
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce(null),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.warranty_status).toBe('expiring_soon');
      expect(result.warranty_days_remaining).toBeGreaterThan(0);
      expect(result.warranty_days_remaining).toBeLessThanOrEqual(90);
    });

    it('should return expired warranty status', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const mockAsset = {
        asset_type: 'workstation',
        agent_status: 'online',
        last_seen_at: new Date().toISOString(),
        warranty_end_date: thirtyDaysAgo.toISOString(),
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        join: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(mockAsset)
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce(null),
      };

      const mockKnex = vi.fn().mockReturnValue(mockQueryBuilder);

      (createTenantKnex as ReturnType<typeof vi.fn>).mockResolvedValue({
        knex: mockKnex,
        tenant: TEST_TENANT,
      });

      const result = await getAssetSummaryMetrics(TEST_ASSET_ID);

      expect(result.warranty_status).toBe('expired');
      expect(result.warranty_days_remaining).toBeLessThan(0);
    });
  });
});
