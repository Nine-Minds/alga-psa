import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny table store behind the tenantDb surface the resolvers use.
const store = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  statements: 0,
  fail: false,
}));

vi.mock('@alga-psa/db', () => {
  const builder = (name: string, tenant?: string) => {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    if (tenant) filters.push(row => row.tenant === tenant);
    const run = () => {
      store.statements += 1;
      if (store.fail) throw new Error('database unavailable');
      return (store.tables[name] ?? []).filter(row => filters.every(f => f(row)));
    };
    const api: any = {
      whereIn: (column: string, values: string[]) => { filters.push(row => values.includes(row[column])); return api; },
      where: (column: string, value: unknown) => { filters.push(row => row[column] === value); return api; },
      distinct: () => api,
      select: () => api,
      first: async () => run()[0],
      then: (resolve: (rows: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return api;
  };
  return {
    getAdminConnection: async () => ({}),
    registerWriteAdmissionProvider: () => undefined,
    tenantDb: (_conn: unknown, tenant: string) => ({
      table: (name: string) => builder(name, tenant),
      unscoped: (name: string, reason: string) => {
        if (!reason) throw new Error('reason required');
        return builder(name);
      },
    }),
  };
});

vi.mock('@alga-psa/licensing/lifecycle', () => ({
  CO_MANAGED_OPERATIONAL_WRITE: 'co-managed-operational-write',
  coManagedLifecycleProvider: { readState: vi.fn() },
  registerCoManagedLifecycleProvider: vi.fn(),
}));
vi.mock('@alga-psa/licensing/lifecycle-error', () => ({ CoManagedLifecycleError: class extends Error {} }));

import {
  admits, capabilityFeatureFlag, capabilityResolverStatus, evaluateCapability, filterServed, serves,
} from '@alga-psa/core/capability';
import { registerFeatureFlagChecker, type FeatureFlagEvaluation } from '@alga-psa/core/features';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { registerCoManagedCapability } from '../capability';
import {
  CO_MANAGED_SEAT_CAPABILITY, coManagedSeatParticipants, registerCoManagedSeatCapability,
} from '../seatCapability';

const SEAT = CO_MANAGED_SEAT_CAPABILITY;
const WORKSPACE = 'co-managed';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

type FlagState = 'on' | 'off' | 'unavailable' | 'throws';
const flagChecker = vi.fn<() => Promise<boolean | FeatureFlagEvaluation>>();
const flag = (state: FlagState) => {
  if (state === 'throws') flagChecker.mockRejectedValue(new Error('posthog down'));
  else if (state === 'unavailable') flagChecker.mockResolvedValue({ status: 'unavailable', enabled: true });
  else flagChecker.mockResolvedValue(state === 'on');
};
const original = process.env.FORCE_CAPABILITIES;

/** The decision with the tenant-independent parts only, for before/after comparison. */
const verdict = async (capability: typeof SEAT | typeof WORKSPACE, tenant: string) => {
  clearCapabilityCache();
  const { admitted, served, forced, reasons } = await evaluateCapability(capability, tenant);
  return { admitted, served, forced, reasons };
};

beforeEach(() => {
  store.tables = {};
  store.statements = 0;
  store.fail = false;
  delete process.env.FORCE_CAPABILITIES;
  flagChecker.mockReset();
  registerFeatureFlagChecker(flagChecker);
  resetCapabilityRegistry();
  clearCapabilityCache();
  registerCoManagedCapability();
  registerCoManagedSeatCapability();
});
afterEach(() => {
  if (original === undefined) delete process.env.FORCE_CAPABILITIES;
  else process.env.FORCE_CAPABILITIES = original;
});

describe('co-managed-seat capability registration', () => {
  it('is gated on the same rollout flag as co-managed', () => {
    expect(SEAT).toBe('co-managed-seat');
    expect(capabilityFeatureFlag(SEAT)).toBe('release-v2-0-feature');
    expect(capabilityFeatureFlag(SEAT)).toBe(capabilityFeatureFlag(WORKSPACE));
  });

  it('registers both resolvers, idempotently', () => {
    registerCoManagedSeatCapability();
    expect(capabilityResolverStatus(SEAT)).toEqual({ eligibility: 'registered', participation: 'registered' });
  });

  it('registers with the co-managed capability module, so every host that loads one loads both', async () => {
    resetCapabilityRegistry();
    expect(capabilityResolverStatus(SEAT)).toEqual({ eligibility: 'unregistered', participation: 'unregistered' });
    vi.resetModules();
    await import('../capability');
    expect(capabilityResolverStatus(SEAT)).toEqual({ eligibility: 'registered', participation: 'registered' });
    expect(capabilityResolverStatus(WORKSPACE)).toEqual({ eligibility: 'registered', participation: 'registered' });
  });

  it('is closed for every tenant by default: no rows, flag on', async () => {
    flag('on');
    store.tables = { tenants: [{ tenant: A, product_code: 'psa' }] };
    expect(await verdict(SEAT, A)).toMatchObject({ admitted: false, served: false, forced: null });
  });
});

describe('admits = flag AND a pool entitlement row for a psa tenant', () => {
  const flags: FlagState[] = ['on', 'off', 'unavailable', 'throws'];
  const products = ['psa', 'co_managed', 'algadesk', null, undefined] as const;
  const closedByFlag = { off: 'flag-off', unavailable: 'flag-unavailable', throws: 'flag-unavailable' } as const;
  const cases = flags.flatMap(flagState => [true, false].flatMap(entitled => products.map(product => {
    const eligible = entitled && product === 'psa';
    return {
      flagState, entitled, product: product === undefined ? 'no tenant row' : String(product),
      productCode: product,
      expected: flagState === 'on' && eligible,
      reason: flagState === 'on' ? (eligible ? 'open' : 'not-eligible') : closedByFlag[flagState],
    };
  })));

  it.each(cases)('flag $flagState, entitlement $entitled, product $product -> $expected ($reason)', async ({
    flagState, entitled, productCode, expected, reason,
  }) => {
    flag(flagState);
    store.tables = {
      co_managed_entitlements: entitled ? [{ tenant: A, source: 'admin_grant' }] : [],
      tenants: productCode === undefined ? [] : [{ tenant: A, product_code: productCode }],
    };
    const decision = await admits(SEAT, A);
    expect(decision.admitted).toBe(expected);
    expect(decision.reasons.admitted).toBe(reason);
  });

  it('is not eligible on another tenant\'s entitlement or product code', async () => {
    flag('on');
    store.tables = {
      co_managed_entitlements: [{ tenant: B }],
      tenants: [{ tenant: A, product_code: 'psa' }, { tenant: B, product_code: 'psa' }],
    };
    expect((await admits(SEAT, A)).admitted).toBe(false);
    store.tables = {
      co_managed_entitlements: [{ tenant: A }],
      tenants: [{ tenant: A, product_code: 'co_managed' }, { tenant: B, product_code: 'psa' }],
    };
    clearCapabilityCache();
    expect((await admits(SEAT, A)).admitted).toBe(false);
  });

  it('participation never admits: a seat arrangement row without an entitlement stays closed', async () => {
    flag('on');
    store.tables = {
      tenants: [{ tenant: A, product_code: 'psa' }],
      co_managed_seat_arrangements: [{ tenant: A, state: 'active' }],
    };
    expect(await verdict(SEAT, A)).toMatchObject({ admitted: false, served: true });
  });

  it('fails closed when the read throws', async () => {
    flag('on');
    store.tables = { co_managed_entitlements: [{ tenant: A }], tenants: [{ tenant: A, product_code: 'psa' }] };
    store.fail = true;
    const decision = await admits(SEAT, A);
    expect(decision.admitted).toBe(false);
    expect(decision.reasons.admitted).toBe('eligibility-error');
  });
});

describe('serves = a seat arrangement row, with no flag term', () => {
  it.each<{ flagState: FlagState; state: string }>([
    { flagState: 'on', state: 'active' },
    { flagState: 'off', state: 'active' },
    { flagState: 'unavailable', state: 'active' },
    { flagState: 'throws', state: 'active' },
    { flagState: 'off', state: 'ended' },
  ])('serves an $state arrangement with the flag $flagState', async ({ flagState, state }) => {
    flag(flagState);
    store.tables = { co_managed_seat_arrangements: [{ tenant: A, state }] };
    const decision = await serves(SEAT, A);
    expect(decision.served).toBe(true);
    expect(decision.reasons.served).toBe('open');
    expect(flagChecker).not.toHaveBeenCalled();
  });

  it('does not serve on entitlement, product code, a workspace relationship or another tenant\'s arrangement', async () => {
    flag('on');
    store.tables = {
      co_managed_entitlements: [{ tenant: A }],
      tenants: [{ tenant: A, product_code: 'psa' }],
      co_management_relationships: [{ tenant: C, sponsor_tenant: A }],
      co_managed_seat_arrangements: [{ tenant: B, state: 'active' }],
    };
    const decision = await serves(SEAT, A);
    expect(decision.served).toBe(false);
    expect(decision.reasons.served).toBe('not-participating');
  });

  it('fails closed when the read throws', async () => {
    store.tables = { co_managed_seat_arrangements: [{ tenant: A, state: 'active' }] };
    store.fail = true;
    const decision = await serves(SEAT, A);
    expect(decision.served).toBe(false);
    expect(decision.reasons.served).toBe('participation-error');
  });

  it('answers a batch in one statement', async () => {
    store.tables = {
      co_managed_seat_arrangements: [
        { tenant: A, state: 'active' }, { tenant: A, state: 'ended' }, { tenant: C, state: 'ended' },
      ],
    };
    expect(await filterServed(SEAT, [A, B, C, D])).toEqual([A, C]);
    expect(store.statements).toBe(1);
  });

  it('returns nothing for an empty batch without a statement', async () => {
    expect(await coManagedSeatParticipants([])).toEqual(new Set());
    expect(store.statements).toBe(0);
  });
});

describe('FORCE_CAPABILITIES', () => {
  /** A is entitled, a psa tenant, sponsors a workspace and has a seat arrangement: both
   * capabilities are open for it. B has nothing: both are closed. */
  const everything = () => ({
    co_managed_entitlements: [{ tenant: A }],
    tenants: [{ tenant: A, product_code: 'psa' }, { tenant: B, product_code: 'psa' }],
    co_management_relationships: [{ tenant: C, sponsor_tenant: A }],
    co_managed_seat_arrangements: [{ tenant: A, state: 'active' }],
  });

  it('co-managed-seat:off closes admission and service for every tenant and leaves co-managed alone', async () => {
    flag('on');
    store.tables = everything();
    const before = { a: await verdict(WORKSPACE, A), b: await verdict(WORKSPACE, B) };
    expect(await verdict(SEAT, A)).toMatchObject({ admitted: true, served: true, forced: null });

    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    for (const tenant of [A, B, C, D]) {
      expect(await verdict(SEAT, tenant)).toEqual({
        admitted: false, served: false, forced: 'off', reasons: { admitted: 'forced-off', served: 'forced-off' },
      });
    }
    expect(await filterServed(SEAT, [A, B, C, D])).toEqual([]);
    expect(await verdict(WORKSPACE, A)).toEqual(before.a);
    expect(await verdict(WORKSPACE, B)).toEqual(before.b);
    expect(before.a).toMatchObject({ admitted: true, served: true, forced: null });
  });

  it('co-managed-seat:on admits and serves without PostHog or a statement, and leaves co-managed alone', async () => {
    flag('off');
    const before = await verdict(WORKSPACE, A);
    flagChecker.mockClear();
    store.statements = 0;

    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    expect(await admits(SEAT, A)).toMatchObject({ admitted: true, forced: 'on' });
    expect(await serves(SEAT, A)).toMatchObject({ served: true, forced: 'on' });
    expect(flagChecker).not.toHaveBeenCalled();
    expect(store.statements).toBe(0);

    flag('throws');
    expect(await admits(SEAT, A)).toMatchObject({ admitted: true, forced: 'on' });
    flag('off');
    expect(await verdict(WORKSPACE, A)).toEqual(before);
    expect(before).toMatchObject({ admitted: false, served: false, forced: null });
  });

  it.each(['co-managed:off', 'co-managed:on', 'co-managed:maybe'])(
    '%s does not move co-managed-seat (the keys share a prefix, not a switch)',
    async (raw) => {
      flag('on');
      store.tables = everything();
      const before = { a: await verdict(SEAT, A), b: await verdict(SEAT, B) };
      process.env.FORCE_CAPABILITIES = raw;
      expect(await verdict(SEAT, A)).toEqual(before.a);
      expect(await verdict(SEAT, B)).toEqual(before.b);
      expect(before.a).toMatchObject({ admitted: true, served: true, forced: null });
      expect(before.b).toMatchObject({ admitted: false, served: false, forced: null });
      expect((await verdict(WORKSPACE, A)).forced).toBe(raw === 'co-managed:on' ? 'on' : 'off');
    },
  );

  it('each key answers for itself when both are set', async () => {
    flag('on');
    store.tables = everything();
    process.env.FORCE_CAPABILITIES = 'co-managed:on, co-managed-seat:off';
    expect(await verdict(WORKSPACE, B)).toMatchObject({ admitted: true, served: true, forced: 'on' });
    expect(await verdict(SEAT, A)).toMatchObject({ admitted: false, served: false, forced: 'off' });
    process.env.FORCE_CAPABILITIES = 'co-managed:off,co-managed-seat:on';
    expect(await verdict(WORKSPACE, A)).toMatchObject({ admitted: false, served: false, forced: 'off' });
    expect(await verdict(SEAT, B)).toMatchObject({ admitted: true, served: true, forced: 'on' });
  });

  it('a malformed value closes co-managed-seat only', async () => {
    flag('on');
    store.tables = everything();
    const before = await verdict(WORKSPACE, A);
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:maybe';
    expect(await verdict(SEAT, A)).toMatchObject({
      admitted: false, served: false, reasons: { admitted: 'forced-malformed', served: 'forced-malformed' },
    });
    expect(await verdict(WORKSPACE, A)).toEqual(before);
  });
});
