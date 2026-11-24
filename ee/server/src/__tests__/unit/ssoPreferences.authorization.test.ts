import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'internal-1', user_type: 'internal' },
  permission: true,
  roleExists: true,
  merge: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: 'tenant-a' }, ...args),
  hasPermission: async () => state.permission,
}));
vi.mock('@alga-psa/tenancy/actions', () => ({
  getTenantSettings: async () => ({ settings: { unrelated: 'kept', sso: { autoLinkInternal: false } } }),
}));
vi.mock('@alga-psa/tenancy/server/tenantSettingsStore', () => ({ mergeTenantSettingsJson: state.merge }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({
    knex: (table: string) => ({
      where: () => ({
        andWhereRaw: () => ({ first: async () => (table === 'roles' && state.roleExists ? { role_id: 'role-1' } : null) }),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/types', () => ({ TIER_FEATURES: { SSO: 'sso' }, isLicensedUserType: (type: string) => type === 'internal' }));
vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({ listOAuthAccountLinksForUser: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: {} }));
vi.mock('server/src/app/api/auth/[...nextauth]/auth', () => ({ auth: vi.fn() }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn() }));

import { updateSsoPreferencesAction } from '../../lib/actions/auth/ssoPreferences';

describe('SSO preference mutation boundary', () => {
  beforeEach(() => {
    state.user = { user_id: 'internal-1', user_type: 'internal' };
    state.permission = true;
    state.roleExists = true;
    state.merge.mockReset();
  });

  it('denies portal users before settings persistence', async () => {
    state.user = { user_id: 'portal-1', user_type: 'client' };
    await expect(updateSsoPreferencesAction({ autoLinkClient: true })).rejects.toThrow(/permission/i);
    expect(state.merge).not.toHaveBeenCalled();
  });

  it('rejects invalid values and unavailable client portal roles', async () => {
    await expect(updateSsoPreferencesAction({ autoLinkClient: 'yes' as any })).rejects.toThrow('Invalid SSO preference');
    state.roleExists = false;
    await expect(updateSsoPreferencesAction({ clientPortalDefaultRoleName: 'Internal Admin' })).rejects.toThrow('existing client portal role');
    expect(state.merge).not.toHaveBeenCalled();
  });

  it('persists only validated SSO settings for the authenticated tenant and preserves other settings', async () => {
    await updateSsoPreferencesAction({ autoLinkClient: true, clientPortalDefaultRoleName: 'Portal User' });
    expect(state.merge).toHaveBeenCalledWith('tenant-a', {
      sso: expect.objectContaining({ autoLinkInternal: false, autoLinkClient: true, clientPortalDefaultRoleName: 'Portal User' }),
    });
  });
});
