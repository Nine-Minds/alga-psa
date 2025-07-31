import type { RateLimitInfo, RateLimitRule } from '../types/mcp.js';

export interface RateLimiterConfig {
  defaultRule: RateLimitRule;
  rules: Map<string, RateLimitRule>;
  cleanupIntervalMs: number;
}

interface RequestRecord {
  timestamps: number[];
  lastCleanup: number;
}

export class RateLimiter {
  private readonly requestHistory = new Map<string, RequestRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(private readonly config: RateLimiterConfig) {
    // Start cleanup timer to prevent memory leaks
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, config.cleanupIntervalMs);
  }

  /**
   * Check if a request should be allowed and update counters
   * @param key - The key to rate limit by (e.g., API key, session ID, IP)
   * @param ruleType - Optional rule type to use instead of default
   * @returns RateLimitInfo with current status
   */
  checkLimit(key: string, ruleType?: string): RateLimitInfo {
    const rule = ruleType ? 
      this.config.rules.get(ruleType) || this.config.defaultRule : 
      this.config.defaultRule;

    const now = Date.now();
    const windowStart = now - rule.windowMs;
    
    // Get or create request record
    let record = this.requestHistory.get(key);
    if (!record) {
      record = { timestamps: [], lastCleanup: now };
      this.requestHistory.set(key, record);
    }

    // Clean old timestamps if needed
    if (now - record.lastCleanup > rule.windowMs / 2) {
      record.timestamps = record.timestamps.filter(ts => ts > windowStart);
      record.lastCleanup = now;
    }

    // Count requests in current window
    const requestsInWindow = record.timestamps.filter(ts => ts > windowStart).length;
    const remaining = Math.max(0, rule.maxRequests - requestsInWindow);
    
    // Calculate reset time (start of next window)
    const oldestRequest = record.timestamps.find(ts => ts > windowStart);
    const resetTime = oldestRequest ? 
      new Date(oldestRequest + rule.windowMs) : 
      new Date(now + rule.windowMs);

    const limitInfo: RateLimitInfo = {
      limit: rule.maxRequests,
      remaining,
      resetTime,
      windowStart: new Date(windowStart),
    };

    return limitInfo;
  }

  /**
   * Record a request (call this after checkLimit returns true)
   * @param key - The key being rate limited
   * @param ruleType - Optional rule type
   */
  recordRequest(key: string, ruleType?: string): void {
    const now = Date.now();
    let record = this.requestHistory.get(key);
    
    if (!record) {
      record = { timestamps: [], lastCleanup: now };
      this.requestHistory.set(key, record);
    }

    record.timestamps.push(now);
  }

  /**
   * Check if request is allowed (combines checkLimit and recordRequest)
   * @param key - The key to rate limit by
   * @param ruleType - Optional rule type
   * @returns RateLimitInfo and whether request is allowed
   */
  isAllowed(key: string, ruleType?: string): { allowed: boolean; info: RateLimitInfo } {
    const info = this.checkLimit(key, ruleType);
    const allowed = info.remaining > 0;

    if (allowed) {
      this.recordRequest(key, ruleType);
      // Update remaining count after recording
      info.remaining = Math.max(0, info.remaining - 1);
    }

    return { allowed, info };
  }

  /**
   * Reset rate limit for a specific key
   * @param key - The key to reset
   */
  reset(key: string): void {
    this.requestHistory.delete(key);
  }

  /**
   * Get current rate limit status without updating counters
   * @param key - The key to check
   * @param ruleType - Optional rule type
   * @returns Current rate limit info
   */
  getStatus(key: string, ruleType?: string): RateLimitInfo {
    return this.checkLimit(key, ruleType);
  }

  /**
   * Add or update a rate limit rule
   * @param ruleType - The rule type identifier
   * @param rule - The rate limit rule
   */
  addRule(ruleType: string, rule: RateLimitRule): void {
    this.config.rules.set(ruleType, rule);
  }

  /**
   * Remove a rate limit rule
   * @param ruleType - The rule type to remove
   */
  removeRule(ruleType: string): void {
    this.config.rules.delete(ruleType);
  }

  /**
   * Get statistics about current rate limiting
   */
  getStats(): {
    totalKeys: number;
    activeKeys: number;
    memoryUsage: number;
  } {
    const now = Date.now();
    let activeKeys = 0;
    let totalRequests = 0;

    for (const [, record] of this.requestHistory) {
      const recentRequests = record.timestamps.filter(
        ts => now - ts < this.config.defaultRule.windowMs
      );
      
      if (recentRequests.length > 0) {
        activeKeys++;
      }
      
      totalRequests += record.timestamps.length;
    }

    return {
      totalKeys: this.requestHistory.size,
      activeKeys,
      memoryUsage: totalRequests * 8, // Rough estimate: 8 bytes per timestamp
    };
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, record] of this.requestHistory) {
      // Remove timestamps older than the longest window
      const maxWindowMs = Math.max(
        this.config.defaultRule.windowMs,
        ...Array.from(this.config.rules.values()).map(r => r.windowMs)
      );

      record.timestamps = record.timestamps.filter(
        ts => now - ts < maxWindowMs
      );

      // If no recent activity, remove the key entirely
      if (record.timestamps.length === 0 && now - record.lastCleanup > maxWindowMs) {
        keysToDelete.push(key);
      }
    }

    // Remove inactive keys
    for (const key of keysToDelete) {
      this.requestHistory.delete(key);
    }
  }

  /**
   * Shutdown the rate limiter and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.requestHistory.clear();
  }
}

// Common rate limit rule presets
export const RateLimitPresets = {
  // Conservative defaults for debugging operations
  DEBUG_OPERATIONS: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  } as RateLimitRule,

  // More restrictive for sensitive operations
  HOT_PATCH: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
  } as RateLimitRule,

  // Burst allowance for evaluation operations
  EVALUATION: {
    windowMs: 10 * 1000, // 10 seconds
    maxRequests: 50,
  } as RateLimitRule,

  // Very restrictive for session creation
  SESSION_CREATION: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 5,
  } as RateLimitRule,
} as const;