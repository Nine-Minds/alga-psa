import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSelfHostTier, type LicenseStateRow } from './license-state';
import { clearLicenseVerifyCache } from './verify-license';

// Fixture tokens from verify-license.test.ts (signed with v1-test key).
const VALID_PRO_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.E3uQWkwlsZ0MKSpTrb88yptO0zLIKEQJM0sHrDMiMFyXdviYplhSBDfGr4vU9T5eBDJpoCZ0urRXMwA22Ow8Rg';
const EXPIRED_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMiIsInRpZXIiOiJwcm8iLCJpYXQiOjE3MjA3NTExNTMsImV4cCI6MTc1MjI4NzE1M30.htsL34WWTjMpA0Go8mPxqZ8HY4I8qmqawzhCqNaqmAK9XMVgiOX13tOQ2WVx-N2ljpAkAzMkKue5b-32KOsUlQ';
const PREMIUM_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMyIsInRpZXIiOiJwcmVtaXVtIiwiaWF0IjoxNzgzODIzMTUzLCJleHAiOjE4MTUzNTkxNTN9.hv7CKr60F7gQ96UNuk2wlhvHiNzdRMoCEcWP5HVM5P0_bICxVz5n1zaCHbgonvceNp5VH-qVcAgaUTfbEZIw1w';

function makeRow(overrides: Partial<LicenseStateRow> = {}): LicenseStateRow {
  return {
    id: 1,
    edition_choice: 'ee',
    trial_started_at: null,
    license_token: null,
    updated_at: new Date(),
    appliance_id: null,
    check_in_url: null,
    appliance_credential: null,
    last_checkin_at: null,
    ...overrides,
  };
}

describe('resolveSelfHostTier', () => {
  beforeEach(() => clearLicenseVerifyCache());

  // T008: no row → null
  it('returns null when no row exists (SaaS mode)', () => {
    expect(resolveSelfHostTier(null)).toBeNull();
  });

  // T009: valid license → license.tier
  it('returns license.tier for a valid unexpired license', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN }));
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.daysRemaining).toBeGreaterThan(0);
  });

  it('returns premium for a valid premium license', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: PREMIUM_TOKEN }));
    expect(result?.tier).toBe('premium');
    expect(result?.state).toBe('licensed');
  });

  // T010: active trial → premium
  it('returns premium during an active 15-day trial', () => {
    const trialStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const result = resolveSelfHostTier(makeRow({ trial_started_at: trialStart }));
    expect(result?.state).toBe('trial');
    expect(result?.tier).toBe('premium');
    expect(result?.daysRemaining).toBeGreaterThan(0);
    expect(result?.daysRemaining).toBeLessThanOrEqual(10);
  });

  // T011: trial expired → essentials
  it('returns essentials after the 15-day trial window elapses', () => {
    const trialStart = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000); // 16 days ago
    const result = resolveSelfHostTier(makeRow({ trial_started_at: trialStart }));
    expect(result?.state).toBe('trial_expired');
    expect(result?.tier).toBe('essentials');
  });

  // T012: license expired → essentials
  it('returns essentials when the license has expired', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN }));
    expect(result?.state).toBe('license_expired');
    expect(result?.tier).toBe('essentials');
  });

  // T013: CE choice → essentials
  it('returns essentials for edition_choice = ce', () => {
    const result = resolveSelfHostTier(makeRow({ edition_choice: 'ce' }));
    expect(result?.state).toBe('ce');
    expect(result?.tier).toBe('essentials');
  });

  // T014: self-host mode supersedes tenants.plan (tested implicitly via null check)
  it('returns self-host resolved tier regardless of plan column', () => {
    // The row itself doesn't carry a plan column — the test proves the resolver
    // runs at all when a row is present, returning essentials for an ee choice
    // with no trial and no license.
    const result = resolveSelfHostTier(makeRow({ edition_choice: 'ee' }));
    expect(result?.tier).toBe('essentials');
    // Fresh ee install with no trial used: trial_available, NOT trial_expired —
    // the expired state (and its banner) is reserved for an actually-elapsed trial.
    expect(result?.state).toBe('trial_available');
  });

  it('license takes precedence over an active trial', () => {
    const trialStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN, trial_started_at: trialStart }));
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
  });
});
