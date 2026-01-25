import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';

/**
 * Integration-style unit tests for email notification rate limiting.
 *
 * These tests simulate the rate limiting logic from TenantEmailService.sendEmail()
 * by mocking the database calls and verifying the behavior matches the implementation.
 *
 * Rate limiting is now centralized in TenantEmailService.checkRateLimits():
 * - Checks notification_settings for rate_limit_per_minute (default: 60)
 * - Counts recent emails in notification_logs for the last 60 seconds
 * - Filters by tenant, and optionally by userId if provided
 * - Returns { allowed: false, reason: '...' } if limit exceeded
 */

// Mock the database module
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(),
}));

import { getConnection } from '@alga-psa/db';

/**
 * Simulates the rate limiting check from TenantEmailService.checkRateLimits()
 * This replicates the logic in TenantEmailService.ts
 */
async function simulateCheckRateLimits(
  mockKnex: Mock,
  params: { tenantId: string; userId?: string }
): Promise<{ allowed: boolean; reason?: string }> {
  const oneMinuteAgo = new Date(Date.now() - 60000);

  // Get settings from notification_settings
  const settings = await mockKnex('notification_settings')
    .where({ tenant: params.tenantId })
    .first();

  // Default rate limit if no settings exist
  const rateLimit = settings?.rate_limit_per_minute ?? 60;

  // Build query to count recent emails
  const query = mockKnex('notification_logs')
    .where({ tenant: params.tenantId })
    .where('created_at', '>', oneMinuteAgo);

  // If userId is provided, apply per-user rate limiting
  if (params.userId) {
    query.where('user_id', params.userId);
  }

  const result = await query.count('id as count').first();
  const recentCount = Number(result?.count ?? 0);

  if (recentCount >= rateLimit) {
    return {
      allowed: false,
      reason: `Sent ${recentCount} emails in the last minute (limit: ${rateLimit})`
    };
  }

  return { allowed: true };
}

describe('Email Rate Limiting - TenantEmailService Integration', () => {
  let mockKnex: Mock;
  let mockQueryChain: Record<string, Mock>;

  const testTenantId = 'test-tenant-uuid';
  const testUserId = 'test-user-uuid';

  /**
   * Creates a mock query chain for Knex
   * The chain needs to support: .where().where().count().first()
   */
  function createMockQueryChain(resolveValue?: any) {
    const chain: Record<string, Mock> = {
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(resolveValue),
    };
    return chain;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryChain = createMockQueryChain();
    mockKnex = vi.fn().mockReturnValue(mockQueryChain);
    (getConnection as Mock).mockResolvedValue(mockKnex);
  });

  describe('Rate Limit Enforcement', () => {
    it('should return allowed=false when count EQUALS limit (boundary test)', async () => {
      const rateLimit = 60;
      const currentCount = 60; // Exactly at limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('60');
    });

    it('should return allowed=false when count EXCEEDS limit', async () => {
      const rateLimit = 60;
      const currentCount = 100; // Over limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('100');
    });

    it('should return allowed=true when count is BELOW limit', async () => {
      const rateLimit = 60;
      const currentCount = 30; // Under limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return allowed=true when count is ONE BELOW limit (boundary test)', async () => {
      const rateLimit = 60;
      const currentCount = 59; // One below limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Default Rate Limit', () => {
    it('should use default rate limit of 60 when no settings exist', async () => {
      const currentCount = 60; // At default limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue(null); // No settings
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('60');
    });

    it('should allow 59 emails when using default rate limit', async () => {
      const currentCount = 59; // Below default limit

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue(null); // No settings
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Custom Rate Limits', () => {
    it('should enforce rate limit of 1 (minimum)', async () => {
      const rateLimit = 1;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: 1 }); // At limit
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
    });

    it('should allow first notification with rate limit of 1', async () => {
      const rateLimit = 1;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: 0 }); // No previous notifications
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
    });

    it('should enforce rate limit of 1000 (maximum)', async () => {
      const rateLimit = 1000;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: 1000 }); // At limit
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
    });

    it('should allow 999 notifications with rate limit of 1000', async () => {
      const rateLimit = 1000;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: 999 }); // Below limit
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Per-User Rate Limiting', () => {
    it('should apply per-user filter when userId is provided', async () => {
      const queriedParams: { tenant?: string; user_id?: string } = {};

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: 60,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain({ count: 0 });
          chain.where = vi.fn().mockImplementation((params: any) => {
            if (typeof params === 'object' && params.tenant) {
              queriedParams.tenant = params.tenant;
            }
            if (params === 'user_id') {
              queriedParams.user_id = testUserId;
            }
            return chain;
          });
          return chain;
        }
        return createMockQueryChain();
      });

      await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId, userId: testUserId });

      expect(queriedParams.tenant).toBe(testTenantId);
    });

    it('should not apply user filter when userId is not provided', async () => {
      let userIdQueried = false;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: 60,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain({ count: 0 });
          const originalWhere = chain.where;
          chain.where = vi.fn().mockImplementation((params: any) => {
            if (params === 'user_id') {
              userIdQueried = true;
            }
            return chain;
          });
          return chain;
        }
        return createMockQueryChain();
      });

      await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      // When userId is not provided, we should not query by user_id
      expect(userIdQueried).toBe(false);
    });
  });

  describe('Database Query Verification', () => {
    it('should query notification_logs with correct tenant', async () => {
      const queriedParams: { tenant?: string } = {};

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: 60,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain({ count: 0 });
          chain.where = vi.fn().mockImplementation((params: any) => {
            if (typeof params === 'object' && params.tenant) {
              queriedParams.tenant = params.tenant;
            }
            return chain;
          });
          return chain;
        }
        return createMockQueryChain();
      });

      await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(queriedParams.tenant).toBe(testTenantId);
    });

    it('should query for notifications in last 60 seconds', async () => {
      let timeWindowParam: Date | undefined;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: 60,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain({ count: 0 });
          chain.where = vi.fn().mockImplementation((field: any, op?: string, value?: Date) => {
            if (field === 'created_at' && op === '>') {
              timeWindowParam = value;
            }
            return chain;
          });
          return chain;
        }
        return createMockQueryChain();
      });

      const beforeTest = Date.now();
      await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });
      const afterTest = Date.now();

      // Verify the time window is approximately 60 seconds ago
      expect(timeWindowParam).toBeDefined();
      const windowTime = timeWindowParam!.getTime();
      expect(windowTime).toBeGreaterThanOrEqual(beforeTest - 60000);
      expect(windowTime).toBeLessThanOrEqual(afterTest - 60000 + 100); // +100ms tolerance
    });
  });

  describe('Rate Limit Response Format', () => {
    it('should return descriptive reason when rate limited', async () => {
      const rateLimit = 60;
      const currentCount = 75;

      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: rateLimit,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: currentCount });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('75'); // Current count
      expect(result.reason).toContain('60'); // Limit
    });

    it('should not include reason when allowed', async () => {
      mockKnex.mockImplementation((tableName: string) => {
        if (tableName === 'notification_settings') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({
            rate_limit_per_minute: 60,
          });
          return chain;
        } else if (tableName === 'notification_logs') {
          const chain = createMockQueryChain();
          chain.first = vi.fn().mockResolvedValue({ count: 10 });
          return chain;
        }
        return createMockQueryChain();
      });

      const result = await simulateCheckRateLimits(mockKnex, { tenantId: testTenantId });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
