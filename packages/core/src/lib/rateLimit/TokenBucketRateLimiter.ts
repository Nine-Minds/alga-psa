import logger from '../logger';

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
  /**
   * Optional atomic script execution. `tryConsumeAtomic` requires it; clients
   * that omit `eval` report the fail-open sentinel instead of racing.
   */
  eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * Function type for getting the Redis client
 */
export type TokenBucketRedisGetter = () => Promise<TokenBucketRedisClient>;

/**
 * Function type for getting bucket configuration for a tenant
 */
export type BucketConfigGetter = (tenantId: string, subjectId?: string) => Promise<BucketConfig>;

/**
 * Default bucket configuration
 * 60 tokens max, refills at 1 token/second = 60 emails/minute sustained
 */
const DEFAULT_BUCKET_CONFIG: BucketConfig = {
  maxTokens: 60,
  refillRate: 1,  // 1 token per second
};

/**
 * Atomic token-bucket consume executed server-side in a single EVAL.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = maxTokens
 * ARGV[2] = refillRate (tokens/second)
 * ARGV[3] = tokens requested
 * ARGV[4] = now (epoch ms)
 * ARGV[5] = TTL seconds for the bucket key
 *
 * Returns `{1, remaining, 0}` when allowed and `{0, remaining, retryAfterMs}`
 * when denied, so check + consume + refill + TTL management happen in one
 * atomic round trip with no read-modify-write race.
 *
 * Fail-closed guarantees (the caller must treat a `{0, -1, 0}` reply as an
 * abnormal denial, distinguishable from genuine exhaustion via `remaining`):
 * - Invalid call parameters (non-finite or non-positive ARGV) deny without
 *   touching the stored bucket.
 * - Corrupt stored state (unparseable JSON, missing/wrong-shape fields,
 *   non-finite or negative tokens, tokens above capacity, absent/future refill
 *   timestamps) denies and discards the bucket (`DEL`) so the next request
 *   re-establishes a valid one. The in-flight request is never credited.
 * - A computed refill that leaves tokens non-finite or above capacity denies
 *   and discards the bucket.
 */
const ATOMIC_TRY_CONSUME_SCRIPT = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local tokensNeeded = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local ttlSeconds = tonumber(ARGV[5])

if not maxTokens or not refillRate or not tokensNeeded or not nowMs or not ttlSeconds
   or maxTokens <= 0 or refillRate <= 0 or tokensNeeded <= 0 or nowMs <= 0 or ttlSeconds <= 0
   or maxTokens ~= maxTokens or refillRate ~= refillRate or tokensNeeded ~= tokensNeeded
   or nowMs ~= nowMs or ttlSeconds ~= ttlSeconds then
  return { 0, -1, 0 }
end

local tokens = maxTokens
local lastRefillMs = nowMs

local state = redis.call('GET', key)
if state then
  local corrupt = false
  local ok, decoded = pcall(cjson.decode, state)
  if not (ok and type(decoded) == 'table') then
    corrupt = true
  else
    local storedTokens = tonumber(decoded.tokens)
    local storedLastRefill = tonumber(decoded.lastRefillMs)
    if not storedTokens or not storedLastRefill
       or storedTokens < 0 or storedTokens > maxTokens
       or storedTokens ~= storedTokens
       or storedLastRefill <= 0 or storedLastRefill > nowMs
       or storedLastRefill ~= storedLastRefill then
      corrupt = true
    else
      tokens = storedTokens
      lastRefillMs = storedLastRefill
    end
  end
  if corrupt then
    redis.call('DEL', key)
    return { 0, -1, 0 }
  end
end

local elapsedSec = (nowMs - lastRefillMs) / 1000
if elapsedSec > 0 then
  tokens = math.min(maxTokens, tokens + elapsedSec * refillRate)
end

if tokens ~= tokens or tokens > maxTokens then
  redis.call('DEL', key)
  return { 0, -1, 0 }
end

if tokens >= tokensNeeded then
  local remaining = tokens - tokensNeeded
  redis.call('SET', key, cjson.encode({ tokens = remaining, lastRefillMs = nowMs }), 'EX', ttlSeconds)
  return { 1, math.floor(remaining), 0 }
end

redis.call('SET', key, cjson.encode({ tokens = tokens, lastRefillMs = nowMs }), 'EX', ttlSeconds)
local missing = tokensNeeded - tokens
local retryAfterMs = 0
if refillRate > 0 then
  retryAfterMs = math.ceil((missing / refillRate) * 1000)
