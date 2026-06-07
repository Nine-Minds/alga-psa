import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-tenant binding can't use the signed fixture tokens (they predate the `aud`
// claim and we have no signer here), so this file mocks verifyLicense to return
// constructed claims. It lives apart from license-state.test.ts, which exercises
// the real verifyLicense against signed fixtures — mocking there would defeat it.
const { verifyLicenseMock } = vi.hoisted(() => ({ verifyLicenseMock: vi.fn() }));
vi.mock('./verify-license', () => ({
  verifyLicense: verifyLicenseMock,
  clearLicenseVerifyCache: vi.fn(),
}));

import { resolveSelfHostTier, type LicenseStateRow } from './license-state';

// Far-future expiry so the licensed branch is always reached.
const FUTURE_EXP = Math.floor(Date.UTC(2099, 0, 1) / 1000);

function makeRow(overrides: Partial<LicenseStateRow> = {}): LicenseStateRow {
  return {
    id: 1,
    edition_choice: 'ee',
    trial_started_at: null,
    license_token: 'header.payload.sig', // presence drives the verifyLicense path
    updated_at: new Date(),
    appliance_id: null,
    check_in_url: null,
    appliance_credential: null,
    last_checkin_at: null,
    ...overrides,
  };
}

function validResult(aud?: string) {
  return {
    valid: true,
    claims: {
      iss: 'nineminds-license',
      sub: 'lic_test',
      cust: 'Acme Corp',
      tier: 'premium',
      iat: 0,
      exp: FUTURE_EXP,
      ...(aud ? { aud } : {}),
    },
  };
}

describe('resolveSelfHostTier — per-tenant binding', () => {
  beforeEach(() => verifyLicenseMock.mockReset());

  it('honors a tenant-bound license on its own tenant', () => {
    verifyLicenseMock.mockReturnValue(validResult('tenant-A'));
    const result = resolveSelfHostTier(makeRow(), 'tenant-A');
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('premium');
  });

  it('downgrades a tenant-bound license used on a different tenant', () => {
    verifyLicenseMock.mockReturnValue(validResult('tenant-A'));
    const result = resolveSelfHostTier(makeRow(), 'tenant-B');
    expect(result?.state).toBe('license_wrong_tenant');
    expect(result?.tier).toBe('essentials');
  });

  it('accepts an unbound (no aud) license on any tenant', () => {
    verifyLicenseMock.mockReturnValue(validResult(undefined));
    const result = resolveSelfHostTier(makeRow(), 'tenant-B');
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('premium');
  });

  it('does not block a bound license when no tenant is supplied to check against', () => {
    verifyLicenseMock.mockReturnValue(validResult('tenant-A'));
    const result = resolveSelfHostTier(makeRow());
    expect(result?.state).toBe('licensed');
  });
});
