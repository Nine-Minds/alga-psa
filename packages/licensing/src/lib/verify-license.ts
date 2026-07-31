import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { LICENSE_PUBLIC_KEYS } from './license-keys';
import { isLicenseVerifyFailure } from './license-types';
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
 * Implemented directly on node:crypto rather than a JWT library. This package
 * is compiled into consumers' dist trees (e.g. the temporal worker), where a
 * third-party runtime dependency is not guaranteed to be installed — a bare
 * import here shipped as ERR_MODULE_NOT_FOUND in production. The verification
 * surface is deliberately narrow (ES256 only, fixed issuer, baked-in keys, no
 * algorithm negotiation), so stdlib verification is both sufficient and safer
 * to package. Keep it dependency-free.
 *
 * Results are memoized per token string for the lifetime of the process
 * (cleared on license update via clearLicenseVerifyCache). A 'valid' result is
 * cached, so within a single process this function will keep returning
 * { valid: true } for a token whose `exp` passes mid-process — it does NOT
 * re-evaluate the clock until the cache is cleared.
 *
 * IMPORTANT: callers that need a point-in-time expiry decision MUST re-check
 * `claims.exp` against the current time themselves (resolveSelfHostTier and
 * submitLicense both do). Do not treat `valid: true` alone as "not expired".
 * 'expired' results are never cached, so a token that is already expired on
 * first verification is always reported as expired.
 */
export function verifyLicense(token: string): LicenseVerifyResult {
  const cached = verifyCache.get(token);
  if (cached) return cached;

  const result = verifyLicenseUncached(token);
  // Only cache valid results and permanent failures (bad_signature, unknown_kid, malformed).
  // Do NOT cache 'expired' — clocks advance.
  if (!(isLicenseVerifyFailure(result) && result.reason === 'expired')) {
    verifyCache.set(token, result);
  }
  return result;
}

/** Per-kid parsed key cache (createPublicKey is not free). */
const keyCache = new Map<string, KeyObject>();

function publicKeyFor(kid: string): KeyObject | null {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const pem = LICENSE_PUBLIC_KEYS[kid];
  if (!pem) return null;
  const key = createPublicKey(pem);
  keyCache.set(kid, key);
  return key;
}

/** Strict base64url segment → parsed JSON object, or null. */
function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function verifyLicenseUncached(token: string): LicenseVerifyResult {
  if (typeof token !== 'string') {
    return { valid: false, reason: 'malformed' };
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return { valid: false, reason: 'malformed' };
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;

  const header = decodeJsonSegment(headerSegment);
  if (!header) {
    return { valid: false, reason: 'malformed' };
  }

  // kid is resolved before anything else: without it there is no key to
  // verify against, and 'unknown_kid' is the more actionable failure.
  const kid = header.kid;
  if (typeof kid !== 'string' || !kid) {
    return { valid: false, reason: 'unknown_kid' };
  }
  const publicKey = publicKeyFor(kid);
  if (!publicKey) {
    return { valid: false, reason: 'unknown_kid' };
  }

  // ES256 only — no algorithm negotiation.
  if (header.alg !== 'ES256') {
    return { valid: false, reason: 'bad_signature' };
  }

  if (!signatureSegment || !/^[A-Za-z0-9_-]+$/.test(signatureSegment)) {
    return { valid: false, reason: 'bad_signature' };
  }
  const signature = Buffer.from(signatureSegment, 'base64url');
  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`);
  let signatureOk = false;
  try {
    // JWS ES256 signatures are the raw r||s (IEEE P1363) form, not DER.
    signatureOk = cryptoVerify(
      'sha256',
      signingInput,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { valid: false, reason: 'bad_signature' };
  }

  const payload = decodeJsonSegment(payloadSegment);
  if (!payload) {
    return { valid: false, reason: 'malformed' };
  }

  if (payload.iss !== EXPECTED_ISSUER) {
    return { valid: false, reason: 'malformed' };
  }

  const nowSeconds = Date.now() / 1000;
  if (typeof payload.nbf === 'number' && nowSeconds + CLOCK_SKEW_SECONDS < payload.nbf) {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof payload.exp === 'number' && nowSeconds - CLOCK_SKEW_SECONDS >= payload.exp) {
    return { valid: false, reason: 'expired' };
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
