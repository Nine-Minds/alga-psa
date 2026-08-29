/**
 * RFC 6238 TOTP helper for the credentials vault (EE-only).
 *
 * Self-contained: no new dependency. Implements base32 (RFC 4648) decoding,
 * `otpauth://` URI parsing, secret normalization, and the current rolling
 * 6-digit code with `secondsRemaining` for the client countdown. Standard
 * defaults: 30s period, SHA-1, 6 digits.
 *
 * The seed itself is a value-bearing secret: it is only ever supplied by the
 * reveal-time decrypt path and is never persisted, cached, or logged.
 */

import crypto from 'node:crypto';
import {
  base32Decode,
  counterBytes,
  counterFor,
  dynamicTruncate,
  secondsRemaining,
  validateOtpSeed,
  type TotpResult,
} from './totpCore';
export * from './totpCore';

/**
 * Normalize a user-supplied TOTP seed: `otpauth://` URIs are reduced to their
 * secret; anything else is treated as a raw base32 secret. Throws when the
 * value cannot be decoded.
 */
export function normalizeOtpSecret(input: string): string {
  const result = validateOtpSeed(input);
  if ('reason' in result) {
    throw new Error(
      result.reason === 'unsupportedParams'
        ? 'Unsupported TOTP parameters.'
        : 'Invalid TOTP secret.'
    );
  }
  return result.secret;
}

/**
 * Current RFC 6238 code for a base32 secret at `timestampMs` (defaults to
 * now). Throws on a malformed secret (fail-closed — no TOTP display from a
 * corrupt seed).
 */
export function generateTotp(secretBase32: string, timestampMs: number = Date.now()): TotpResult {
  const hash = crypto
    .createHmac('sha1', base32Decode(secretBase32))
    .update(counterBytes(counterFor(timestampMs)))
    .digest();
  return { code: dynamicTruncate(hash), secondsRemaining: secondsRemaining(timestampMs) };
}
