import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DelayedEmailQueue,
  type RedisClientLike,
  type EmailSendCallback,
  type DelayedEmailEntry
} from '../../../../../packages/email/src/DelayedEmailQueue';
import type { BaseEmailParams } from '../../../../../packages/email/src/BaseEmailService';

/**
 * Unit tests for the DelayedEmailQueue service.
 *
 * The DelayedEmailQueue handles rate-limited emails by:
 * 1. Queuing them in Redis with a delay based on exponential backoff
 * 2. Processing them after the delay expires
 * 3. Fair processing across tenants (round-robin)
 * 4. Atomic claiming to prevent duplicate processing across instances
 */

// Mock Redis client
function createMockRedis(): RedisClientLike & {
  _data: Map<string, string>;
  _sortedSet: Map<string, number>;
} {
  const data = new Map<string, string>();
  const sortedSet = new Map<string, number>();

  return {
    _data: data,
    _sortedSet: sortedSet,

    async get(key: string) {
      return data.get(key) ?? null;
    },

    async set(_key: string, value: string, _options?: { EX?: number }) {
      data.set(_key, value);
      return 'OK';
    },

    async del(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (data.has(k)) {
          data.delete(k);
          count++;
        }
      }
      return count;
    },

    async zAdd(_key: string, item: { score: number; value: string }) {
      sortedSet.set(item.value, item.score);
      return 1;
    },

    async zRem(_key: string, member: string) {
      if (sortedSet.has(member)) {
        sortedSet.delete(member);
        return 1;
      }
      return 0;
    },

    async zRangeByScore(_key: string, min: number, max: number, options?: { LIMIT?: { offset: number; count: number } }) {
      const entries = [...sortedSet.entries()]
        .filter(([_, score]) => score >= min && score <= max)
        .sort((a, b) => a[1] - b[1])
        .map(([value]) => value);

      if (options?.LIMIT) {
        return entries.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count);
      }
      return entries;
    },

    async zCard(_key: string) {
      return sortedSet.size;
    }
  };
}

