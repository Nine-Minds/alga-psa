import { getTenantIdBySlug } from '@alga-psa/db';

const CACHE_TTL_MS = 60_000;

const tenantSlugCache = new Map<string, { tenant: string | null; expiresAt: number }>();

export async function resolveInboundWebhookTenantSlug(tenantSlug: string): Promise<string | null> {
  const cached = tenantSlugCache.get(tenantSlug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tenant;
  }

  const tenant = await getTenantIdBySlug(tenantSlug);
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
