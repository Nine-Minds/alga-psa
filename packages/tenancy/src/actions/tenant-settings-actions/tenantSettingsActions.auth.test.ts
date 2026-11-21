import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  user: null as null | { user_id: string; user_type: string; tenant: string },
  selectedTenants: [] as string[],
  updatedTenants: [] as string[],
  initializedTenants: [] as string[],
  featureReads: [] as string[],
  timezoneReads: [] as string[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
    if (!harness.user) throw new Error('user is not logged in');
    return action(harness.user, { tenant: harness.user.tenant }, ...args);
  },
}));

vi.mock('@alga-psa/db', () => {
  const query = (tenant: string) => ({
    table: () => query(tenant),
    select: () => query(tenant),
    first: async () => {
      harness.selectedTenants.push(tenant);
      return { tenant, settings: { marker: tenant } };
    },
    insert: () => { harness.updatedTenants.push(tenant); return query(tenant); },
    update: () => { harness.updatedTenants.push(tenant); return Promise.resolve(1); },
    onConflict: () => query(tenant),
    merge: () => query(tenant),
    ignore: () => Promise.resolve(),
  });
  return {
    createTenantKnex: async (tenant = 'missing') => ({ knex: { tenant } }),
    tenantDb: (_knex: { tenant: string }, tenant: string) => query(tenant),
    ensureMiscellaneousService: vi.fn(),
  };
});

vi.mock('./tenantSettings.server', () => ({
  getExperimentalFeaturesForTenant: async (tenant: string) => {
    harness.featureReads.push(tenant);
    return { aiAssistant: false };
  },
  getTenantSettingsByTenantId: async () => null,
  getTenantTimezone: async (tenant: string) => { harness.timezoneReads.push(tenant); return 'UTC'; },
  initializeTenantSettings: async (tenant: string) => { harness.initializedTenants.push(tenant); },
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUserPermissions: async () => ['settings:update'],
}));
vi.mock('../../server/onboardingProgress', () => ({ persistTenantOnboardingProgress: vi.fn() }));
vi.mock('@alga-psa/core/server', () => ({ featureFlags: { isEnabled: async () => true } }));

import {
  getExperimentalFeatures,
  getTenantSettings,
  getTenantAnalyticsSettings,
  getTenantTimezoneAuth,
  initializeTenantSettings,
  updateTenantSettings,
} from './tenantSettingsActions';

describe('tenant settings action authentication and tenant scope', () => {
  beforeEach(() => {
    harness.user = null;
    harness.selectedTenants.length = 0;
    harness.updatedTenants.length = 0;
    harness.initializedTenants.length = 0;
    harness.featureReads.length = 0;
    harness.timezoneReads.length = 0;
  });

  it('rejects anonymous settings reads and initialization', async () => {
    await expect(getTenantSettings()).rejects.toThrow('user is not logged in');
    await expect(getTenantAnalyticsSettings()).rejects.toThrow('user is not logged in');
    await expect(getExperimentalFeatures()).rejects.toThrow('user is not logged in');
    await expect(getTenantTimezoneAuth()).rejects.toThrow('user is not logged in');
    await expect(updateTenantSettings({ preference: 'anonymous' })).rejects.toThrow('user is not logged in');
    await expect(initializeTenantSettings()).rejects.toThrow('user is not logged in');
    expect(harness.selectedTenants).toEqual([]);
    expect(harness.updatedTenants).toEqual([]);
    expect(harness.initializedTenants).toEqual([]);
  });

  it('reads and initializes only the authenticated tenant, ignoring supplied tenant IDs', async () => {
    harness.user = { user_id: 'user-a', user_type: 'internal', tenant: 'tenant-a' };
    const invokeWithTransportArguments = (action: (...args: any[]) => Promise<any>, ...args: any[]) => action(...args);

    await expect(invokeWithTransportArguments(getTenantSettings, 'tenant-b')).resolves.toMatchObject({ tenant: 'tenant-a' });
    await expect(invokeWithTransportArguments(getTenantAnalyticsSettings, 'tenant-b')).resolves.toBeNull();
    await expect(invokeWithTransportArguments(getExperimentalFeatures, 'tenant-b')).resolves.toEqual({ aiAssistant: false });
    await expect(invokeWithTransportArguments(getTenantTimezoneAuth, 'tenant-b')).resolves.toBe('UTC');
    await invokeWithTransportArguments(initializeTenantSettings, 'tenant-b');

    expect(harness.selectedTenants).toEqual(['tenant-a', 'tenant-a']);
    expect(harness.featureReads).toEqual(['tenant-a']);
    expect(harness.timezoneReads).toEqual(['tenant-a']);
    expect(harness.initializedTenants).toEqual(['tenant-a']);
  });

  it('writes settings for the session tenant even when payload resembles another tenant', async () => {
    harness.user = { user_id: 'user-a', user_type: 'internal', tenant: 'tenant-a' };

    await updateTenantSettings({ tenant: 'tenant-b', preference: 'value' });

    expect(harness.selectedTenants).toEqual(['tenant-a']);
    expect(harness.updatedTenants).toEqual(['tenant-a']);
  });
});
