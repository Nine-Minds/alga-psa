import { getTenantIdBySlug } from '@alga-psa/db';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;

const tenantSlugCache = new Map<string, { tenant: string | null; expiresAt: number }>();

export async function resolveInboundWebhookTenantSlug(tenantSlug: string): Promise<string | null> {
  const cached = tenantSlugCache.get(tenantSlug);
  if (cached && cached.expiresAt > Date.now()) {
    tenantSlugCache.delete(tenantSlug);
    tenantSlugCache.set(tenantSlug, cached);
    return cached.tenant;
  }

  const tenant = await getTenantIdBySlug(tenantSlug);

  if (tenantSlugCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = tenantSlugCache.keys().next().value;
    if (oldestKey !== undefined) {
      tenantSlugCache.delete(oldestKey);
    }
  }

  tenantSlugCache.set(tenantSlug, {
    tenant,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return tenant;
}

export function clearInboundWebhookTenantSlugCacheForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearInboundWebhookTenantSlugCacheForTest may only be used in tests');
  }

  tenantSlugCache.clear();
}
