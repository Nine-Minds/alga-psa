import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  installationRow: null as any,
  effective: vi.fn(),
  resolve: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => () => ({ orderBy: () => ({ first: async () => state.installationRow }) }),
}));
vi.mock('@alga-psa/licensing', () => ({
  getEffectiveSelfHostLicenseInput: state.effective,
  resolveSelfHostTier: state.resolve,
  verifyLicense: state.verify,
}));

import { checkApplianceLicenseSeatLimit } from '@ee/lib/license/userSeatGuard';

beforeEach(() => {
  state.installationRow = null;
  state.effective.mockReset();
  state.resolve.mockReset().mockReturnValue({ tier: 'pro', state: 'licensed' });
  state.verify.mockReset().mockReturnValue({ valid: true, claims: { seats: 5 } });
});

describe('checkApplianceLicenseSeatLimit — meters against the record tier resolution uses', () => {
  it('without a tenant, reads the installation row exactly as before (unbound check)', async () => {
    state.installationRow = { license_token: 'install' };
    expect(await checkApplianceLicenseSeatLimit(5)).toEqual({ seats: 5 });
    expect(state.effective).not.toHaveBeenCalled();
    expect(state.resolve).toHaveBeenCalledWith(state.installationRow, undefined);
  });

  it('with a tenant and no own claim, meters the installation licence unbound, as on main', async () => {
    const installation = { license_token: 'install' };
    state.effective.mockResolvedValue(installation);
    expect(await checkApplianceLicenseSeatLimit(4, 'tenant-a')).toBeNull();
    expect(state.resolve).toHaveBeenCalledWith(installation, undefined);
    expect(state.verify).toHaveBeenCalledWith('install');
  });

  it("with a tenant's own staged claim, meters that claim's seats bound to the tenant", async () => {
    const own = { license_token: 'own', license_scope: 'tenant' };
    state.effective.mockResolvedValue(own);
    state.verify.mockReturnValue({ valid: true, claims: { seats: 2 } });
    expect(await checkApplianceLicenseSeatLimit(2, 'tenant-a')).toEqual({ seats: 2 });
    expect(state.resolve).toHaveBeenCalledWith(own, 'tenant-a');
    expect(state.verify).toHaveBeenCalledWith('own');
  });

  it('a hosted install (no governing record) and any read error never block user creation', async () => {
    state.effective.mockResolvedValue(null);
    expect(await checkApplianceLicenseSeatLimit(99, 'tenant-a')).toBeNull();
    state.effective.mockRejectedValue(new Error('license_state unavailable'));
    expect(await checkApplianceLicenseSeatLimit(99, 'tenant-a')).toBeNull();
  });
});
