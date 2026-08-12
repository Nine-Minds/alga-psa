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

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode a (possibly padded) base32 string per RFC 4648. Throws on bad input. */
export function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[=\s-]/g, '');
  if (normalized.length === 0) {
    throw new Error('Empty TOTP secret.');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 TOTP secret character: "${char}".`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Extract the `secret` query parameter from an `otpauth://` URI. Returns null
 * when the URI is not a valid otpauth TOTP URI (so callers can fall back to
 * treating the input as a raw base32 secret).
 */
export function parseOtpAuthUri(input: string): { secret: string } | null {
  if (!/^otpauth:\/\/totp\//i.test(input.trim())) {
    return null;
  }
  try {
    const url = new URL(input.trim());
    const secret = url.searchParams.get('secret')?.trim() ?? '';
    if (!secret) {
      return null;
    }
    return { secret };
  } catch {
    return null;
  }
}

/**
 * Normalize a user-supplied TOTP seed: `otpauth://` URIs are reduced to their
 * secret; anything else is treated as a raw base32 secret. Throws when the
 * value cannot be decoded.
 */
export function normalizeOtpSecret(input: string): string {
  const trimmed = input.trim();
  const parsed = parseOtpAuthUri(trimmed);
  const secret = parsed?.secret ?? trimmed;
  // Validate by decoding; throws on malformed input.
  base32Decode(secret);
  return secret.toUpperCase().replace(/[=\s-]/g, '');
}

function hmacSha1(key: Buffer, counter: bigint): Buffer {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  return crypto.createHmac('sha1', key).update(counterBuffer).digest();
}

/** Dynamic truncation per RFC 4226 §5.3. */
function dynamicTruncate(hash: Buffer): number {
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return binary % 10 ** TOTP_DIGITS;
}

export interface TotpResult {
  code: string;
  secondsRemaining: number;
}

/**
 * Current RFC 6238 code for a base32 secret at `timestampMs` (defaults to
 * now). Throws on a malformed secret (fail-closed — no TOTP display from a
 * corrupt seed).
 */
export function generateTotp(secretBase32: string, timestampMs: number = Date.now()): TotpResult {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
  const hash = hmacSha1(secret, BigInt(counter));
  const code = String(dynamicTruncate(hash)).padStart(TOTP_DIGITS, '0');
  const secondsRemaining = TOTP_PERIOD_SECONDS - Math.floor((timestampMs / 1000) % TOTP_PERIOD_SECONDS);
  return { code, secondsRemaining };
}
