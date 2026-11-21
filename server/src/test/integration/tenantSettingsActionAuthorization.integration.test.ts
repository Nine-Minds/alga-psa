import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const authMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  user: null as null | { user_id: string; user_type: string; tenant: string },
  contextTenant: null as null | string,
  database: null as null | Knex,
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: authMocks.hasPermission,
  withAuth: (action: (...args: any[]) => unknown) => (...args: unknown[]) => {
    if (!authMocks.user || !authMocks.contextTenant) throw new Error('user is not logged in');
    return action(authMocks.user, { tenant: authMocks.contextTenant }, ...args);
  },
  withOptionalAuth: (action: (...args: any[]) => unknown) => (...args: unknown[]) =>
    action(authMocks.user, authMocks.contextTenant ? { tenant: authMocks.contextTenant } : null, ...args),
}));

vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    getConnection: async () => {
      if (!authMocks.database) throw new Error('test database is not initialized');
      return authMocks.database;
    },
    createTenantKnex: async () => {
      if (!authMocks.database) throw new Error('test database is not initialized');
      return { knex: authMocks.database };
    },
  };
});

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const DATABASE_NAME = 'tenant_settings_action_authz_test';
let db: Knex;
const tenantsToCleanup = new Set<string>();
let updateTenantBrandingAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantBrandingActions').updateTenantBrandingAction;
let updateTenantThemeAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantThemeActions').updateTenantThemeAction;
let updateTenantDefaultLocaleAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantLocaleActions').updateTenantDefaultLocaleAction;
let updateTenantClientPortalLocaleAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantClientPortalLocaleActions').updateTenantClientPortalLocaleAction;
let setTenantTimezone: typeof import('../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions').setTenantTimezone;
let getTenantLocaleSettingsAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantLocaleActions').getTenantLocaleSettingsAction;
let getTenantClientPortalLocaleAction: typeof import('../../../../packages/tenancy/src/actions/tenant-actions/tenantClientPortalLocaleActions').getTenantClientPortalLocaleAction;

function tenantTable(tenant: string) {
  return tenantDb(db, tenant).table('tenant_settings');
}

function tenantRows() {
  return tenantDb(db, '__tenant_settings_action_authz_fixture__')
    .unscoped('tenants', 'isolated action authorization integration fixture');
}

async function createTenant(settings: Record<string, unknown>): Promise<string> {
  const tenant = randomUUID();
  tenantsToCleanup.add(tenant);
  await tenantRows().insert({
    tenant,
    client_name: `Settings authz ${tenant.slice(0, 8)}`,
    email: `settings-authz-${tenant}@example.test`,
  });
  await tenantTable(tenant).insert({ tenant, settings });
  return tenant;
}

async function readSettings(tenant: string): Promise<Record<string, unknown>> {
  const row = await tenantTable(tenant).select('settings').first();
  return row?.settings ?? {};
}

function asCaller(userTenant: string, actionTenant = userTenant): void {
  authMocks.user = { user_id: randomUUID(), user_type: 'internal', tenant: userTenant };
  authMocks.contextTenant = actionTenant;
}

const update = {
  branding: { clientName: 'Updated tenant' },
  theme: { pairId: 'alga' },
  defaultLocale: 'fr',
  clientPortal: { defaultLocale: 'fr' },
  timezone: 'America/New_York',
};

