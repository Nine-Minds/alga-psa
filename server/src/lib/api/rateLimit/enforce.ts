import logger from '@alga-psa/core/logger';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import type { NextRequest } from 'next/server';

import { apiRateLimitConfigGetter } from './apiRateLimitConfigGetter';
import { TooManyRequestsError, type ApiContext } from '../middleware/apiMiddleware';

export interface RateLimitDecision {
  limit: number;
  remaining: number;
  resetAt: string;
}

const RATE_LIMIT_BYPASS_PREFIXES = [
  '/api/health',
  '/api/healthz',
  '/api/readyz',
  '/api/v1/meta/health',
  '/api/v1/mobile/auth/',
  '/api/internal/ext-runner/',
  '/api/internal/ext-storage/',
  '/api/internal/ext-scheduler/',
  '/api/internal/ext-invoicing/',
  '/api/internal/ext-clients/',
  '/api/internal/ext-services/',
];

function isRateLimitEnforced(): boolean {
  return process.env.RATE_LIMIT_ENFORCE === 'true';
}

function getPathname(req: NextRequest | URL | string): string {
  if (typeof req === 'string') {
    return new URL(req, 'http://localhost').pathname;
  }

  if (req instanceof URL) {
    return req.pathname;
  }

  return new URL(req.url).pathname;
}

function buildThrottleHeaders(decision: RateLimitDecision, retryAfterMs?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': decision.resetAt,
  };

  if (retryAfterMs !== undefined) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  }

  return headers;
}

function emitRateLimitMetric(
  metric: string,
  payload: Record<string, unknown>,
  level: 'info' | 'warn' = 'info',
): void {
  logger[level](`[metric] ${metric}`, payload);
}

export function shouldBypassRateLimit(pathname: string): boolean {
  return RATE_LIMIT_BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function enforceApiRateLimit(
  req: NextRequest | URL | string,
  context: ApiContext,
): Promise<RateLimitDecision | null> {
  const pathname = getPathname(req);

  if (shouldBypassRateLimit(pathname)) {
    return null;
  }

  const subjectId = context.rateLimitSubjectId ?? context.apiKeyId;
  const bucketConfig = await apiRateLimitConfigGetter(context.tenant, subjectId);
  const result = await TokenBucketRateLimiter.getInstance().tryConsume('api', context.tenant, subjectId);

  const retryAfterMs = result.retryAfterMs;
  const decision: RateLimitDecision = {
    limit: bucketConfig.maxTokens,
    remaining: result.remaining,
    resetAt: new Date(Date.now() + (retryAfterMs ?? 0)).toISOString(),
  };

  const apiKeyId = context.apiKeyId ?? context.rateLimitSubjectId ?? null;
  const outcome = result.allowed
    ? 'allowed'
    : isRateLimitEnforced()
      ? 'throttled'
      : 'observed_deny';

  emitRateLimitMetric('api_rate_limit_consumed_total', {
    tenant: context.tenant,
    api_key_id: apiKeyId,
    outcome,
  });
  emitRateLimitMetric('api_rate_limit_remaining', {
    tenant: context.tenant,
    api_key_id: apiKeyId,
    remaining: decision.remaining,
  });

  if (result.remaining === -1) {
    emitRateLimitMetric('api_rate_limit_redis_unavailable_total', {
      tenant: context.tenant,
      api_key_id: apiKeyId,
      outcome,
      pathname,
    }, 'warn');
  }

  if (result.allowed) {
    return decision;
  }

  const headers = buildThrottleHeaders(decision, retryAfterMs);
  const details = {
    retry_after_ms: retryAfterMs,
    remaining: result.remaining,
  };

  logger.warn('[api-rate-limit] request throttled', {
    tenant: context.tenant,
    api_key_id: apiKeyId,
    pathname,
    retry_after_ms: retryAfterMs,
    remaining: result.remaining,
    enforce: isRateLimitEnforced(),
  });

  if (!isRateLimitEnforced()) {
    return decision;
  }

  const error = new TooManyRequestsError('Too many requests', details);
  error.headers = headers;
  throw error;
}
