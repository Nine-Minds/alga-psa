import type { BucketConfig } from '@alga-psa/core/rateLimit';

import { resolveApiRateLimitConfig } from './apiRateLimitSettingsModel';

const CACHE_MAX_ENTRIES = 1000;
const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  value: BucketConfig;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function getCacheKey(tenantId: string, apiKeyId?: string): string {
  return `${tenantId}:${apiKeyId ?? '*'}`;
}

function setCacheEntry(key: string, value: BucketConfig): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function apiRateLimitConfigGetter(
  tenantId: string,
  apiKeyId?: string,
): Promise<BucketConfig> {
  const cacheKey = getCacheKey(tenantId, apiKeyId);
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (cached) {
    cache.delete(cacheKey);
  }

  const config = await resolveApiRateLimitConfig(tenantId, apiKeyId);
  setCacheEntry(cacheKey, config);
  return config;
}

export function invalidateApiRateLimitConfig(tenantId: string, apiKeyId?: string): void {
  if (apiKeyId) {
    cache.delete(getCacheKey(tenantId, apiKeyId));
    return;
  }

  const tenantPrefix = `${tenantId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(tenantPrefix)) {
      cache.delete(key);
    }
  }
}

export function resetApiRateLimitConfigCacheForTests(): void {
  cache.clear();
}
