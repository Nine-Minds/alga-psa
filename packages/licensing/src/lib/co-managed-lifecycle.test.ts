import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sql = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  log: [] as string[],
}));

vi.mock('@alga-psa/db', () => ({
  admitWrite: vi.fn(),
  withTransaction: async (db: any, work: (trx: any) => unknown) => work(db),
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (name: string) => {
      const filters: Array<(row: Record<string, any>) => boolean> = [(row) => row.tenant === tenant];
      let lock = '';
      const api: any = {
        where: (cond: Record<string, unknown> | string, value?: unknown) => {
          const entries = typeof cond === 'string' ? [[cond, value]] : Object.entries(cond);
          filters.push(row => entries.every(([k, v]) => row[k as string] === v));
          return api;
        },
        whereNull: (column: string) => { filters.push(row => row[column] == null); return api; },
        forUpdate: () => { lock = ' FOR UPDATE'; return api; },
        forShare: () => { lock = ' FOR SHARE'; return api; },
        first: async () => {
          sql.log.push(`${name}${lock}`);
          return (sql.tables[name] ?? []).find(row => filters.every(f => f(row)));
        },
      };
      return api;
    },
  }),
}));

const entitlement = vi.hoisted(() => ({ state: { capacity: 5, allocated: 1, available: 4, canGrow: true, isReadOnly: false, graceEndsAt: null as string | null } }));
vi.mock('./co-managed-entitlements', () => ({
  getCoManagedEntitlementState: async () => { sql.log.push('entitlement-state'); return entitlement.state; },
}));

import {
  coManagedLifecycleProvider,
  getCoManagedOperationalState,
  isCoManagedAwaitingAcceptance,
  isCoManagedAwaitingAcceptanceLazily,
  registerCoManagedLifecycleProvider,
  resetCoManagedAwaitingAcceptanceCache,
  resetCoManagedLifecycleProvider,
} from './co-managed-lifecycle';

const customer = '00000000-0000-4000-8000-0000000000c1';
const sponsor = '00000000-0000-4000-8000-0000000000a1';
const rel = '00000000-0000-4000-8000-0000000000b1';
const db: any = {};

function seed(product: string, relationshipState?: string) {
  sql.tables = {
    tenants: [{ tenant: customer, product_code: product }, { tenant: sponsor, product_code: 'psa' }],
    co_management_relationships: relationshipState
      ? [{ tenant: customer, relationship_id: rel, sponsor_tenant: sponsor, state: relationshipState, ended_at: null }] : [],
    co_managed_entitlements: [{ tenant: sponsor }],
    co_managed_allocations: [{ tenant: sponsor, customer_tenant: customer, relationship_id: rel, state: 'active', allocation_id: 'x' }],
  };
}

beforeEach(() => {
  sql.log = [];
  sql.tables = {};
  entitlement.state = { capacity: 5, allocated: 1, available: 4, canGrow: true, isReadOnly: false, graceEndsAt: null };
  resetCoManagedAwaitingAcceptanceCache();
  registerCoManagedLifecycleProvider(coManagedLifecycleProvider);
});
afterEach(() => { vi.useRealTimers(); resetCoManagedLifecycleProvider(); });

describe('with no provider registered', () => {
  it('answers independent and not-awaiting with no SQL', async () => {
    resetCoManagedLifecycleProvider();
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(await getCoManagedOperationalState(db, customer)).toEqual({ state: 'independent', canWrite: true, graceEndsAt: null });
    expect(sql.log).toEqual([]);
  });
});

