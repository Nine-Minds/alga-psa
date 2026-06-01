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
