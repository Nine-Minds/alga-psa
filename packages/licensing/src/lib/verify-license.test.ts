import { describe, it, expect, beforeEach } from 'vitest';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';

/**
 * Fixture tokens signed with the committed v1-test keypair.
 * Regenerate via: node ee/tools/alga-license/sign.mjs gen-fixture
 *
 * validToken    — pro license, expires ~1 year from generation
 * expiredToken  — pro license, already expired
 * premiumToken  — premium license, valid
 * wrongKidToken — signed with v1-test key but kid=v1 (key mismatch)
 * tamperedToken — payload modified after signing (signature mismatch)
 */
const FIXTURES = {
  validToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAxIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODAxNjc1MTgsImV4cCI6MTgxMTcwMzUxOH0.CjBrb4ksHYRH3a8I_mlAxp81P4GgqzV8ggQ-yzQ0BYBIxz1maJp-tanhp_6olr5Vep21sMZmYYCSnXeivuoVJA',
  expiredToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAyIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcm8iLCJpYXQiOjE3NDU2MDc1MTgsImV4cCI6MTc3NzU3NTUxOH0.jzvr_nIahZogR8AwnEvY4OYyj43QLWTrQdm945EbAZ-ji1Hm09TwLxa7I6cPKGHAjOLXMiTm3Y-X8V9zqSY_4A',
  premiumToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAzIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcmVtaXVtIiwiaWF0IjoxNzgwMTY3NTE4LCJleHAiOjE4MTE3MDM1MTh9.qG550P5on5B4NsC7SDRj1Lqjpb9FjiEPxHw-fS19RCHGqBlEx6dAns0ijRkWkbBvDABxAg9MQvdD82I1eJwCMQ',
  wrongKidToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxIn0.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAxIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODAxNjc1MTgsImV4cCI6MTgxMTcwMzUxOH0.ESSXau-4WrOnAmG4HcIZP5bYjOKKRc9_D34DirgAqzfKFCLUofvRUDPpMh67yLIq6wvk0o--rXsiZEgFJ7c6Hw',
  tamperedToken:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAxIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJ4eHgiLCJpYXQiOjE3ODAxNjc1MTgsImV4cCI6MTgxMTcwMzUxOH0.CjBrb4ksHYRH3a8I_mlAxp81P4GgqzV8ggQ-yzQ0BYBIxz1maJp-tanhp_6olr5Vep21sMZmYYCSnXeivuoVJA',
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
