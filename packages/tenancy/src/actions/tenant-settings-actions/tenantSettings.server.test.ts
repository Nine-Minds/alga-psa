import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ scoped: [] as string[], writes: [] as string[] }));

vi.mock('@alga-psa/db', () => {
  const query = (tenant: string) => ({
    table: () => query(tenant),
    select: () => query(tenant),
    first: async () => ({ tenant, settings: { timezone: 'America/New_York' } }),
    insert: () => { state.writes.push(tenant); return query(tenant); },
    onConflict: () => query(tenant),
    ignore: async () => undefined,
  });
  return {
    createTenantKnex: async (tenant: string) => ({ knex: { tenant } }),
    tenantDb: (_knex: { tenant: string }, tenant: string) => { state.scoped.push(tenant); return query(tenant); },
    ensureMiscellaneousService: vi.fn(),
  };
});
vi.mock('@alga-psa/core/server', () => ({ featureFlags: { isEnabled: async () => true } }));

import {
  getTenantSettingsByTenantId,
  getTenantTimezone,
  initializeTenantSettings,
} from './tenantSettings.server';

describe('trusted tenant settings server operations', () => {
  beforeEach(() => { state.scoped.length = 0; state.writes.length = 0; });

  it('rejects a browser runtime while allowing this Node test process to import the module', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    try {
      await expect(import('./tenantSettings.server')).rejects.toThrow('server runtime');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('retains explicit tenant selection for trusted reads, timezone lookup, and initialization', async () => {
    await expect(getTenantSettingsByTenantId('tenant-b')).resolves.toMatchObject({ tenant: 'tenant-b' });
    await expect(getTenantTimezone('tenant-b')).resolves.toBe('America/New_York');
    await initializeTenantSettings('tenant-b');

    expect(state.scoped).toEqual(['tenant-b', 'tenant-b', 'tenant-b']);
    expect(state.writes).toEqual(['tenant-b']);
  });
});
