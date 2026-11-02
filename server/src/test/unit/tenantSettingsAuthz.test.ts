import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getConnection: vi.fn(),
  createTenantKnex: vi.fn(),
  first: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  merge: vi.fn(),
  revalidateTag: vi.fn(),
  user: null as null | Record<string, unknown>,
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: mocks.hasPermission,
  withAuth: (action: (...args: any[]) => unknown) => (...args: unknown[]) => {
    if (!mocks.user) throw new Error('user is not logged in');
    return action(mocks.user, { tenant: 'tenant-authenticated' }, ...args);
  },
  withOptionalAuth: (action: (...args: any[]) => unknown) => (...args: unknown[]) =>
    action(mocks.user, mocks.user ? { tenant: 'tenant-authenticated' } : null, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: mocks.getConnection,
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: () => ({ first: mocks.first, select: mocks.select, update: mocks.update, insert: mocks.insert }),
  }),
  ensureMiscellaneousService: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/core/server', () => ({ featureFlags: { isEnabled: vi.fn() } }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getCurrentUserPermissions: vi.fn() }));

const branding = {
  logoUrl: '/logo.png', primaryColor: '#112233', secondaryColor: '#445566', clientName: 'Tenant',
};
const theme = { pairId: 'alga' };

async function loadActions() {
  vi.resetModules();
  const [brandingActions, themeActions, localeActions, portalLocaleActions, settingsActions] = await Promise.all([
    import('../../../../packages/tenancy/src/actions/tenant-actions/tenantBrandingActions'),
    import('../../../../packages/tenancy/src/actions/tenant-actions/tenantThemeActions'),
    import('../../../../packages/tenancy/src/actions/tenant-actions/tenantLocaleActions'),
    import('../../../../packages/tenancy/src/actions/tenant-actions/tenantClientPortalLocaleActions'),
    import('../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'),
  ]);
  return [
    ['branding', () => brandingActions.updateTenantBrandingAction(branding)],
    ['theme', () => themeActions.updateTenantThemeAction(theme as any)],
    ['default locale', () => localeActions.updateTenantDefaultLocaleAction('en' as any)],
    ['client portal locale', () => portalLocaleActions.updateTenantClientPortalLocaleAction('en' as any)],
    ['timezone', () => settingsActions.setTenantTimezone('America/New_York')],
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { user_id: 'technician-1', user_type: 'internal', tenant: 'tenant-authenticated' };
  mocks.hasPermission.mockResolvedValue(false);
  mocks.getConnection.mockResolvedValue({ fn: { now: () => new Date() } });
  mocks.first.mockResolvedValue({ settings: {} });
  mocks.select.mockReturnValue({ first: mocks.first });
  mocks.update.mockResolvedValue(1);
  mocks.insert.mockImplementation(() => ({ onConflict: () => ({ merge: mocks.merge }) }));
  mocks.merge.mockResolvedValue(undefined);
  mocks.createTenantKnex.mockImplementation(async () => ({ knex: () => ({}) }));
});

describe('tenant settings authorization at action boundaries', () => {
  it.each(['branding', 'theme', 'default locale', 'client portal locale', 'timezone'])(
    'denies an internal technician without settings:update before protected reads or writes (%s)', async (name) => {
      const actions = await loadActions();
      const invoke = actions.find(([actionName]) => actionName === name)![1];

      if (name === 'timezone') {
        await expect(invoke()).resolves.toMatchObject({ permissionError: 'Permission denied: Cannot update settings' });
      } else {
        await expect(invoke()).rejects.toThrow('Permission denied: Cannot update settings');
      }
      expect(mocks.hasPermission).toHaveBeenCalledWith(mocks.user, 'settings', 'update', expect.anything());
      expect(mocks.getConnection).toHaveBeenCalledWith('tenant-authenticated');
      expect(mocks.first).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    },
  );

  it.each(['branding', 'theme', 'default locale', 'client portal locale', 'timezone'])(
    'allows an authorized settings administrator to perform the valid update (%s)', async (name) => {
      mocks.hasPermission.mockResolvedValue(true);
      const actions = await loadActions();
      const invoke = actions.find(([actionName]) => actionName === name)![1];

      await expect(invoke()).resolves.not.toThrow();

      expect(mocks.hasPermission).toHaveBeenCalledWith(mocks.user, 'settings', 'update', expect.anything());
      expect(mocks.update.mock.calls.length + mocks.insert.mock.calls.length).toBeGreaterThan(0);
    },
  );

  it('fails closed when authorization throws and when authentication is absent', async () => {
    mocks.hasPermission.mockRejectedValue(new Error('permission store unavailable'));
    const actions = await loadActions();
    const brandingAction = actions.find(([name]) => name === 'branding')![1];
    await expect(brandingAction()).rejects.toThrow('Permission denied: Cannot update settings');
    expect(mocks.first).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.user = null;
    const unauthenticatedActions = await loadActions();
    for (const [, invoke] of unauthenticatedActions) {
      await expect((async () => { await invoke(); })()).rejects.toThrow('user is not logged in');
    }
    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated user tenant differs from the action context', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.user = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-other' };
    const actions = await loadActions();

    await expect(actions[0][1]()).rejects.toThrow('Permission denied: Cannot update settings');
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.first).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps external-user restrictions even when the permission lookup says yes', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.user = { user_id: 'client-1', user_type: 'client', tenant: 'tenant-authenticated' };
    const actions = await loadActions();
    for (const [name, invoke] of actions.filter(([actionName]) => actionName !== 'timezone')) {
      await expect(invoke()).rejects.toThrow();
      expect(mocks.first, `${name} read settings`).not.toHaveBeenCalled();
      expect(mocks.update, `${name} updated settings`).not.toHaveBeenCalled();
      expect(mocks.insert, `${name} inserted settings`).not.toHaveBeenCalled();
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
