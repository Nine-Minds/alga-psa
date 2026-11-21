import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ entitlement: null as any, grants: false, admit: vi.fn(), tables: [] as string[] }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {
    transaction: async (work: any) => work({ raw: async () => undefined, fn: { now: () => new Date() } }),
  } }),
  tenantDb: () => ({
    table: (name: string) => {
      mocks.tables.push(name);
      const q: any = {
        forUpdate: () => q,
        where: () => q,
        first: async () => name === 'co_managed_entitlements' ? mocks.entitlement
          : name === 'tenants' ? { product_code: 'psa' }
          : name === 'permissions' && mocks.grants ? { permission_id: 'p' } : undefined,
      };
      return q;
    },
  }),
}));
vi.mock('@alga-psa/licensing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/licensing')>()), admitCoManagedPermissions: mocks.admit,
}));

import { admitCoManagedSponsor } from '@/lib/co-managed/admitSponsor';

const now = Date.now();
const hosted = (over: Record<string, unknown>) => ({ source: 'hosted', lapse_started_at: null,
  verified_at: new Date(now), valid_until: new Date(now), ...over });

beforeEach(() => { mocks.admit.mockReset(); mocks.entitlement = null; mocks.grants = false; mocks.tables = []; });

describe('lazy sponsor permission admission', () => {
  it('a pending zero row (an unpaid observation) seeds no grants', async () => {
    mocks.entitlement = hosted({});
    await admitCoManagedSponsor('t1');
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it('no entitlement seeds nothing', async () => {
    await admitCoManagedSponsor('t1');
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it('a verified pool still seeds the grants once', async () => {
    mocks.entitlement = hosted({ capacity: 3, valid_until: new Date(now + 86_400_000) });
    await admitCoManagedSponsor('t1');
    expect(mocks.admit).toHaveBeenCalledTimes(1);
  });

  it('a lapsed sponsor with history is still admitted as before', async () => {
    mocks.entitlement = hosted({ capacity: 3, lapse_started_at: new Date(now - 1000) });
    await admitCoManagedSponsor('t1');
    expect(mocks.admit).toHaveBeenCalledTimes(1);
  });

  it('never restores permissions an administrator removed', async () => {
    mocks.entitlement = hosted({ capacity: 3, valid_until: new Date(now + 86_400_000) });
    mocks.grants = true;
    await admitCoManagedSponsor('t1');
    expect(mocks.admit).not.toHaveBeenCalled();
  });
});
