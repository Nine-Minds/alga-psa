/**
 * Hudu reference-data helpers (EE-only): short-lived in-memory list cache,
 * value-stripping for asset-password payloads, and deep-link builders.
 *
 * SECURITY: the cache only ever holds list METADATA. Password records are
 * projected through toHuduAssetPasswordSummary (allowlist — `password`,
 * `otp_secret` and any unknown field can never pass) BEFORE they are cached
 * or returned. Reveal values are never cached anywhere (huduDataActions).
 */

import type { HuduAssetPassword, HuduAssetPasswordSummary } from './contracts';

export type HuduReferenceResource = 'assets' | 'articles' | 'asset_passwords';

export const HUDU_REFERENCE_CACHE_TTL_MS = 60_000;
export const HUDU_REFERENCE_CACHE_MAX_ENTRIES = 200;

interface HuduReferenceCacheEntry {
  items: unknown[];
  fetchedAt: string;
  expiresAt: number;
}

export interface HuduReferenceCacheHit<T> {
  items: T[];
  fetchedAt: string;
}

const referenceCache = new Map<string, HuduReferenceCacheEntry>();

function cacheKey(tenant: string, huduCompanyId: string, resource: HuduReferenceResource): string {
  return `${tenant}:${huduCompanyId}:${resource}`;
}

export function getCachedHuduList<T>(
  tenant: string,
  huduCompanyId: string,
  resource: HuduReferenceResource
): HuduReferenceCacheHit<T> | null {
  const key = cacheKey(tenant, huduCompanyId, resource);
  const entry = referenceCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    referenceCache.delete(key);
    return null;
  }
  return { items: entry.items as T[], fetchedAt: entry.fetchedAt };
}

export function setCachedHuduList(
  tenant: string,
  huduCompanyId: string,
  resource: HuduReferenceResource,
  items: unknown[],
  fetchedAt: string = new Date().toISOString()
): void {
  const key = cacheKey(tenant, huduCompanyId, resource);
  // Capped FIFO: Map preserves insertion order; drop the oldest entry at the cap.
  referenceCache.delete(key);
  if (referenceCache.size >= HUDU_REFERENCE_CACHE_MAX_ENTRIES) {
    const oldest = referenceCache.keys().next().value;
    if (oldest !== undefined) referenceCache.delete(oldest);
  }
  referenceCache.set(key, { items, fetchedAt, expiresAt: Date.now() + HUDU_REFERENCE_CACHE_TTL_MS });
}

export function clearHuduReferenceCache(): void {
  referenceCache.clear();
}

/**
 * Drop every cached list for one tenant (keys are `${tenant}:…`-prefixed).
 * Called on disconnect so a later reconnect with a different key can never be
 * served data fetched under the previous credentials (T111).
 */
export function clearHuduReferenceCacheForTenant(tenant: string): void {
  const prefix = `${tenant}:`;
  for (const key of referenceCache.keys()) {
    if (key.startsWith(prefix)) referenceCache.delete(key);
  }
}

export function getHuduReferenceCacheSize(): number {
  return referenceCache.size;
}

// ============ Value stripping (F064) ============

/**
 * Allowlist projection of an asset password: keeps only known-safe metadata
 * fields. `password`, `otp_secret`, TOTP codes, and any field Hudu adds later
 * are dropped by construction.
 */
export function toHuduAssetPasswordSummary(record: HuduAssetPassword): HuduAssetPasswordSummary {
  return {
    id: record.id,
    company_id: record.company_id,
    name: record.name,
    username: record.username ?? null,
    url: record.url ?? null,
    password_folder_name: record.password_folder_name ?? null,
    description: record.description ?? null,
    created_at: record.created_at ?? null,
    updated_at: record.updated_at ?? null,
  };
}

// ============ Deep-link builders (F065) ============

/** Instance origin from a stored base URL: strip trailing slashes and `/api(/v1)`. */
export function huduInstanceBaseUrl(baseUrl?: string | null): string | null {
  if (!baseUrl) return null;
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(?:\/v1)?$/, '');
  return trimmed || null;
}

/** Record deep-link: the record's own `url` (absolute as-is, relative resolved against the instance), else null. */
export function buildHuduRecordUrl(
  record: { url?: string | null } | null | undefined,
  baseUrl?: string | null
): string | null {
  const url = record?.url ?? null;
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = huduInstanceBaseUrl(baseUrl);
  if (!base) return null;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

export interface HuduCompanyLinkSource {
  url?: string | null;
  id_in_integration?: string | number | null;
  integration_slug?: string | null;
}

/**
 * Company deep-link fallback chain: the company's own `url` → the
 * /companies/jump API URL (only when id_in_integration + slug are known) → null.
 */
export function buildHuduCompanyUrl(
  company: HuduCompanyLinkSource | null | undefined,
  baseUrl?: string | null
): string | null {
  const direct = buildHuduRecordUrl(company, baseUrl);
  if (direct) return direct;

  const base = huduInstanceBaseUrl(baseUrl);
  const integrationId =
    company?.id_in_integration === null || company?.id_in_integration === undefined
      ? ''
      : String(company.id_in_integration).trim();
  const slug = company?.integration_slug?.trim();
  if (!base || !integrationId || !slug) return null;

  const params = new URLSearchParams({
    integration_id: integrationId,
    integration_slug: slug,
    integration_type: 'company',
  });
  return `${base}/api/v1/companies/jump?${params.toString()}`;
}
