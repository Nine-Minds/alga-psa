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

import { admits, capabilityResolverStatus, filterServed, serves } from '@alga-psa/core/capability';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { registerCoManagedCapability, coManagedParticipants } from '../capability';

const CAP = 'co-managed';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const flag = (on: boolean) => registerFeatureFlagChecker(async () => on);
const original = process.env.FORCE_CAPABILITIES;

beforeEach(() => {
  store.tables = {};
  store.statements = 0;
  store.fail = false;
  delete process.env.FORCE_CAPABILITIES;
  resetCapabilityRegistry();
  clearCapabilityCache();
  registerCoManagedCapability();
});
afterEach(() => {
  if (original === undefined) delete process.env.FORCE_CAPABILITIES;
  else process.env.FORCE_CAPABILITIES = original;
});

describe('co-managed capability registration', () => {
  it('registers both resolvers', () => {
    expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'registered', participation: 'registered' });
  });

  it('is idempotent', () => {
    registerCoManagedCapability();
    registerCoManagedCapability();
    expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'registered', participation: 'registered' });
  });
});

describe('admits = flag AND a durable entitlement row', () => {
  it.each([
    { name: 'flag on, entitlement', flagOn: true, entitled: true, expected: true, reason: 'open' },
    { name: 'flag off, entitlement', flagOn: false, entitled: true, expected: false, reason: 'flag-off' },
    { name: 'flag on, no entitlement', flagOn: true, entitled: false, expected: false, reason: 'not-eligible' },
    { name: 'flag off, no entitlement', flagOn: false, entitled: false, expected: false, reason: 'flag-off' },
  ])('$name', async ({ flagOn, entitled, expected, reason }) => {
    flag(flagOn);
    if (entitled) store.tables.co_managed_entitlements = [{ tenant: A, source: 'admin_grant' }];
    const decision = await admits(CAP, A);
    expect(decision.admitted).toBe(expected);
    expect(decision.reasons.admitted).toBe(reason);
  });

  it('is not eligible on another tenant\'s entitlement', async () => {
    flag(true);
    store.tables.co_managed_entitlements = [{ tenant: B }];
    expect((await admits(CAP, A)).admitted).toBe(false);
  });

  it('fails closed when the read throws', async () => {
    flag(true);
    store.fail = true;
    const decision = await admits(CAP, A);
    expect(decision.admitted).toBe(false);
    expect(decision.reasons.admitted).toBe('eligibility-error');
  });
});

describe('serves = participation, with no flag term', () => {
  beforeEach(() => flag(false));

  it.each<{ name: string; tables: Record<string, Record<string, any>[]>; tenant: string }>([
    { name: 'customer relationship row', tables: { co_management_relationships: [{ tenant: A, sponsor_tenant: B }] }, tenant: A },
    { name: 'sponsor of a relationship', tables: { co_management_relationships: [{ tenant: A, sponsor_tenant: B }] }, tenant: B },
    { name: 'entitlement row', tables: { co_managed_entitlements: [{ tenant: A }] }, tenant: A },
    { name: 'co_managed product', tables: { tenants: [{ tenant: A, product_code: 'co_managed' }] }, tenant: A },
  ])('serves via $name even with the flag off', async ({ tables, tenant }) => {
    store.tables = tables;
    expect((await serves(CAP, tenant)).served).toBe(true);
  });

  it('does not serve a plain psa tenant or an unrelated tenant', async () => {
    store.tables = {
      tenants: [{ tenant: A, product_code: 'psa' }],
      co_management_relationships: [{ tenant: B, sponsor_tenant: C }],
    };
    expect((await serves(CAP, A)).served).toBe(false);
    expect((await serves(CAP, D)).served).toBe(false);
  });

  it('fails closed when the read throws', async () => {
    store.tables = { co_managed_entitlements: [{ tenant: A }] };
    store.fail = true;
    const decision = await serves(CAP, A);
    expect(decision.served).toBe(false);
    expect(decision.reasons.served).toBe('participation-error');
  });

  it('answers a batch in a fixed number of statements', async () => {
    store.tables = {
      co_management_relationships: [{ tenant: A, sponsor_tenant: B }],
      tenants: [{ tenant: C, product_code: 'co_managed' }],
    };
    expect(await filterServed(CAP, [A, B, C, D])).toEqual([A, B, C]);
    expect(store.statements).toBe(4);
  });

  it('returns nothing for an empty batch without a statement', async () => {
    expect(await coManagedParticipants([])).toEqual(new Set());
    expect(store.statements).toBe(0);
  });
});

describe('FORCE_CAPABILITIES', () => {
  it('co-managed:on admits and serves with no rows and the flag off', async () => {
    flag(false);
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    expect(await admits(CAP, A)).toMatchObject({ admitted: true, forced: 'on' });
    expect(await serves(CAP, A)).toMatchObject({ served: true, forced: 'on' });
    expect(store.statements).toBe(0);
  });

  it('co-managed:off closes both despite entitlement and participation', async () => {
    flag(true);
    store.tables = { co_managed_entitlements: [{ tenant: A }] };
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    expect((await admits(CAP, A)).admitted).toBe(false);
    expect((await serves(CAP, A)).served).toBe(false);
  });

  it('a malformed value closes the capability', async () => {
    flag(true);
    store.tables = { co_managed_entitlements: [{ tenant: A }] };
    process.env.FORCE_CAPABILITIES = 'co-managed:maybe';
    expect((await admits(CAP, A)).admitted).toBe(false);
    expect((await serves(CAP, A)).served).toBe(false);
  });
});
