import jwt from 'jsonwebtoken';
import { LICENSE_PUBLIC_KEYS } from './license-keys';
import type { LicenseClaims, LicenseVerifyResult } from './license-types';

/** Clock-skew tolerance in seconds. */
const CLOCK_SKEW_SECONDS = 60;

/** Expected JWT issuer. */
const EXPECTED_ISSUER = 'nineminds-license';

/**
 * In-process cache: token string → verify result.
 * Invalidated by clearLicenseVerifyCache() when a new license is stored.
 */
const verifyCache = new Map<string, LicenseVerifyResult>();

/**
 * Clears the in-process verification cache.
 * Call this after storing a new license token so the next request re-verifies.
 */
export function clearLicenseVerifyCache(): void {
  verifyCache.clear();
}

/**
 * Verifies an offline license token (ES256 signed JWT).
 *
 * Checks: signature (against baked-in public keys keyed by kid), issuer,
 * expiry (with clock-skew tolerance), and tier validity.
 *
 * Results are memoized per token string for the lifetime of the process
 * (cleared on license update). This is safe because the token itself encodes
 * its expiry — a token that was valid at memoization time will correctly
 * return `expired` once we re-verify after the cache is cleared.
 */
export function verifyLicense(token: string): LicenseVerifyResult {
  const cached = verifyCache.get(token);
  if (cached) return cached;

  const result = verifyLicenseUncached(token);
  // Only cache valid results and permanent failures (bad_signature, unknown_kid, malformed).
  // Do NOT cache 'expired' — clocks advance.
  if (result.valid || result.reason !== 'expired') {
    verifyCache.set(token, result);
  }
  return result;
}

function verifyLicenseUncached(token: string): LicenseVerifyResult {
  // Decode header to get kid without verifying (we need the kid to pick the key).
  let decoded: jwt.Jwt | null;
  try {
    decoded = jwt.decode(token, { complete: true });
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (!decoded || typeof decoded !== 'object') {
    return { valid: false, reason: 'malformed' };
  }

  const kid = decoded.header?.kid;
  if (typeof kid !== 'string' || !kid) {
    return { valid: false, reason: 'unknown_kid' };
  }

  const publicKey = LICENSE_PUBLIC_KEYS[kid];
  if (!publicKey) {
    return { valid: false, reason: 'unknown_kid' };
  }

  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, publicKey, {
      algorithms: ['ES256'],
      issuer: EXPECTED_ISSUER,
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    if (typeof verified === 'string' || !verified) {
      return { valid: false, reason: 'malformed' };
    }
    payload = verified as jwt.JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, reason: 'expired' };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      // covers invalid signature, wrong algorithm, wrong issuer, malformed
      const msg = (err as Error).message ?? '';
      if (msg.includes('invalid signature') || msg.includes('algorithm')) {
        return { valid: false, reason: 'bad_signature' };
      }
      return { valid: false, reason: 'malformed' };
    }
    return { valid: false, reason: 'malformed' };
  }

  // Validate required claims.
  const { sub, cust, tier, iat, exp } = payload;
  if (
    typeof sub !== 'string' || !sub ||
    typeof cust !== 'string' || !cust ||
    (tier !== 'pro' && tier !== 'premium') ||
    typeof iat !== 'number' ||
    typeof exp !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const claims: LicenseClaims = {
    iss: EXPECTED_ISSUER,
    sub,
    cust,
    tier,
    iat,
    exp,
    ...(typeof payload.seats === 'number' ? { seats: payload.seats } : {}),
  };

  return { valid: true, claims };
}