describe('awaiting-acceptance cache', () => {
  it('a psa tenant costs one query once, then none (negative entries never expire)', async () => {
    vi.useFakeTimers();
    seed('psa');
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log).toEqual(['tenants']);
    vi.advanceTimersByTime(24 * 3_600_000);
    for (let i = 0; i < 5; i += 1) expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log).toEqual(['tenants']);
  });

  it('rechecks pending state and observes acceptance without invalidation', async () => {
    seed('co_managed', 'pending_acceptance');
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(true);
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(true);
    expect(sql.log).toEqual(['tenants', 'co_management_relationships', 'tenants', 'co_management_relationships']);
    sql.tables.co_management_relationships[0].state = 'active';
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    const probes = sql.log.length;
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log).toHaveLength(probes);
  });

  it('does not cache an absent workspace or a missing relationship', async () => {
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log).toEqual(['tenants', 'tenants']);
    seed('co_managed');
    sql.log = [];
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log.filter(entry => entry === 'co_management_relationships')).toHaveLength(2);
  });

  it('the lazy form never requests a connection once the answer is cached', async () => {
    seed('psa');
    const getDb = vi.fn(async () => db);
    expect(await isCoManagedAwaitingAcceptanceLazily(getDb, customer)).toBe(false);
    expect(getDb).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i += 1) expect(await isCoManagedAwaitingAcceptanceLazily(getDb, customer)).toBe(false);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(sql.log).toEqual(['tenants']);
    resetCoManagedLifecycleProvider();
    const untouched = vi.fn(async () => db);
    expect(await isCoManagedAwaitingAcceptanceLazily(untouched, 'other')).toBe(false);
    expect(untouched).not.toHaveBeenCalled();
  });

  it('a terminated relationship is final', async () => {
    seed('co_managed', 'terminated');
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    const probes = sql.log.length;
    expect(await isCoManagedAwaitingAcceptance(db, customer)).toBe(false);
    expect(sql.log).toHaveLength(probes);
  });
});

describe('readState', () => {
  it('a psa tenant is independent after reading its own row only', async () => {
    seed('psa');
    expect(await getCoManagedOperationalState(db, customer)).toEqual({ state: 'independent', canWrite: true, graceEndsAt: null });
    expect(sql.log).toEqual(['tenants']);
  });

  it('takes the plan lock order for an active co-managed workspace', async () => {
    seed('co_managed', 'active');
    const state = await getCoManagedOperationalState(db, customer);
    expect(state).toEqual({ state: 'active', canWrite: true, graceEndsAt: null });
    expect(sql.log).toEqual([
      'tenants', 'co_management_relationships',
      'co_managed_entitlements FOR UPDATE', 'tenants FOR SHARE',
      'co_management_relationships FOR SHARE', 'tenants FOR SHARE',
      'co_managed_allocations', 'entitlement-state',
    ]);
  });

  it.each([
    ['pending_acceptance', { state: 'pending_acceptance', canWrite: false, graceEndsAt: null }],
    ['provisioning', { state: 'pending_acceptance', canWrite: false, graceEndsAt: null }],
  ])('%s refuses writes', async (relationshipState, expected) => {
    seed('co_managed', relationshipState);
    expect(await getCoManagedOperationalState(db, customer)).toEqual(expected);
  });

  it('an ended co-managed workspace is terminated, never independent', async () => {
    seed('co_managed');
    expect(await getCoManagedOperationalState(db, customer)).toEqual({ state: 'terminated', canWrite: false, graceEndsAt: null });
  });

  it('is read-only past the entitlement grace and writable inside it', async () => {
    seed('co_managed', 'active');
    entitlement.state = { ...entitlement.state, graceEndsAt: '2026-12-01T00:00:00.000Z' };
    expect(await getCoManagedOperationalState(db, customer)).toMatchObject({ state: 'grace', canWrite: true });
    entitlement.state = { ...entitlement.state, isReadOnly: true };
    expect(await getCoManagedOperationalState(db, customer)).toMatchObject({ state: 'read_only', canWrite: false });
  });

  it('is read-only without an active allocation', async () => {
    seed('co_managed', 'active');
    sql.tables.co_managed_allocations = [];
    expect(await getCoManagedOperationalState(db, customer)).toMatchObject({ state: 'read_only', canWrite: false });
  });
});