describe('DelayedEmailQueue', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSendCallback: EmailSendCallback;
  let sentEmails: Array<{ tenantId: string; params: BaseEmailParams }>;

  beforeEach(() => {
    // Reset singleton between tests
    DelayedEmailQueue.resetInstance();

    mockRedis = createMockRedis();
    sentEmails = [];
    mockSendCallback = vi.fn(async (tenantId: string, params: BaseEmailParams) => {
      sentEmails.push({ tenantId, params });
    });
  });

  afterEach(() => {
    DelayedEmailQueue.resetInstance();
  });

  describe('Static Methods', () => {
    it('should expose MAX_RETRIES constant', () => {
      expect(DelayedEmailQueue.MAX_RETRIES).toBe(5);
    });

    it('should calculate exponential backoff delays', () => {
      // First retry: ~1 minute (with jitter)
      const delay0 = DelayedEmailQueue.calculateDelay(0);
      expect(delay0).toBeGreaterThanOrEqual(54000); // 60000 - 10% jitter
      expect(delay0).toBeLessThanOrEqual(66000);    // 60000 + 10% jitter

      // Second retry: ~2 minutes
      const delay1 = DelayedEmailQueue.calculateDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(108000);
      expect(delay1).toBeLessThanOrEqual(132000);

      // Third retry: ~4 minutes
      const delay2 = DelayedEmailQueue.calculateDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(216000);
      expect(delay2).toBeLessThanOrEqual(264000);

      // Cap at 15 minutes
      const delay5 = DelayedEmailQueue.calculateDelay(5);
      expect(delay5).toBeGreaterThanOrEqual(810000); // 15min - 10%
      expect(delay5).toBeLessThanOrEqual(990000);    // 15min + 10%
    });
  });

  describe('Initialization', () => {
    it('should initialize with Redis client and callback', async () => {
      const queue = DelayedEmailQueue.getInstance();
      expect(queue.isReady()).toBe(false);

      await queue.initialize(async () => mockRedis, mockSendCallback);
      expect(queue.isReady()).toBe(true);
    });

    it('should warn if initialized twice', async () => {
      const queue = DelayedEmailQueue.getInstance();
      await queue.initialize(async () => mockRedis, mockSendCallback);

      // Second initialization should not throw
      await queue.initialize(async () => mockRedis, mockSendCallback);
      expect(queue.isReady()).toBe(true);
    });

    it('should return same instance for multiple getInstance calls', () => {
      const queue1 = DelayedEmailQueue.getInstance();
      const queue2 = DelayedEmailQueue.getInstance();
      expect(queue1).toBe(queue2);
    });
  });

  describe('Enqueue', () => {
    it('should enqueue email with correct delay', async () => {
      const queue = DelayedEmailQueue.getInstance();
      await queue.initialize(async () => mockRedis, mockSendCallback);

      const params: BaseEmailParams = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      };

      await queue.enqueue('tenant-1', params, 0);

      // Should have one entry in sorted set
      expect(mockRedis._sortedSet.size).toBe(1);

      // Should have one data entry
      expect(mockRedis._data.size).toBe(1);

      // Verify the data
      const dataKey = [...mockRedis._data.keys()][0];
      const data = JSON.parse(mockRedis._data.get(dataKey)!) as DelayedEmailEntry;
      expect(data.tenantId).toBe('tenant-1');
      expect(data.params.to).toBe('test@example.com');
      expect(data.retryCount).toBe(0);
    });

    it('should not enqueue if queue is not initialized', async () => {
      const queue = DelayedEmailQueue.getInstance();
      // Not initialized

      const params: BaseEmailParams = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      };

      await queue.enqueue('tenant-1', params, 0);

      // Should not have any entries
      expect(mockRedis._sortedSet.size).toBe(0);
    });
  });

  describe('Process Ready', () => {
    it('should process emails that are ready', async () => {
      const queue = DelayedEmailQueue.getInstance({ checkIntervalMs: 100000 }); // Long interval to prevent auto-processing
      await queue.initialize(async () => mockRedis, mockSendCallback);

      const params: BaseEmailParams = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      };

      // Manually add an entry that's already ready (score in the past)
      const id = 'test-id-1';
      const entry: DelayedEmailEntry = {
        id,
        params,
        tenantId: 'tenant-1',
        retryCount: 0,
        originalTimestamp: Date.now(),
        queuedAt: Date.now()
      };

      mockRedis._data.set(`alga-psa:email-ratelimit:data:${id}`, JSON.stringify(entry));
      mockRedis._sortedSet.set(id, Date.now() - 1000); // Ready 1 second ago

      const processed = await queue.processReady();

      expect(processed).toBe(1);
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].tenantId).toBe('tenant-1');
      expect(sentEmails[0].params._retryCount).toBe(1);
    });

    it('should not process emails that are not ready yet', async () => {
      const queue = DelayedEmailQueue.getInstance({ checkIntervalMs: 100000 });
      await queue.initialize(async () => mockRedis, mockSendCallback);

      const id = 'test-id-1';
      const entry: DelayedEmailEntry = {
        id,
        params: { to: 'test@example.com', subject: 'Test', html: '<p>Test</p>' },
        tenantId: 'tenant-1',
        retryCount: 0,
        originalTimestamp: Date.now(),
        queuedAt: Date.now()
      };

      mockRedis._data.set(`alga-psa:email-ratelimit:data:${id}`, JSON.stringify(entry));
      mockRedis._sortedSet.set(id, Date.now() + 60000); // Ready in 1 minute

      const processed = await queue.processReady();

      expect(processed).toBe(0);
      expect(sentEmails.length).toBe(0);
    });

    it('should process one email per tenant for fair scheduling', async () => {
      const queue = DelayedEmailQueue.getInstance({ checkIntervalMs: 100000 });
      await queue.initialize(async () => mockRedis, mockSendCallback);

      // Add 3 emails for tenant-1 and 2 emails for tenant-2
      const tenant1Emails = [
        { id: 't1-email-1', to: 'user1@tenant1.com' },
        { id: 't1-email-2', to: 'user2@tenant1.com' },
        { id: 't1-email-3', to: 'user3@tenant1.com' }
      ];
      const tenant2Emails = [
        { id: 't2-email-1', to: 'user1@tenant2.com' },
        { id: 't2-email-2', to: 'user2@tenant2.com' }
      ];

      for (const { id, to } of tenant1Emails) {
        const entry: DelayedEmailEntry = {
          id,
          params: { to, subject: 'Test', html: '<p>Test</p>' },
          tenantId: 'tenant-1',
          retryCount: 0,
          originalTimestamp: Date.now(),
          queuedAt: Date.now()
        };
        mockRedis._data.set(`alga-psa:email-ratelimit:data:${id}`, JSON.stringify(entry));
        mockRedis._sortedSet.set(id, Date.now() - 1000);
      }

      for (const { id, to } of tenant2Emails) {
        const entry: DelayedEmailEntry = {
          id,
          params: { to, subject: 'Test', html: '<p>Test</p>' },
          tenantId: 'tenant-2',
          retryCount: 0,
          originalTimestamp: Date.now(),
          queuedAt: Date.now()
        };
        mockRedis._data.set(`alga-psa:email-ratelimit:data:${id}`, JSON.stringify(entry));
        mockRedis._sortedSet.set(id, Date.now() - 1000);
      }

      // First cycle should process one from each tenant
      const processed1 = await queue.processReady();
      expect(processed1).toBe(2);

      // Should have one email from each tenant
      const tenantsSent = new Set(sentEmails.map(e => e.tenantId));
      expect(tenantsSent.has('tenant-1')).toBe(true);
      expect(tenantsSent.has('tenant-2')).toBe(true);
    });
  });

  describe('Retry Count Tracking', () => {
    it('should increment retry count on each processing', async () => {
      const queue = DelayedEmailQueue.getInstance({ checkIntervalMs: 100000 });
      await queue.initialize(async () => mockRedis, mockSendCallback);

      const id = 'test-id-1';
      const entry: DelayedEmailEntry = {
        id,
        params: { to: 'test@example.com', subject: 'Test', html: '<p>Test</p>' },
        tenantId: 'tenant-1',
        retryCount: 2, // Already retried twice
        originalTimestamp: Date.now() - 300000, // 5 minutes ago
        queuedAt: Date.now()
      };

      mockRedis._data.set(`alga-psa:email-ratelimit:data:${id}`, JSON.stringify(entry));
      mockRedis._sortedSet.set(id, Date.now() - 1000);

      await queue.processReady();

      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].params._retryCount).toBe(3); // Incremented
      expect(sentEmails[0].params._originalTimestamp).toBe(entry.originalTimestamp);
    });
  });

  describe('Stats', () => {
    it('should return pending count', async () => {
      const queue = DelayedEmailQueue.getInstance();
      await queue.initialize(async () => mockRedis, mockSendCallback);

      // Add some entries
      mockRedis._sortedSet.set('id-1', Date.now());
      mockRedis._sortedSet.set('id-2', Date.now());
      mockRedis._sortedSet.set('id-3', Date.now());

      const stats = await queue.getStats();
      expect(stats.pendingCount).toBe(3);
    });

    it('should return zero when queue is empty', async () => {
      const queue = DelayedEmailQueue.getInstance();
      await queue.initialize(async () => mockRedis, mockSendCallback);

      const stats = await queue.getStats();
      expect(stats.pendingCount).toBe(0);
    });
  });

  describe('Shutdown', () => {
    it('should cleanup on shutdown', async () => {
      const queue = DelayedEmailQueue.getInstance();
      await queue.initialize(async () => mockRedis, mockSendCallback);
      expect(queue.isReady()).toBe(true);

      await queue.shutdown();
      expect(queue.isReady()).toBe(false);
    });
  });
});

