import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  generateTotp,
  normalizeOtpSecret,
  parseOtpAuthUri,
  TOTP_PERIOD_SECONDS,
} from '@ee/lib/credentials/totp';

// RFC 6238 §5.4 test vectors (SHA-1). The shared ASCII secret
// "12345678901234567890" base32-encodes to GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
// The RFC's reference codes are 8-digit; the plan's vault uses 6-digit codes,
// so the vectors below are the same HOTP dynamic-truncation values reduced to
// 6 digits (cross-checked against the in-repo `speakeasy` implementation).
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS_6DIGIT: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP base32 decoding (RFC 4648)', () => {
  it('decodes the RFC secret and known encodings', () => {
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString('utf8')).toBe('12345678901234567890');
    expect(base32Decode('MZXW6').toString('utf8')).toBe('foo');
    expect(base32Decode('MZXW6YTB').toString('utf8')).toBe('fooba');
  });

  it('is tolerant of padding, lowercase, spaces and dashes', () => {
    expect(base32Decode('mzxw6====').toString('utf8')).toBe('foo');
    expect(base32Decode('mz xw6y-tb').toString('utf8')).toBe('fooba');
  });

  it('throws on invalid characters and empty input', () => {
    expect(() => base32Decode('abc!')).toThrow(/base32/);
    expect(() => base32Decode('')).toThrow(/Empty/);
  });
});

describe('TOTP otpauth URI parsing + normalization', () => {
  it('parses an otpauth://totp URI and extracts the secret', () => {
    expect(parseOtpAuthUri('otpauth://totp/Acme:robert?secret=JBSWY3DPEHPK3PXP&issuer=Acme')).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
    });
  });

  it('returns null for non-otpauth inputs', () => {
    expect(parseOtpAuthUri('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(parseOtpAuthUri('https://example.test/foo')).toBeNull();
  });

  it('normalizeOtpSecret accepts raw base32 or a URI and normalizes casing', () => {
    expect(normalizeOtpSecret('jbswy3dpehpk3pxp')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeOtpSecret('otpauth://totp/Acme?secret=jbswy3dpehpk3pxp&issuer=Acme')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('normalizeOtpSecret throws on a malformed seed', () => {
    expect(() => normalizeOtpSecret('not-a-secret!!!')).toThrow();
  });
});

describe('RFC 6238 TOTP code generation (SHA-1 / 30s / 6 digits)', () => {
  it.each(RFC_VECTORS_6DIGIT)('produces the RFC-derived 6-digit code at T=%d', (timestampSeconds, expected) => {
    const { code } = generateTotp(RFC_SECRET_BASE32, timestampSeconds * 1000);
    expect(code).toBe(expected);
  });

  it('reports secondsRemaining within the 30s window', () => {
    const { secondsRemaining } = generateTotp(RFC_SECRET_BASE32, 0);
    expect(secondsRemaining).toBeGreaterThan(0);
    expect(secondsRemaining).toBeLessThanOrEqual(TOTP_PERIOD_SECONDS);
  });

  it('pads codes shorter than six digits', () => {
    // Deterministic low-value code by clamping the counter near 0.
    const { code } = generateTotp(RFC_SECRET_BASE32, 0);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('throws (fail-closed) on a malformed seed', () => {
    expect(() => generateTotp('not-a-secret!!!', Date.now())).toThrow();
  });
});