describe('updateTenantSettings action authorization with PostgreSQL', () => {
  let updateTenantSettings: typeof import('../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions').updateTenantSettings;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({
      databaseName: DATABASE_NAME,
      runSeeds: false,
      recreate: false,
    });
    authMocks.database = db;
    const [branding, theme, locale, portalLocale, settings] = await Promise.all([
      import('../../../../packages/tenancy/src/actions/tenant-actions/tenantBrandingActions'),
      import('../../../../packages/tenancy/src/actions/tenant-actions/tenantThemeActions'),
      import('../../../../packages/tenancy/src/actions/tenant-actions/tenantLocaleActions'),
      import('../../../../packages/tenancy/src/actions/tenant-actions/tenantClientPortalLocaleActions'),
      import('../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions'),
    ]);
    updateTenantBrandingAction = branding.updateTenantBrandingAction;
    updateTenantThemeAction = theme.updateTenantThemeAction;
    updateTenantDefaultLocaleAction = locale.updateTenantDefaultLocaleAction;
    updateTenantClientPortalLocaleAction = portalLocale.updateTenantClientPortalLocaleAction;
    setTenantTimezone = settings.setTenantTimezone;
    getTenantLocaleSettingsAction = locale.getTenantLocaleSettingsAction;
    getTenantClientPortalLocaleAction = portalLocale.getTenantClientPortalLocaleAction;
    updateTenantSettings = settings.updateTenantSettings;
  }, 600_000);

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await tenantTable(tenant).delete().catch(() => undefined);
      await tenantRows().where({ tenant }).delete().catch(() => undefined);
      tenantsToCleanup.delete(tenant);
    }
    authMocks.hasPermission.mockReset();
    authMocks.hasPermission.mockResolvedValue(false);
  });

  afterAll(async () => {
    authMocks.database = null;
    await db?.destroy();
  });

  it('persists authorized settings in JSONB and preserves existing values', async () => {
    const tenant = await createTenant({ existingSetting: 'preserved' });
    asCaller(tenant);
    authMocks.hasPermission.mockResolvedValue(true);

    await updateTenantSettings(update);

    expect(await readSettings(tenant)).toEqual({ existingSetting: 'preserved', ...update });
    expect(authMocks.hasPermission).toHaveBeenCalledWith(
      authMocks.user,
      'settings',
      'update',
      expect.anything(),
    );
  });

  it('persists authorized saves from all five mutators and reads locale values back from PostgreSQL', async () => {
    const tenant = await createTenant({ existingSetting: 'preserved' });
    asCaller(tenant);
    authMocks.hasPermission.mockResolvedValue(true);

    await updateTenantBrandingAction({
      logoUrl: '/test-logo.png',
      primaryColor: '#112233',
      secondaryColor: '#445566',
      clientName: 'Persisted tenant',
    });
    await updateTenantThemeAction({ pairId: 'alga' } as any);
    await updateTenantDefaultLocaleAction('fr', ['en', 'fr']);
    await updateTenantClientPortalLocaleAction('fr');
    await expect(setTenantTimezone('America/New_York')).resolves.toBeUndefined();

    expect(await readSettings(tenant)).toMatchObject({
      existingSetting: 'preserved',
      branding: { clientName: 'Persisted tenant' },
      theme: { pairId: 'alga' },
      defaultLocale: 'fr',
      enabledLocales: ['en', 'fr'],
      clientPortal: { defaultLocale: 'fr' },
      timezone: 'America/New_York',
    });
    expect(await getTenantLocaleSettingsAction()).toMatchObject({
      defaultLocale: 'fr',
      enabledLocales: ['en', 'fr'],
    });
    expect(await getTenantClientPortalLocaleAction()).toEqual({ defaultLocale: 'fr' });
  });

  it('denies a technician without settings:update and leaves the persisted JSONB unchanged', async () => {
    const tenant = await createTenant({ branding: { clientName: 'Original' }, timezone: 'Etc/UTC' });
    const before = await readSettings(tenant);
    asCaller(tenant);
    authMocks.hasPermission.mockResolvedValue(false);

    await expect(updateTenantSettings(update)).rejects.toThrow('Permission denied: Cannot update settings');

    expect(await readSettings(tenant)).toEqual(before);
  });

  it('fails closed on permission lookup failure and leaves persisted settings unchanged', async () => {
    const tenant = await createTenant({ clientPortal: { defaultLocale: 'en' } });
    const before = await readSettings(tenant);
    asCaller(tenant);
    authMocks.hasPermission.mockRejectedValue(new Error('permission database unavailable'));

    await expect(updateTenantSettings(update)).rejects.toThrow('Permission denied: Cannot update settings');

    expect(await readSettings(tenant)).toEqual(before);
  });

  it('denies a mismatched authenticated tenant and leaves both tenants unchanged', async () => {
    const actionTenant = await createTenant({ branding: { clientName: 'Action tenant' } });
    const callerTenant = await createTenant({ branding: { clientName: 'Caller tenant' } });
    const actionBefore = await readSettings(actionTenant);
    const callerBefore = await readSettings(callerTenant);
    asCaller(callerTenant, actionTenant);
    authMocks.hasPermission.mockResolvedValue(true);

    await expect(updateTenantSettings(update)).rejects.toThrow('Permission denied: Cannot update settings');

    expect(authMocks.hasPermission).not.toHaveBeenCalled();
    expect(await readSettings(actionTenant)).toEqual(actionBefore);
    expect(await readSettings(callerTenant)).toEqual(callerBefore);
  });

  it('writes only within the authenticated action tenant', async () => {
    const actionTenant = await createTenant({ branding: { clientName: 'Action tenant' } });
    const otherTenant = await createTenant({ branding: { clientName: 'Other tenant' } });
    const otherBefore = await readSettings(otherTenant);
    asCaller(actionTenant);
    authMocks.hasPermission.mockResolvedValue(true);

    await updateTenantSettings({ ...update, tenant: otherTenant });

    expect(await readSettings(actionTenant)).toEqual({ branding: { clientName: 'Action tenant' }, ...update, tenant: otherTenant });
    expect(await readSettings(otherTenant)).toEqual(otherBefore);
  });
});
