import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  installation: null as any, own: vi.fn(), resolveSelfHost: vi.fn(), plan: 'pro' as string | undefined, admin: vi.fn(),
}));
vi.mock('./license-state', () => ({ getLicenseStateRow: async () => state.installation, resolveSelfHostTier: state.resolveSelfHost }));
vi.mock('./tenant-license-state', () => ({ getTenantOwnLicenseInput: state.own }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => { state.admin(); return {}; } }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => ({ select: () => ({ first: async () => ({ plan: state.plan }) }) }) }) }));

import { getEffectiveSelfHostLicenseInput, resolveTenantTier } from './tenant-tier';

beforeEach(() => {
  state.installation = null; state.plan = 'pro';
  state.own.mockReset(); state.resolveSelfHost.mockReset().mockReturnValue(null); state.admin.mockReset();
});

describe('resolveTenantTier — tier resolution on errors is unchanged', () => {
  it('hosted tenants (no installation row) issue no claim lookup at all', async () => {
    expect(await resolveTenantTier('t')).toBe('pro');
    expect(state.own).not.toHaveBeenCalled();
  });

  it('a failing claim lookup is "no claim": the installation result decides, never a catch-all essentials', async () => {
    state.installation = { id: 1 };
    state.own.mockRejectedValue(new Error('relation "tenant_license_state" does not exist'));
    state.resolveSelfHost.mockReturnValue({ tier: 'pro', state: 'licensed' });
    expect(await resolveTenantTier('t')).toBe('pro');
    expect(state.resolveSelfHost).toHaveBeenCalledWith(state.installation, 't');
  });

  it('a failing claim lookup on a hosted-plan fallthrough still resolves from the plan', async () => {
    state.installation = { id: 1 };
    state.own.mockRejectedValue(new Error('boom'));
    state.plan = 'essentials';
    expect(await resolveTenantTier('t')).toBe('essentials');
  });

  it("a tenant's own claim outranks the installation input", async () => {
    state.installation = { id: 1 };
    const own = { license_scope: 'tenant' };
    state.own.mockResolvedValue(own);
    state.resolveSelfHost.mockReturnValue({ tier: 'pro', state: 'licensed' });
    await resolveTenantTier('t');
    expect(state.resolveSelfHost).toHaveBeenCalledWith(own, 't');
  });

  it('an unreadable installation row falls through to plan resolution exactly as on main', async () => {
    state.installation = { id: 1 };
    state.resolveSelfHost.mockImplementation(() => { throw new Error('boom'); });
    state.plan = 'pro';
    expect(await resolveTenantTier('t')).toBe('pro');
  });
});

describe('getEffectiveSelfHostLicenseInput — one governing record for tier and seats', () => {
  it('is null on a hosted install and issues no claim lookup', async () => {
    expect(await getEffectiveSelfHostLicenseInput('t')).toBeNull();
    expect(state.own).not.toHaveBeenCalled();
  });

  it("prefers the tenant's own claim, else the installation row", async () => {
    state.installation = { id: 1 };
    state.own.mockResolvedValue(null);
    expect(await getEffectiveSelfHostLicenseInput('t')).toBe(state.installation);
    const own = { license_scope: 'tenant' };
    state.own.mockResolvedValue(own);
    expect(await getEffectiveSelfHostLicenseInput('t')).toBe(own);
  });

  it('a failing claim lookup is "no claim", never an error', async () => {
    state.installation = { id: 1 };
    state.own.mockRejectedValue(new Error('relation "tenant_license_state" does not exist'));
    expect(await getEffectiveSelfHostLicenseInput('t')).toBe(state.installation);
  });
});
