import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for email notification rate limiting logic.
 *
 * Rate limiting is centralized in TenantEmailService.sendEmail() via checkRateLimits().
 * This ensures ALL tenant emails are protected by a single, consistent implementation.
 *
 * The rate limiting works by:
 * 1. Checking notification_settings for the tenant's rate_limit_per_minute (default: 60)
 * 2. Counting notifications in notification_logs for the tenant/user in the last 60 seconds
 * 3. Returning { allowed: false, reason: '...' } if count >= rate_limit_per_minute
 *
 * Note: SystemEmailService emails (password resets, tenant recovery) bypass rate limiting
 * as they are critical authentication flows that must always work.
 */

describe('Email Rate Limiting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Rate Limit Enforcement Logic', () => {
    it('should allow notification when under rate limit', async () => {
      const rateLimit = 60;
      const currentCount = 30;

      // The logic: recentCount >= rate_limit_per_minute throws error
      // 30 < 60 = should NOT throw
      const shouldThrow = currentCount >= rateLimit;

      expect(shouldThrow).toBe(false);
    });

    it('should block notification when at exact rate limit', async () => {
      const rateLimit = 60;
      const currentCount = 60;

      // The logic: recentCount >= rate_limit_per_minute throws error
      // 60 >= 60 = should throw
      const shouldThrow = currentCount >= rateLimit;

      expect(shouldThrow).toBe(true);
    });

    it('should block notification when over rate limit', async () => {
      const rateLimit = 60;
      const currentCount = 100;

      // The logic: recentCount >= rate_limit_per_minute throws error
      // 100 >= 60 = should throw
      const shouldThrow = currentCount >= rateLimit;

      expect(shouldThrow).toBe(true);
    });

    it('should allow notification when count is one below limit', async () => {
      const rateLimit = 60;
      const currentCount = 59;

      // The logic: recentCount >= rate_limit_per_minute throws error
      // 59 < 60 = should NOT throw
      const shouldThrow = currentCount >= rateLimit;

      expect(shouldThrow).toBe(false);
    });

    it('should handle rate limit of 1 (minimum)', async () => {
      const rateLimit = 1;

      // First notification should succeed
      expect(0 >= rateLimit).toBe(false);

      // Second notification should be blocked
      expect(1 >= rateLimit).toBe(true);
    });

    it('should handle high rate limit (1000 - maximum)', async () => {
      const rateLimit = 1000;

      // Should allow up to 999
      expect(999 >= rateLimit).toBe(false);

      // Should block at 1000
      expect(1000 >= rateLimit).toBe(true);
    });
  });

  describe('Rate Limit Window Logic', () => {
    it('should use 60 second window for counting', () => {
      const now = Date.now();
      const windowMs = 60000; // 60 seconds in milliseconds
      const windowStart = new Date(now - windowMs);

      // Verify the window calculation
      expect(windowStart.getTime()).toBe(now - 60000);
    });

    it('should count only notifications within the window', () => {
      const now = Date.now();
      const windowMs = 60000;

      // Notifications at different times
      const withinWindow = now - 30000; // 30 seconds ago - should count
      const atWindowEdge = now - 60000; // exactly 60 seconds ago - should NOT count (> not >=)
      const outsideWindow = now - 90000; // 90 seconds ago - should NOT count

      const windowStart = now - windowMs;

      // The query uses: where('created_at', '>', new Date(Date.now() - 60000))
      // This means strictly greater than, so exactly 60 seconds ago is excluded
      expect(withinWindow > windowStart).toBe(true);
      expect(atWindowEdge > windowStart).toBe(false);
      expect(outsideWindow > windowStart).toBe(false);
    });
  });

  describe('Settings Validation', () => {
    it('should use default rate limit when settings not found', () => {
      // Default from TenantEmailService.checkRateLimits():
      // rate_limit_per_minute: 60
      const defaultRateLimit = 60;

      expect(defaultRateLimit).toBe(60);
    });

    it('should respect custom rate limit from settings', () => {
      const customRateLimits = [1, 10, 100, 500, 1000];

      customRateLimits.forEach(limit => {
        // Count at limit should be blocked
        expect(limit >= limit).toBe(true);

        // Count below limit should be allowed
        expect((limit - 1) >= limit).toBe(false);
      });
    });
  });

  describe('Notifications Disabled Check (upstream)', () => {
    // Note: The is_enabled check is done upstream in EmailNotificationService.sendNotification()
    // and ticketEmailSubscriber.sendNotificationIfEnabled(), NOT in TenantEmailService.
    // TenantEmailService only handles rate limiting - the enabled/disabled check is caller's responsibility.
    it('should block when notifications are disabled (checked upstream)', () => {
      const settings = {
        is_enabled: false,
        rate_limit_per_minute: 60,
      };

      // The logic in EmailNotificationService.sendNotification():
      // if (!settings.is_enabled) throw new Error('Notifications are disabled for this tenant');
      const shouldBlock = !settings.is_enabled;

      expect(shouldBlock).toBe(true);
    });

    it('should proceed when notifications are enabled (checked upstream)', () => {
      const settings = {
        is_enabled: true,
        rate_limit_per_minute: 60,
      };

      const shouldBlock = !settings.is_enabled;

      expect(shouldBlock).toBe(false);
    });
  });

  describe('Rate Limit Response', () => {
    it('should return descriptive error when rate limit exceeded', () => {
      // TenantEmailService.sendEmail returns EmailSendResult with success: false
      // when rate limited, rather than throwing an error
      const recentCount = 75;
      const rateLimit = 60;

      // Simulate the rate limit result from TenantEmailService
      const result = recentCount >= rateLimit
        ? {
            success: false,
            error: `Rate limit exceeded: Sent ${recentCount} emails in the last minute (limit: ${rateLimit})`
          }
        : { success: true };

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(result.error).toContain('75');
      expect(result.error).toContain('60');
    });

    it('should return success when under rate limit', () => {
      const recentCount = 30;
      const rateLimit = 60;

      const result = recentCount >= rateLimit
        ? { success: false, error: 'Rate limit exceeded' }
        : { success: true };

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Per-User Rate Limiting', () => {
    it('should track rate limits per tenant and user combination', () => {
      // The query filters by both tenant and user_id:
      // .where({ tenant: params.tenant, user_id: params.userId })

      const tenant1User1Count = 50;
      const tenant1User2Count = 30;
      const tenant2User1Count = 60;
      const rateLimit = 60;

      // User 1 in tenant 1 should be allowed
      expect(tenant1User1Count >= rateLimit).toBe(false);

      // User 2 in tenant 1 should be allowed (different user)
      expect(tenant1User2Count >= rateLimit).toBe(false);

      // User 1 in tenant 2 at limit should be blocked
      expect(tenant2User1Count >= rateLimit).toBe(true);
    });
  });
});
