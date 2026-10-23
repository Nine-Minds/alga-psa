import logger from '@alga-psa/core/logger';
import { QboClientService } from './qboClientService';

/**
 * The connected QuickBooks company's country, cached per (tenant, realm).
 *
 * Intuit's Automated Sales Tax restriction is country-specific: on a *US* AST
 * company the only line-level TaxCodeRefs it accepts are the TAX/NON pseudo
 * codes, and anything else faults with "Invalid Line TaxCode" (6100).
 * Canadian and other non-US AST companies legitimately carry their own custom
 * codes ("HST ON", "GST", "PST BC"), so any restriction has to be gated on the
 * company country and not on the AST flag alone.
 *
 * Every lookup fails open — an unreadable company, a missing Country field or
 * an unrecognised value all resolve to "not US", so a transient QuickBooks
 * error can never add a restriction of its own.
 */

const COMPANY_COUNTRY_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  value: string | null;
  expiresAt: number;
};

const companyCountryCache = new Map<string, CacheEntry>();

type QboCompanyInfoRow = {
  Country?: string | null;
  CompanyAddr?: { Country?: string | null } | null;
  LegalAddr?: { Country?: string | null } | null;
};

/** Values Intuit has been observed to return for a United States company file. */
const US_COUNTRY_VALUES = new Set(['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA']);

function buildCacheKey(tenantId: string, realmId: string): string {
  return `${tenantId}:${realmId}`;
}

function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/** True only for a country value that is recognisably the United States. */
export function isUnitedStatesQboCountry(country: string | null | undefined): boolean {
  return country ? US_COUNTRY_VALUES.has(country) : false;
}

/**
 * Reads CompanyInfo.Country for a realm, normalized to upper case.
 *
 * CompanyInfo has no GET-by-field endpoint; the query path routes
 * `SELECT * FROM CompanyInfo` to Intuit's companyinfo singleton. Country is
 * read from the top-level field first, then the company/legal address, because
 * older company files populate only the address.
 */
export async function getQboCompanyCountry(
  tenantId: string,
  realmId: string | null | undefined
): Promise<string | null> {
  if (!realmId) {
    return null;
  }

  const cacheKey = buildCacheKey(tenantId, realmId);
  const cached = companyCountryCache.get(cacheKey);
  if (cached) {
    if (Date.now() <= cached.expiresAt) {
      return cached.value;
    }
    companyCountryCache.delete(cacheKey);
  }

  let country: string | null;
  try {
    const qboClient = await QboClientService.create(tenantId, realmId);
    const [companyInfo] = await qboClient.query<QboCompanyInfoRow>('SELECT * FROM CompanyInfo');
    country =
      normalizeCountry(companyInfo?.Country) ??
      normalizeCountry(companyInfo?.CompanyAddr?.Country) ??
      normalizeCountry(companyInfo?.LegalAddr?.Country);
  } catch (error) {
    // Not cached: a transient failure must not pin "country unknown" for the
    // whole TTL, and treating it as unknown already restricts nothing.
    logger.warn('Failed to read QuickBooks company country', { tenantId, realmId, error });
    return null;
  }

  companyCountryCache.set(cacheKey, {
    value: country,
    expiresAt: Date.now() + COMPANY_COUNTRY_CACHE_TTL_MS
  });
  return country;
}

/** Convenience predicate over {@link getQboCompanyCountry}; unknown is not US. */
export async function isQboUnitedStatesCompany(
  tenantId: string,
  realmId: string | null | undefined
): Promise<boolean> {
  return isUnitedStatesQboCountry(await getQboCompanyCountry(tenantId, realmId));
}

export function clearQboCompanyCountryCacheForTenant(tenantId: string): void {
  const prefix = `${tenantId}:`;
  for (const key of companyCountryCache.keys()) {
    if (key.startsWith(prefix)) {
      companyCountryCache.delete(key);
    }
  }
}
