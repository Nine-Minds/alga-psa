import { describe, it, expect, beforeEach } from 'vitest';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';

/**
 * Fixture tokens signed with the committed v1-test keypair.
 * Regenerate via: node packages/licensing/scripts/gen-test-fixtures.mjs
 *
 * validToken    — pro license, expires ~1 year from generation
 * expiredToken  — pro license, already expired
 * premiumToken  — premium license, valid
 * wrongKidToken — signed with v1-test key but kid=v1 (key mismatch)
 * tamperedToken — payload modified after signing (signature mismatch)
 */
const FIXTURES = {
  validToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.E3uQWkwlsZ0MKSpTrb88yptO0zLIKEQJM0sHrDMiMFyXdviYplhSBDfGr4vU9T5eBDJpoCZ0urRXMwA22Ow8Rg',
  expiredToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMiIsInRpZXIiOiJwcm8iLCJpYXQiOjE3MjA3NTExNTMsImV4cCI6MTc1MjI4NzE1M30.htsL34WWTjMpA0Go8mPxqZ8HY4I8qmqawzhCqNaqmAK9XMVgiOX13tOQ2WVx-N2ljpAkAzMkKue5b-32KOsUlQ',
  premiumToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMyIsInRpZXIiOiJwcmVtaXVtIiwiaWF0IjoxNzgzODIzMTUzLCJleHAiOjE4MTUzNTkxNTN9.hv7CKr60F7gQ96UNuk2wlhvHiNzdRMoCEcWP5HVM5P0_bICxVz5n1zaCHbgonvceNp5VH-qVcAgaUTfbEZIw1w',
  wrongKidToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxIn0.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.B6WdjAbIw2B5-OHEE8pnS2BflOKac-UhyOP_8GCYiZS4DfQj2E_QNTBMNZkl04GQpzBZbcd1QkcskHC_3k_UzA',
  tamperedToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJ4eHgiLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.E3uQWkwlsZ0MKSpTrb88yptO0zLIKEQJM0sHrDMiMFyXdviYplhSBDfGr4vU9T5eBDJpoCZ0urRXMwA22Ow8Rg',
};

describe('verifyLicense', () => {
  beforeEach(() => clearLicenseVerifyCache());

  // T001: valid token → success
  it('accepts a valid token and returns correct claims', () => {
    const result = verifyLicense(FIXTURES.validToken);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims.tier).toBe('pro');
    expect(result.claims.cust).toBe('Test Corp');
    expect(result.claims.sub).toBe('lic_test001');
    expect(result.claims.iss).toBe('nineminds-license');
    expect(result.claims.exp).toBeGreaterThan(Date.now() / 1000);
  });

  // T002: expired token
  it('rejects an expired token with reason "expired"', () => {
    const result = verifyLicense(FIXTURES.expiredToken);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe('expired');
  });

  // T003: tampered payload (payload modified, original signature)
  it('rejects a tampered token with reason "bad_signature" or "malformed"', () => {
    const result = verifyLicense(FIXTURES.tamperedToken);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(['bad_signature', 'malformed']).toContain(result.reason);
  });

  // T004: unknown kid
  it('rejects a token with unknown kid with reason "bad_signature"', () => {
    // wrongKidToken has kid=v1 but was signed with v1-test private key,
    // so the v1 public key will reject the signature.
    const result = verifyLicense(FIXTURES.wrongKidToken);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe('bad_signature');
  });

  // T005 (rotation): premium token with v1-test kid verifies correctly
  it('verifies a premium token signed with the v1-test kid', () => {
    const result = verifyLicense(FIXTURES.premiumToken);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims.tier).toBe('premium');
  });

  // T006: malformed (not a JWT at all)
  it('rejects a malformed string with reason "malformed"', () => {
    const result = verifyLicense('not-a-jwt');
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe('malformed');
  });

  // T006b: missing kid in header
  it('rejects a token without a kid header with reason "unknown_kid"', () => {
    // Build a token without kid in the header
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'nineminds-license', sub: 'x', cust: 'y', tier: 'pro', iat: 1, exp: 9999999999 })).toString('base64url');
    const fakeToken = `${header}.${payload}.fakesig`;
    const result = verifyLicense(fakeToken);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe('unknown_kid');
  });

  // T017: memoization
  it('returns the same result object on second call (memoization)', () => {
    const r1 = verifyLicense(FIXTURES.validToken);
    const r2 = verifyLicense(FIXTURES.validToken);
    expect(r1).toBe(r2);
  });

  it('re-verifies after cache is cleared', () => {
    const r1 = verifyLicense(FIXTURES.validToken);
    clearLicenseVerifyCache();
    const r2 = verifyLicense(FIXTURES.validToken);
    expect(r1).not.toBe(r2);
    expect(r1).toEqual(r2);
  });
});
