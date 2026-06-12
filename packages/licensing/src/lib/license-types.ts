/**
 * Types for the offline signed-license system.
 * Licenses are compact ES256-signed JWTs issued by Nine Minds.
 */

/** Tiers that can be encoded in a license (essentials/solo are never sold). */
export type LicenseTier = 'pro' | 'premium';

/** Parsed claims from a verified license JWT. */
export interface LicenseClaims {
  /** Issuer — always "nineminds-license" */
  iss: string;
  /** Unique license id (for support/lookup) */
  sub: string;
  /** Customer name shown in the UI */
  cust: string;
  /** Tier unlocked by this license */
  tier: LicenseTier;
  /** Optional seat count (informational in v1; not enforced) */
  seats?: number;
  /** Issued-at (seconds since epoch) */
  iat: number;
  /** Expiry (seconds since epoch) */
  exp: number;
  /**
   * Optional audience binding: the tenant UUID this license was issued for. When
   * present, the license is only valid on the appliance whose tenant matches;
   * absent means unbound (legacy) and is accepted on any appliance. Enforced at
   * activation by submitLicense and at runtime by resolveSelfHostTier.
   */
  aud?: string;
}

/** Reason a license failed verification. */
export type LicenseVerifyFailReason =
  | 'expired'
  | 'bad_signature'
  | 'unknown_kid'
  | 'malformed';

/** Result of verifyLicense(). */
export type LicenseVerifyResult =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; reason: LicenseVerifyFailReason };

/**
 * Type guard for a failed verification result (the member carrying `reason`).
 * Use this instead of relying on control-flow narrowing of `result.valid`, which
 * the `ee/server` tsconfig's module resolution doesn't apply consistently.
 */
export function isLicenseVerifyFailure(
  result: LicenseVerifyResult,
): result is { valid: false; reason: LicenseVerifyFailReason } {
  return !result.valid;
}