end
return { 0, math.floor(tokens), retryAfterMs }
`;

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
 * - Tenant-level: `alga-psa:ratelimit:bucket:{namespace}:{tenantId}`
 * - Subject-level: `alga-psa:ratelimit:bucket:{namespace}:{tenantId}:{subjectId}`
 */
// Pin the singleton on globalThis so Next.js dev (Turbopack) cannot end up
// with two parallel instances when the module is loaded through different
// runtime contexts (instrumentation hook vs. route handler).
const TOKEN_BUCKET_GLOBAL_KEY = '__alga_token_bucket_rate_limiter__';

type TokenBucketGlobal = typeof globalThis & {
  [TOKEN_BUCKET_GLOBAL_KEY]?: TokenBucketRateLimiter;
};

export class TokenBucketRateLimiter {
  private redis: TokenBucketRedisClient | null = null;
  private configGetters: Record<string, BucketConfigGetter> = {};
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
    const g = globalThis as TokenBucketGlobal;
    if (!g[TOKEN_BUCKET_GLOBAL_KEY]) {
      g[TOKEN_BUCKET_GLOBAL_KEY] = new TokenBucketRateLimiter();
    }
    return g[TOKEN_BUCKET_GLOBAL_KEY]!;
  }

  /**
   * Initialize the rate limiter with Redis client and config getter
   *
   * @param redisGetter - Function that returns a Redis client
   * @param configGetters - Optional functions to get bucket config per namespace (uses defaults if not provided)
   */
  async initialize(
    redisGetter: TokenBucketRedisGetter,
    configGetters: Record<string, BucketConfigGetter> = {}
  ): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[TokenBucketRateLimiter] Already initialized');
      return;
    }

    try {
      this.redis = await redisGetter();
      this.configGetters = configGetters;
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
  private getBucketKey(namespace: string, tenantId: string, subjectId?: string): string {
    if (subjectId) {
      return `${this.prefix}${namespace}:${tenantId}:${subjectId}`;
    }
    return `${this.prefix}${namespace}:${tenantId}`;
  }

  /**
   * Get bucket configuration for a tenant
   */
  private async getBucketConfig(namespace: string, tenantId: string, subjectId?: string): Promise<BucketConfig> {
    const configGetter = this.configGetters[namespace];

    if (configGetter) {
      try {
        return await configGetter(tenantId, subjectId);
      } catch (error) {
        logger.warn('[TokenBucketRateLimiter] Failed to get bucket config, using defaults', {
          namespace,
          tenantId,
          subjectId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    return DEFAULT_BUCKET_CONFIG;
  }

  /**
   * Try to consume a token from the bucket
   *
   * @param namespace - Bucket namespace
   * @param tenantId - The tenant ID
   * @param subjectId - Optional subject ID for per-subject rate limiting
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns RateLimitResult indicating if the request is allowed
   */
  async tryConsume(
    namespace: string,
    tenantId: string,
    subjectId?: string,
    tokens: number = 1
  ): Promise<RateLimitResult> {
    if (!this.redis) {
      // If Redis is not available, fail open (allow the request)
      logger.warn('[TokenBucketRateLimiter] Redis not available, allowing request');
      return { allowed: true, remaining: -1 };
    }

    const bucketKey = this.getBucketKey(namespace, tenantId, subjectId);
    const config = await this.getBucketConfig(namespace, tenantId, subjectId);
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
          namespace,
          tenantId,
          subjectId,
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
          namespace,
          tenantId,
          subjectId,
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
        namespace,
        tenantId,
        subjectId
      });
      return { allowed: true, remaining: -1 };
    }
  }

  /**
   * Atomically try to consume a token from the bucket.
   *
   * Same contract as `tryConsume`, but check + consume + refill + TTL are a
   * single Redis-side EVAL so concurrent requests cannot over-draw a bucket.
   * `tryConsume` remains for consumers that do not require atomicity.
   *
   * @param namespace - Bucket namespace
   * @param tenantId - The tenant ID
   * @param subjectId - Optional subject ID for per-subject rate limiting
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns RateLimitResult indicating if the request is allowed
   */
  async tryConsumeAtomic(
    namespace: string,
    tenantId: string,
    subjectId?: string,
    tokens: number = 1
  ): Promise<RateLimitResult> {
    if (!this.redis) {
      // If Redis is not available, fail open (allow the request); callers that
      // must fail closed treat the negative `remaining` sentinel as
      // unavailable.
      logger.warn('[TokenBucketRateLimiter] Redis not available, allowing request');
      return { allowed: true, remaining: -1 };
    }
    if (typeof this.redis.eval !== 'function') {
      logger.error('[TokenBucketRateLimiter] Redis client does not support EVAL; cannot enforce rate limit atomically');
      return { allowed: true, remaining: -1 };
    }

    const bucketKey = this.getBucketKey(namespace, tenantId, subjectId);
    const config = await this.getBucketConfig(namespace, tenantId, subjectId);

    if (
      !Number.isFinite(config.maxTokens) || config.maxTokens <= 0 ||
      !Number.isFinite(config.refillRate) || config.refillRate <= 0 ||
      !Number.isFinite(tokens) || tokens <= 0
    ) {
      // A broken bucket config or consume size is a policy dependency
      // failure: deny rather than grant tokens against a corrupt budget.
      logger.error('[TokenBucketRateLimiter] Invalid bucket config or consume size; denying (fail closed)', {
        namespace,
        tenantId,
        subjectId,
        maxTokens: config.maxTokens,
        refillRate: config.refillRate,
        tokens,
      });
      return { allowed: false, remaining: -1 };
    }

    const now = Date.now();

    let reply: unknown;
    try {
      reply = await this.redis.eval(ATOMIC_TRY_CONSUME_SCRIPT, {
        keys: [bucketKey],
        arguments: [
          String(config.maxTokens),
          String(config.refillRate),
          String(tokens),
          String(now),
          String(this.bucketTtlSeconds),
        ],
      });
    } catch (error) {
      // EVAL threw or Redis returned an error reply: fail closed. Deny the
      // request and never reset the bucket, which would credit the in-flight
      // request; the negative `remaining` marks this as an abnormal denial.
      logger.error('[TokenBucketRateLimiter] Atomic EVAL failed; denying (fail closed)', {
        error: error instanceof Error ? error.message : 'Unknown error',
        namespace,
        tenantId,
        subjectId,
      });
      return { allowed: false, remaining: -1 };
    }

    const parsed = this.parseAtomicReply(reply);
    if (!parsed) {
      logger.error('[TokenBucketRateLimiter] Malformed atomic consume reply; denying (fail closed)', {
        namespace,
        tenantId,
        subjectId,
        reply: reply == null ? String(reply) : JSON.stringify(reply),
      });
      return { allowed: false, remaining: -1 };
    }

    if (parsed.allowed) {
      logger.debug('[TokenBucketRateLimiter] Token consumed (atomic)', {
        namespace,
        tenantId,
        subjectId,
        remaining: parsed.remaining,
        consumed: tokens,
      });
      return parsed;
    }

    logger.debug('[TokenBucketRateLimiter] Rate limit exceeded (atomic)', {
      namespace,
      tenantId,
      subjectId,
      remaining: parsed.remaining,
      needed: tokens,
      retryAfterMs: parsed.retryAfterMs,
    });
    return parsed;
  }

  /**
   * Strictly validate the EVAL reply before accepting it. Any wrong arity,
   * non-numeric entry, nil where a number is expected, non-array reply, or
   * internally contradictory shape (e.g. allowed with a negative remaining) is
   * rejected so the caller denies rather than mis-granting. Numeric strings are
   * accepted because Redis clients may return Lua integers as bulk strings.
   */
  private parseAtomicReply(reply: unknown): RateLimitResult | null {
    if (!Array.isArray(reply) || reply.length < 3) {
      return null;
    }
    const allowedFlag = this.toFiniteNumber(reply[0]);
    const remaining = this.toFiniteNumber(reply[1]);
    const retryAfterMs = this.toFiniteNumber(reply[2]);
    if (allowedFlag === null || remaining === null || retryAfterMs === null) {
      return null;
    }
    if (allowedFlag !== 0 && allowedFlag !== 1) {
      return null;
    }
    if (retryAfterMs < 0) {
      return null;
    }
    if (allowedFlag === 1) {
      if (remaining < 0) {
        return null;
      }
      return { allowed: true, remaining: Math.floor(remaining) };
    }
    if (remaining < -1) {
      return null;
    }
    return {
      allowed: false,
      remaining: Math.floor(remaining),
      ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
    };
  }

  /**
   * Coerce an EVAL reply element to a finite number, rejecting null, booleans,
   * objects, arrays, and non-numeric strings (where the Lua script only ever
   * returns numbers). `Infinity`/`NaN` are rejected as non-finite.
   */
  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  /**
   * Get current bucket state without consuming tokens
   */
  async getState(
    namespace: string,
    tenantId: string,
    subjectId?: string
  ): Promise<{ tokens: number; maxTokens: number } | null> {
    if (!this.redis) {
      return null;
    }

    const bucketKey = this.getBucketKey(namespace, tenantId, subjectId);
    const config = await this.getBucketConfig(namespace, tenantId, subjectId);

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
    delete (globalThis as TokenBucketGlobal)[TOKEN_BUCKET_GLOBAL_KEY];
  }

  /**
   * Shutdown the rate limiter
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
    this.redis = null;
    this.configGetters = {};
    delete (globalThis as TokenBucketGlobal)[TOKEN_BUCKET_GLOBAL_KEY];
    logger.info('[TokenBucketRateLimiter] Shutdown complete');
  }
}
