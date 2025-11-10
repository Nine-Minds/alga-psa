import { getInstallConfig, type InstallConfigResult } from './install-config';

type CacheKey = string;

interface CacheEntry {
  value: InstallConfigResult;
  expiresAt: number;
}

const CACHE = new Map<CacheKey, CacheEntry>();
const DEFAULT_TTL_MS = 5_000;

function getTtl(): number {
  const raw = process.env.EXT_INSTALL_CONFIG_CACHE_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MS;
  return parsed;
}

function makeKey(tenantId: string, extensionId: string): CacheKey {
  return `${tenantId.toLowerCase()}::${extensionId.toLowerCase()}`;
}

export function invalidateInstallConfigCache(tenantId: string, extensionId: string): void {
  CACHE.delete(makeKey(tenantId, extensionId));
}

export async function loadInstallConfigCached(
  tenantId: string,
  extensionId: string,
): Promise<InstallConfigResult | null> {
  const key = makeKey(tenantId, extensionId);
  const now = Date.now();
  const entry = CACHE.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }

  const result = await getInstallConfig({ tenantId, extensionId });
  if (!result) {
    CACHE.delete(key);
    return null;
  }

  const ttl = getTtl();
  CACHE.set(key, {
    value: result,
    expiresAt: now + ttl,
  });

  return result;
}
