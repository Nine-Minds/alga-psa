import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'user-1', tenant: 'tenant-1' } as any,
  permissions: new Set<string>(),
  row: {
    id: 1,
    license_token: null,
    trial_started_at: null,
    edition_choice: 'ee',
    appliance_credential: 'credential',
    check_in_url: 'https://license.example/check-in',
    appliance_id: 'appliance-1',
    last_checkin_at: null,
  } as any,
}));

const getCurrentUser = vi.fn(async () => state.user);
const hasPermission = vi.fn(async (_user: unknown, _resource: string, level: string) => state.permissions.has(level));
const getLicenseStateRow = vi.fn(async () => state.row);
const upsertLicenseState = vi.fn(async () => undefined);
const resolveSelfHostTier = vi.fn(() => ({ state: 'trial_available', tier: 'essentials', expiresAt: null, daysRemaining: null }));
const verifyLicense = vi.fn(() => ({ valid: true, claims: { exp: Math.floor(Date.now() / 1000) + 3600, tier: 'pro', cust: 'Customer', sub: 'subscription-1' } }));

vi.mock('@alga-psa/auth', () => ({ getCurrentUser, localizeActionError: (error: unknown) => error }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionPermissionError: (value: any) => value?.type === 'permission_error',
  permissionError: (message: string, key: string) => ({ type: 'permission_error', message, permissionError: key }),
}));
vi.mock('node:crypto', () => ({ default: { createHash: () => ({ update: () => ({ digest: () => '12345678' }) }) } }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow,
  upsertLicenseState,
  resolveSelfHostTier,
  isLicenseVerifyFailure: (value: any) => value?.valid === false,
  verifyLicense,
}));

const licenseRow = () => ({ ...state.row });

describe('license management action authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'user-1', tenant: 'tenant-1' };
    state.permissions = new Set(['read']);
    state.row = licenseRow();
    getCurrentUser.mockClear();
    hasPermission.mockClear();
    getLicenseStateRow.mockClear();
    upsertLicenseState.mockClear();
    resolveSelfHostTier.mockClear();
    verifyLicense.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => String(input).endsWith('/register')
        ? { appliance_credential: 'new-credential', first_jwt: 'new-jwt', check_in_url: 'https://license.example/check-in' }
        : { status: 'no_change' },
    })));
    process.env.ALGA_LICENSE_SERVICE_URL = 'https://license.example';
  });

  it('lets a read-only account manager retrieve appliance license status', async () => {
    const { getLicenseStatus } = await import('@/lib/actions/licenseManagementActions');

    await expect(getLicenseStatus()).resolves.toMatchObject({ selfHostMode: true, state: 'trial_available' });
    expect(hasPermission).toHaveBeenCalledWith(state.user, 'account_management', 'read');
    expect(getLicenseStateRow).toHaveBeenCalledOnce();
  });

  it('denies every appliance mutation to a read-only account manager before DB or network effects', async () => {
    const actions = await import('@/lib/actions/licenseManagementActions');
    const mutations = [
      () => actions.submitLicense('signed-license'),
      () => actions.startTrial(),
      () => actions.refreshLicenseNow(),
      () => actions.connectAppliance('claim-code'),
    ];

    for (const invoke of mutations) {
      getLicenseStateRow.mockClear();
      upsertLicenseState.mockClear();
      vi.mocked(fetch).mockClear();
      const result = await invoke();
      expect(result).toMatchObject({ success: false, error: 'msp/licensing:errors.accountManagementUpdate' });
      expect(hasPermission).toHaveBeenLastCalledWith(state.user, 'account_management', 'update');
      expect(getLicenseStateRow).not.toHaveBeenCalled();
      expect(upsertLicenseState).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('allows an account manager with update permission to reach each mutation', async () => {
    state.permissions.add('update');
    const actions = await import('@/lib/actions/licenseManagementActions');

    expect(await actions.submitLicense('signed-license')).toMatchObject({ success: true });
    expect(upsertLicenseState).toHaveBeenCalledWith({ license_token: 'signed-license' });

    upsertLicenseState.mockClear();
    expect(await actions.startTrial()).toMatchObject({ success: true });
    expect(upsertLicenseState).toHaveBeenCalledWith(expect.objectContaining({ edition_choice: 'ee' }));

    upsertLicenseState.mockClear();
    expect(await actions.refreshLicenseNow()).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledWith(state.row.check_in_url, expect.objectContaining({ method: 'POST' }));
    expect(upsertLicenseState).toHaveBeenCalled();

    upsertLicenseState.mockClear();
    expect(await actions.connectAppliance('claim-code')).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledWith('https://license.example/register', expect.objectContaining({ method: 'POST' }));
    expect(upsertLicenseState).toHaveBeenCalledWith(expect.objectContaining({ appliance_credential: 'new-credential' }));
  });

  it('preserves unauthenticated denial before any state read', async () => {
    state.user = null;
    const actions = await import('@/lib/actions/licenseManagementActions');

    expect(await actions.getLicenseStatus()).toMatchObject({ type: 'permission_error' });
    expect(await actions.startTrial()).toMatchObject({ success: false, error: 'msp/licensing:errors.notSignedIn' });
    expect(getLicenseStateRow).not.toHaveBeenCalled();
    expect(upsertLicenseState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
