/** Browser-safe RFC 6238 primitives shared by credential TOTP generation. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpResult {
  code: string;
  secondsRemaining: number;
}

export interface ParsedOtpAuthUri {
  secret: string;
  algorithm: string | null;
  digits: string | null;
  period: string | null;
}

export type OtpSeedValidation =
  | { ok: true; secret: string }
  | { ok: false; reason: 'invalid' | 'unsupportedParams' };

export function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/[=\s-]/g, '');
  if (!normalized) throw new Error('Empty TOTP secret.');

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
  return new Uint8Array(bytes);
}

export function parseOtpAuthUri(input: string): ParsedOtpAuthUri | null {
  if (!/^otpauth:\/\/totp\//i.test(input.trim())) return null;
  try {
    const url = new URL(input.trim());
    const secret = url.searchParams.get('secret')?.trim() ?? '';
    if (!secret) return null;
    return {
      secret,
      algorithm: url.searchParams.get('algorithm'),
      digits: url.searchParams.get('digits'),
      period: url.searchParams.get('period'),
    };
  } catch {
    return null;
  }
}

export function counterFor(timestampMs: number): bigint {
  return BigInt(Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS));
}

export function counterBytes(counter: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(counter & 0xffn);
    counter >>= 8n;
  }
  return bytes;
}

export function dynamicTruncate(hash: Uint8Array): string {
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function secondsRemaining(timestampMs: number): number {
  return TOTP_PERIOD_SECONDS - Math.floor((timestampMs / 1000) % TOTP_PERIOD_SECONDS);
}

export function validateOtpSeed(input: string): OtpSeedValidation {
  const trimmed = input.trim();
  const parsed = parseOtpAuthUri(trimmed);
  if (/^otpauth:\/\//i.test(trimmed) && !parsed) {
    return { ok: false, reason: 'invalid' };
  }
  if (
    parsed &&
    ((parsed.algorithm && parsed.algorithm.toUpperCase() !== 'SHA1') ||
      (parsed.digits && parsed.digits !== '6') ||
      (parsed.period && parsed.period !== '30'))
  ) {
    return { ok: false, reason: 'unsupportedParams' };
  }

  const secret = (parsed?.secret ?? trimmed).toUpperCase().replace(/[=\s-]/g, '');
  try {
    base32Decode(secret);
    return { ok: true, secret };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
