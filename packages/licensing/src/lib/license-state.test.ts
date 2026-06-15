import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSelfHostTier, type LicenseStateRow } from './license-state';
import { clearLicenseVerifyCache } from './verify-license';

// Fixture tokens from verify-license.test.ts (signed with v1-test key).
const VALID_PRO_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAxIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODAxNjc1MTgsImV4cCI6MTgxMTcwMzUxOH0.CjBrb4ksHYRH3a8I_mlAxp81P4GgqzV8ggQ-yzQ0BYBIxz1maJp-tanhp_6olr5Vep21sMZmYYCSnXeivuoVJA';
const EXPIRED_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAyIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcm8iLCJpYXQiOjE3NDU2MDc1MTgsImV4cCI6MTc3NzU3NTUxOH0.jzvr_nIahZogR8AwnEvY4OYyj43QLWTrQdm945EbAZ-ji1Hm09TwLxa7I6cPKGHAjOLXMiTm3Y-X8V9zqSY_4A';
const PREMIUM_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsInN1YiI6ImxpY190ZXN0MDAzIiwiY3VzdCI6IlRlc3QgQ29ycCIsInRpZXIiOiJwcmVtaXVtIiwiaWF0IjoxNzgwMTY3NTE4LCJleHAiOjE4MTE3MDM1MTh9.qG550P5on5B4NsC7SDRj1Lqjpb9FjiEPxHw-fS19RCHGqBlEx6dAns0ijRkWkbBvDABxAg9MQvdD82I1eJwCMQ';

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
