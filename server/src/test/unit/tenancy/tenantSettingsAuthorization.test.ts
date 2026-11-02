import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'internal-1', user_type: 'internal', roles: [] as any[] },
  tenant: 'tenant-a',
  permissions: new Set<string>(),
  row: {
    tenant: 'tenant-a', onboarding_completed: false, onboarding_skipped: false,
    onboarding_data: { clientEmail: 'secret@example.test' },
    settings: { timezone: 'UTC', secret: 'stored-secret' },
    created_at: new Date(0), updated_at: new Date(0),
  } as any,
  calls: [] as any[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: state.tenant }, ...args),
  hasPermission: async (_user: unknown, resource: string, action: string) => state.permissions.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', () => ({
  ensureMiscellaneousService: vi.fn(),
  createTenantKnex: async (tenant?: string) => ({ knex: {}, tenant: tenant ?? state.tenant }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => {
      state.calls.push({ operation: 'table', name, tenant });
      return {
        select: (columns: any) => {
          state.calls.push({ operation: 'select', columns, tenant });
          return { first: async () => state.row };
        },
        insert: (values: any) => {
          state.calls.push({ operation: 'insert', values, tenant });
          return { onConflict: () => ({ merge: async (merged: any) => state.calls.push({ operation: 'merge', values: merged, tenant }) }) };
        },
        first: async () => state.row,
        update: async (values: any) => state.calls.push({ operation: 'update', values, tenant }),
      };
    },
  }),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getCurrentUserPermissions: async () => ['settings:update'] }));
vi.mock('@alga-psa/core/server', () => ({ featureFlags: { isEnabled: async () => true } }));

import { getTenantSettings, getTenantTimezoneAuth, setTenantTimezone, updateTenantOnboardingStatus } from '../../../../../packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions';

describe('tenant settings action authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'internal-1', user_type: 'internal', roles: [] };
    state.tenant = 'tenant-a';
    state.permissions = new Set();
    state.calls = [];
  });

  it('denies a portal user before reading onboarding data or the full settings row', async () => {
    state.user = { user_id: 'portal-1', user_type: 'client', roles: [] };
    state.permissions.add('settings:read');
    await expect(getTenantSettings()).rejects.toThrow('Internal user required');
    expect(state.calls).toEqual([]);
  });

  it('denies an internal user without settings read or workspace setup authority', async () => {
    await expect(getTenantSettings()).rejects.toThrow('Cannot read tenant settings');
    expect(state.calls).toEqual([]);
  });

  it('denies portal and unauthorized internal callers the typed timezone reader before persistence', async () => {
    state.user = { user_id: 'portal-1', user_type: 'client', roles: [] };
    state.permissions.add('settings:update');
    await expect(getTenantTimezoneAuth()).rejects.toThrow('Cannot read tenant timezone');
    expect(state.calls).toEqual([]);

    state.user = { user_id: 'internal-1', user_type: 'internal', roles: [] };
    state.permissions.clear();
    await expect(getTenantTimezoneAuth()).rejects.toThrow('Cannot read tenant timezone');
    expect(state.calls).toEqual([]);
  });

  it('preserves the authorized workspace setup read, including its onboarding data', async () => {
    state.permissions.add('settings:read');
    await expect(getTenantSettings()).resolves.toEqual(state.row);
    expect(state.calls).toContainEqual({ operation: 'select', columns: '*', tenant: 'tenant-a' });
  });

  it('rejects unauthorized and malformed onboarding mutations before persistence', async () => {
    await expect(updateTenantOnboardingStatus(false, { clientEmail: 'private@example.test', arbitrarySettings: { sso: 'attacker' } } as any))
      .rejects.toThrow('Workspace setup access required');
    expect(state.calls).toEqual([]);

    state.permissions.add('settings:update');
    await expect(updateTenantOnboardingStatus(false, { arbitrarySettings: { sso: 'attacker' } } as any))
      .rejects.toThrow('Invalid tenant onboarding update');
    expect(state.calls).toEqual([]);
  });

  it('rejects portal and unauthorized mutations, validates timezone, and scopes authorized writes to auth tenant', async () => {
    state.user = { user_id: 'portal-1', user_type: 'client', roles: [] };
    await expect(setTenantTimezone('America/New_York')).resolves.toHaveProperty('permissionError');
    expect(state.calls).toEqual([]);

    state.user = { user_id: 'internal-1', user_type: 'internal', roles: [] };
    state.permissions.add('settings:update');
    await expect(setTenantTimezone('EST')).resolves.toHaveProperty('actionError');
    expect(state.calls).toEqual([]);
    await expect(setTenantTimezone('America/New_York')).resolves.toBeUndefined();
    expect(state.calls.find((call) => call.operation === 'insert')).toMatchObject({
      tenant: 'tenant-a', values: { tenant: 'tenant-a', settings: JSON.stringify({ timezone: 'America/New_York', secret: 'stored-secret' }) },
    });
  });
});
