import logger from '@alga-psa/core/logger';

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;      // Tokens remaining after this request
  retryAfterMs?: number;  // Milliseconds until a token is available (if not allowed)
  reason?: string;
}

/**
 * Configuration for a rate limit bucket
 */
export interface BucketConfig {
  maxTokens: number;      // Maximum tokens in the bucket (burst capacity)
  refillRate: number;     // Tokens added per second
}

/**
 * Bucket state stored in Redis
 */
interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Minimal Redis client interface needed for token bucket
 */
export interface TokenBucketRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

/**
 * Function type for getting the Redis client
 */
export type TokenBucketRedisGetter = () => Promise<TokenBucketRedisClient>;

/**
 * Function type for getting bucket configuration for a tenant
 */
export type BucketConfigGetter = (tenantId: string) => Promise<BucketConfig>;

/**
 * Default bucket configuration
 * 60 tokens max, refills at 1 token/second = 60 emails/minute sustained
 */
const DEFAULT_BUCKET_CONFIG: BucketConfig = {
  maxTokens: 60,
  refillRate: 1,  // 1 token per second
};

/**
 * TokenBucketRateLimiter - Redis-based token bucket rate limiter
 *
 * Implements the token bucket algorithm for rate limiting:
 * - Each bucket starts with maxTokens tokens
 * - Tokens refill at refillRate tokens per second
 * - Each request consumes 1 token
 * - Requests are rejected if no tokens are available
 *
 * Benefits over sliding window:
 * - Allows controlled bursts up to maxTokens
 * - Smoother rate limiting over time
 * - No database queries needed (Redis only)
 * - Handles concurrent requests gracefully
 *
 * Redis key pattern:
 * - Tenant-level: `alga-psa:ratelimit:bucket:{tenantId}`
 * - User-level: `alga-psa:ratelimit:bucket:{tenantId}:{userId}`
 */
export class TokenBucketRateLimiter {
  private static instance: TokenBucketRateLimiter | null = null;
  private redis: TokenBucketRedisClient | null = null;
  private configGetter: BucketConfigGetter | null = null;
  private isInitialized = false;

  /** Key prefix for rate limit buckets */
  private readonly prefix = 'alga-psa:ratelimit:bucket:';

