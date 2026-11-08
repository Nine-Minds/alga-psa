// T004 (F070, F071): service-principal limit resolution.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLicenseStateRow: vi.fn(),
  verifyLicense: vi.fn(),
  tenantRow: { value: undefined as { service_principal_limit: number | null } | undefined },
}));

vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: mocks.getLicenseStateRow,
  verifyLicense: mocks.verifyLicense,
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ first: async () => mocks.tenantRow.value }) }),
}));

import {
  SERVICE_PRINCIPAL_ENTITLEMENT,
  readVerifiedLicenseLimit,
  resolveServicePrincipalLimit,
} from '../../lib/service-principals/entitlements';

const tokenWith = (payload: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

const knex = {} as never;

describe('service principal limit resolution (T004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantRow.value = undefined;
    mocks.verifyLicense.mockReturnValue({ valid: true });
  });

  it('exposes the flat Pro limit and the 120/60 rate limit', () => {
    expect(SERVICE_PRINCIPAL_ENTITLEMENT.maxPrincipals).toBe(10);
    expect(SERVICE_PRINCIPAL_ENTITLEMENT.rateLimit).toEqual({ maxTokens: 120, refillPerMin: 60 });
  });

  describe('hosted (no license_state row)', () => {
    beforeEach(() => {
      mocks.getLicenseStateRow.mockResolvedValue(null);
    });

    it('uses the tenant override when set', async () => {
      mocks.tenantRow.value = { service_principal_limit: 25 };
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(25);
    });

    it('falls back to 10 without an override', async () => {
      mocks.tenantRow.value = { service_principal_limit: null };
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(10);
    });

    it('treats an unreadable license_state as hosted', async () => {
      mocks.getLicenseStateRow.mockImplementation(async () => {
        throw new Error('relation "license_state" does not exist');
      });
      mocks.tenantRow.value = { service_principal_limit: 4 };
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(4);
    });
  });

  describe('appliance (license_state row present)', () => {
    it('uses the verified service_principals claim and ignores tenants.service_principal_limit', async () => {
      mocks.tenantRow.value = { service_principal_limit: 999 };
      mocks.getLicenseStateRow.mockResolvedValue({ license_token: tokenWith({ service_principals: 3 }) });
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(3);
    });

    it('falls back to 10 when the claim is missing, ignoring the tenant override', async () => {
      mocks.tenantRow.value = { service_principal_limit: 999 };
      mocks.getLicenseStateRow.mockResolvedValue({ license_token: tokenWith({ seats: 5 }) });
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(10);
    });

    it('falls back to 10 when the token does not verify, even with a large claim', async () => {
      mocks.verifyLicense.mockReturnValue({ valid: false });
      mocks.tenantRow.value = { service_principal_limit: 999 };
      mocks.getLicenseStateRow.mockResolvedValue({ license_token: tokenWith({ service_principals: 500 }) });
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(10);
    });

    it('falls back to 10 when there is no token or it is malformed', async () => {
      mocks.getLicenseStateRow.mockResolvedValue({ license_token: null });
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(10);
      mocks.getLicenseStateRow.mockResolvedValue({ license_token: 'not-a-token' });
      await expect(resolveServicePrincipalLimit(knex, 't1')).resolves.toBe(10);
    });

    it('rejects non-integer and negative claims', () => {
      expect(readVerifiedLicenseLimit(tokenWith({ service_principals: 2.5 }))).toBeNull();
      expect(readVerifiedLicenseLimit(tokenWith({ service_principals: -1 }))).toBeNull();
      expect(readVerifiedLicenseLimit(tokenWith({ service_principals: '7' }))).toBeNull();
      expect(readVerifiedLicenseLimit(tokenWith({ service_principals: 0 }))).toBe(0);
    });
  });
});
