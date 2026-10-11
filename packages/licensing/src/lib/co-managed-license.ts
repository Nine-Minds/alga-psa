import { verifyLicense } from './verify-license';
import { isLicenseVerifyFailure } from './license-types';

/** Resolve offline capacity only from a current, signed, sponsor-bound license.
 * Generic MSP seats (including legacy unlimited seats) confer no customer seats.
 * Recheck expiry because signature verification caches successful results.
 */
export function getCoManagedLicenseCapacity(
  token: string | null | undefined,
  sponsorTenant: string,
  now: Date = new Date(),
): number {
  if (!token || !sponsorTenant || !Number.isFinite(now.getTime())) return 0;
  const result = verifyLicense(token);
  if (isLicenseVerifyFailure(result)) return 0;
  const { claims } = result;
  if (claims.tier !== 'pro' || claims.aud !== sponsorTenant || claims.exp * 1000 <= now.getTime()) {
    return 0;
  }
  return claims.co_managed_seats ?? 0;
}
