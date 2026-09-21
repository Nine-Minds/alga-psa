import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtureKeys = vi.hoisted(() => ({ publicKey: '' }));
vi.mock('./license-keys', () => ({
  LICENSE_PUBLIC_KEYS: fixtureKeys,
}));

import { getCoManagedLicenseCapacity } from './co-managed-license';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';
import { resolveSelfHostTier, type LicenseStateRow } from './license-state';

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
fixtureKeys.publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const sponsor = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';

function signedLicense(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'publicKey' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'nineminds-license', sub: 'co-managed-test', cust: 'Test fixture', tier: 'pro',
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 3600,
    aud: sponsor, seats: 3, co_managed_seats: 12,
    ...overrides,
  })).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: keys.privateKey, dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('signed co-managed license capacity', () => {
  beforeEach(() => clearLicenseVerifyCache());

  it('preserves sponsor binding and counts customer seats separately from MSP seats', () => {
    const token = signedLicense();
    expect(verifyLicense(token)).toMatchObject({ valid: true, claims: {
      aud: sponsor, seats: 3, co_managed_seats: 12,
    } });
    expect(getCoManagedLicenseCapacity(token, sponsor)).toBe(12);
    expect(getCoManagedLicenseCapacity(token, other)).toBe(0);
  });

  it('enforces the existing tenant binding through real signature verification', () => {
    const row = {
      id: 1, edition_choice: 'ee', trial_started_at: null,
      license_token: signedLicense(), updated_at: new Date(),
      appliance_id: null, check_in_url: null, appliance_credential: null, last_checkin_at: null,
    } satisfies LicenseStateRow;
    expect(resolveSelfHostTier(row, sponsor)?.state).toBe('licensed');
    expect(resolveSelfHostTier(row, other)?.state).toBe('license_wrong_tenant');
  });

  it.each([
    { co_managed_seats: undefined },
    { co_managed_seats: undefined, seats: undefined },
    { aud: undefined },
    { co_managed_seats: 0 },
  ])('does not infer capacity from legacy/unbound licenses: %j', (claims) => {
    expect(getCoManagedLicenseCapacity(signedLicense(claims), sponsor)).toBe(0);
  });

  it.each([-1, 0.5, '12', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid capacity %j', (capacity) => {
    const token = signedLicense({ co_managed_seats: capacity });
    expect(verifyLicense(token)).toEqual({ valid: false, reason: 'malformed' });
    expect(getCoManagedLicenseCapacity(token, sponsor)).toBe(0);
  });

  it.each(['', [], [sponsor], null])('rejects malformed sponsor binding %j', (aud) => {
    expect(verifyLicense(signedLicense({ aud }))).toEqual({ valid: false, reason: 'malformed' });
  });

  it('rechecks expiry even when a valid signature result is cached', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signedLicense({ exp });
    expect(getCoManagedLicenseCapacity(token, sponsor)).toBe(12);
    expect(getCoManagedLicenseCapacity(token, sponsor, new Date(exp * 1000))).toBe(0);
  });

  it('rejects forged, expired, absent, and invalid-clock inputs', () => {
    const token = signedLicense();
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload, 'base64url').toString()), co_managed_seats: 999,
    })).toString('base64url');
    expect(getCoManagedLicenseCapacity(`${header}.${forgedPayload}.${signature}`, sponsor)).toBe(0);
    expect(getCoManagedLicenseCapacity(signedLicense({ exp: 1 }), sponsor)).toBe(0);
    expect(getCoManagedLicenseCapacity(null, sponsor)).toBe(0);
    expect(getCoManagedLicenseCapacity(token, '')).toBe(0);
    expect(getCoManagedLicenseCapacity(token, sponsor, new Date(NaN))).toBe(0);
  });
});