  /** TTL for bucket keys (1 hour) - buckets expire if not used */
  private readonly bucketTtlSeconds = 3600;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): TokenBucketRateLimiter {
    if (!TokenBucketRateLimiter.instance) {
      TokenBucketRateLimiter.instance = new TokenBucketRateLimiter();
    }
    return TokenBucketRateLimiter.instance;
  }

  /**
   * Initialize the rate limiter with Redis client and config getter
   *
   * @param redisGetter - Function that returns a Redis client
   * @param configGetter - Optional function to get bucket config per tenant (uses defaults if not provided)
   */
  async initialize(
    redisGetter: TokenBucketRedisGetter,
    configGetter?: BucketConfigGetter
  ): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[TokenBucketRateLimiter] Already initialized');
      return;
    }

    try {
      this.redis = await redisGetter();
      this.configGetter = configGetter ?? null;
      this.isInitialized = true;

      logger.info('[TokenBucketRateLimiter] Initialized successfully', {
        defaultMaxTokens: DEFAULT_BUCKET_CONFIG.maxTokens,
        defaultRefillRate: DEFAULT_BUCKET_CONFIG.refillRate
      });
    } catch (error) {
      logger.error('[TokenBucketRateLimiter] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Check if the rate limiter is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.redis !== null;
  }

  /**
   * Get the Redis key for a bucket
   */
  private getBucketKey(tenantId: string, userId?: string): string {
    if (userId) {
      return `${this.prefix}${tenantId}:${userId}`;
    }
    return `${this.prefix}${tenantId}`;
  }

  /**
   * Get bucket configuration for a tenant
   */
  private async getBucketConfig(tenantId: string): Promise<BucketConfig> {
    if (this.configGetter) {
      try {
        return await this.configGetter(tenantId);
      } catch (error) {
        logger.warn('[TokenBucketRateLimiter] Failed to get bucket config, using defaults', {
          tenantId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    return DEFAULT_BUCKET_CONFIG;
  }

  /**
   * Try to consume a token from the bucket
   *
   * @param tenantId - The tenant ID
   * @param userId - Optional user ID for per-user rate limiting
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns RateLimitResult indicating if the request is allowed
   */
  async tryConsume(
    tenantId: string,
    userId?: string,
    tokens: number = 1
  ): Promise<RateLimitResult> {
    if (!this.redis) {
      // If Redis is not available, fail open (allow the request)
      logger.warn('[TokenBucketRateLimiter] Redis not available, allowing request');
      return { allowed: true, remaining: -1 };
    }

    const bucketKey = this.getBucketKey(tenantId, userId);
    const config = await this.getBucketConfig(tenantId);
    const now = Date.now();

    try {
      // Get current bucket state
      const stateJson = await this.redis.get(bucketKey);
      let state: BucketState;

      if (stateJson) {
        state = JSON.parse(stateJson);
      } else {
        // New bucket starts full
        state = {
          tokens: config.maxTokens,
          lastRefillMs: now
        };
      }

      // Calculate tokens to add based on time elapsed
      const elapsedMs = now - state.lastRefillMs;
      const elapsedSeconds = elapsedMs / 1000;
      const tokensToAdd = elapsedSeconds * config.refillRate;

      // Refill tokens (capped at max)
      state.tokens = Math.min(config.maxTokens, state.tokens + tokensToAdd);
      state.lastRefillMs = now;

      // Try to consume tokens
      if (state.tokens >= tokens) {
        // Consume tokens
        state.tokens -= tokens;

        // Save updated state
        await this.redis.set(bucketKey, JSON.stringify(state), { EX: this.bucketTtlSeconds });

        logger.debug('[TokenBucketRateLimiter] Token consumed', {
          tenantId,
          userId,
          remaining: Math.floor(state.tokens),
          consumed: tokens
        });

        return {
          allowed: true,
          remaining: Math.floor(state.tokens)
        };
      } else {
        // Not enough tokens - calculate when one will be available
        const tokensNeeded = tokens - state.tokens;
        const secondsUntilToken = tokensNeeded / config.refillRate;
        const retryAfterMs = Math.ceil(secondsUntilToken * 1000);

        // Save state (we still updated the refill)
        await this.redis.set(bucketKey, JSON.stringify(state), { EX: this.bucketTtlSeconds });

        logger.debug('[TokenBucketRateLimiter] Rate limit exceeded', {
          tenantId,
          userId,
          remaining: Math.floor(state.tokens),
          needed: tokens,
          retryAfterMs
        });

        return {
          allowed: false,
          remaining: Math.floor(state.tokens),
          retryAfterMs,
          reason: `Rate limit exceeded. ${Math.floor(state.tokens)} tokens remaining, need ${tokens}. Retry in ${Math.ceil(secondsUntilToken)}s`
        };
      }
    } catch (error) {
      // On error, fail open (allow the request)
      logger.error('[TokenBucketRateLimiter] Error checking rate limit:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        userId
      });
      return { allowed: true, remaining: -1 };
    }
  }

  /**
   * Get current bucket state without consuming tokens
   */
  async getState(tenantId: string, userId?: string): Promise<{ tokens: number; maxTokens: number } | null> {
    if (!this.redis) {
      return null;
    }

    const bucketKey = this.getBucketKey(tenantId, userId);
    const config = await this.getBucketConfig(tenantId);

    try {
      const stateJson = await this.redis.get(bucketKey);
      if (!stateJson) {
        return { tokens: config.maxTokens, maxTokens: config.maxTokens };
      }

      const state: BucketState = JSON.parse(stateJson);
      const now = Date.now();

      // Calculate current tokens with refill
      const elapsedMs = now - state.lastRefillMs;
      const elapsedSeconds = elapsedMs / 1000;
      const tokensToAdd = elapsedSeconds * config.refillRate;
      const currentTokens = Math.min(config.maxTokens, state.tokens + tokensToAdd);

      return {
        tokens: Math.floor(currentTokens),
        maxTokens: config.maxTokens
      };
    } catch (error) {
      logger.error('[TokenBucketRateLimiter] Error getting bucket state:', error);
      return null;
    }
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    TokenBucketRateLimiter.instance = null;
  }

  /**
   * Shutdown the rate limiter
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
    this.redis = null;
    TokenBucketRateLimiter.instance = null;
    logger.info('[TokenBucketRateLimiter] Shutdown complete');
  }
}