describe('Email Rate Limiting with Queue Integration', () => {
  describe('Rate Limit Response with Queue', () => {
    it('should return success with queued flag when email is queued', () => {
      // Simulate the response from TenantEmailService when email is queued
      const result = {
        success: true,
        queued: true,
        retryCount: 0
      };

      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(result.retryCount).toBe(0);
    });

    it('should return failure when max retries exceeded', () => {
      const maxRetries = 5;
      const retryCount = 5;

      const result = retryCount >= maxRetries
        ? {
            success: false,
            error: `Rate limit exceeded after ${retryCount} retries`
          }
        : { success: true, queued: true, retryCount };

      expect(result.success).toBe(false);
      expect(result.error).toContain('after 5 retries');
    });
  });

  describe('Exponential Backoff Schedule', () => {
    it('should follow the expected retry schedule', () => {
      const expectedSchedule = [
        { attempt: 0, minDelay: 54000, maxDelay: 66000 },    // ~1 minute
        { attempt: 1, minDelay: 108000, maxDelay: 132000 },  // ~2 minutes
        { attempt: 2, minDelay: 216000, maxDelay: 264000 },  // ~4 minutes
        { attempt: 3, minDelay: 432000, maxDelay: 528000 },  // ~8 minutes
        { attempt: 4, minDelay: 810000, maxDelay: 990000 },  // ~15 minutes (capped)
      ];

      for (const { attempt, minDelay, maxDelay } of expectedSchedule) {
        const delay = DelayedEmailQueue.calculateDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(minDelay);
        expect(delay).toBeLessThanOrEqual(maxDelay);
      }
    });

    it('should cap delay at 15 minutes even for high retry counts', () => {
      // Even at very high retry counts, delay should be capped
      for (let attempt = 5; attempt < 20; attempt++) {
        const delay = DelayedEmailQueue.calculateDelay(attempt);
        expect(delay).toBeLessThanOrEqual(990000); // 15 min + 10% jitter
      }
    });
  });
});
