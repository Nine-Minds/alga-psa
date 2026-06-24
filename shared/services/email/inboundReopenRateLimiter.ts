/**
 * Redis-backed backstop that caps how often a single ticket can be reopened by inbound
 * mail within a rolling window. This is the RFC 5230 (Sieve vacation) "do not respond to
 * the same correspondent repeatedly" idea applied to ticket reopens: it bounds runaway
 * notification -> auto-reply -> reopen loops driven by auto-responders that do NOT carry
 * the standard auto-reply markers (which `detectAutomatedInboundMessage` relies on).
 *
 * Design notes:
 * - Fixed-window counter via INCR + EXPIRE keyed per (tenant, ticket). Simple, atomic
 *   enough for a backstop, and identical behavior in the server and the email-service
 *   worker (no dependency on a process-specific rate-limiter singleton).
 * - Reuses the inbound-email Redis connection the worker already opens.
 * - Fails OPEN: a Redis hiccup must never block a legitimate reopen. The primary defenses
 *   (RFC 3834 auto-reply detection + outbound Auto-Submitted marking) remain in force.
 * - Only consult this when a reopen would otherwise happen, so ordinary comment-only
 *   replies are not counted against the limit.
 */

import { getInboundEmailRedisClient } from './unifiedInboundEmailQueue';

/** Minimal Redis surface needed for the fixed-window counter (satisfied by node-redis v4). */
export interface InboundReopenRedisClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

const KEY_PREFIX = 'alga:inbound-reopen-rl:';
const DEFAULT_MAX_REOPENS = 3;
const DEFAULT_WINDOW_SECONDS = 3600; // 1 hour

export interface InboundReopenRateLimitResult {
  /** True when the reopen is within the configured limit and should proceed. */
  allowed: boolean;
  /** Reopen attempts counted in the current window (including this one); -1 when unknown (fail-open). */
  count: number;
  /** Configured maximum reopens per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number((value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getRateLimitConfig(): { limit: number; windowSeconds: number } {
  return {
    limit: parsePositiveInteger(process.env.INBOUND_REOPEN_RATELIMIT_MAX, DEFAULT_MAX_REOPENS),
    windowSeconds: parsePositiveInteger(
      process.env.INBOUND_REOPEN_RATELIMIT_WINDOW_SECONDS,
      DEFAULT_WINDOW_SECONDS
    ),
  };
}

/**
 * Record a reopen attempt for the ticket and report whether it is within the limit.
 * Call this only when a reopen would otherwise be applied.
 */
export async function checkInboundReopenRateLimit(params: {
  tenantId: string;
  ticketId: string;
  /** Override for tests; defaults to the shared inbound-email Redis connection. */
  redisClientGetter?: () => Promise<InboundReopenRedisClient>;
}): Promise<InboundReopenRateLimitResult> {
  const { limit, windowSeconds } = getRateLimitConfig();
  const key = `${KEY_PREFIX}${params.tenantId}:${params.ticketId}`;

  try {
    const getClient = params.redisClientGetter ?? getInboundEmailRedisClient;
    const client = await getClient();
    const count = await client.incr(key);

    if (count === 1) {
      // First reopen in this window — start the TTL.
      await client.expire(key, windowSeconds);
    } else {
      // Defensive: ensure a TTL exists even if a prior EXPIRE was lost, so the key
      // cannot become permanent and wedge the ticket in a suppressed state forever.
      const ttl = await client.ttl(key);
      if (ttl < 0) {
        await client.expire(key, windowSeconds);
      }
    }

    return { allowed: count <= limit, count, limit, windowSeconds };
  } catch (error) {
    // Fail open: never block a legitimate reopen on a Redis failure.
    console.warn('[inboundReopenRateLimiter] check failed; allowing reopen (fail-open)', {
      tenantId: params.tenantId,
      ticketId: params.ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: true, count: -1, limit, windowSeconds };
  }
}
