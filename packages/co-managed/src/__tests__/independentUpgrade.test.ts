import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/licensing', () => ({ countCoManagedCommittedSeats: async () => 0 }));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: async () => true }));
vi.mock('../sharedWorkIdentity', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lockCoManagedSessionIdentity: async () => undefined,
  assertCoManagedSessionUnexpired: async () => undefined,
}));

import { upgradeCoManagedRelationship, CoManagedIndependentUpgradeError } from '../independentUpgrade';
import { coManagedUpgradeClosure } from '../upgradeClosureWiring';
import type { CoManagedUpgradeClosure } from '../upgradeClosure';

const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const USER = '00000000-0000-4000-8000-0000000000a2';
const REL = '00000000-0000-4000-8000-0000000000d1';
const OP = '00000000-0000-4000-8000-0000000000b1';
const actor = { kind: 'session' as const, tenant: CUSTOMER, userId: USER, sessionId: '00000000-0000-4000-8000-0000000000e1' } as any;
const target = { customerTenant: CUSTOMER, relationshipId: REL };
const entitlement = async () => ({ source: 'stripe' as const, reference: 'sub_own', seats: 3, validUntil: new Date(Date.now() + 86_400_000) });

/** The fake's raw-SQL surface is minimal; model the two clock reads the domain makes. */
function setup() {
  const { store, db } = createFake();
  store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: REL, sponsor_tenant: SPONSOR, state: 'active', revision: 4, ended_at: null });
  store.seed('tenants', { tenant: CUSTOMER, product_code: 'co_managed' }, { tenant: SPONSOR, product_code: 'psa' });
  db.select = () => Object.assign(Promise.resolve({ at: new Date().toISOString() }), {
    first: async () => ({ at: new Date().toISOString() }), whereRaw: () => ({ first: async () => ({ '?column?': 1 }) }) });
  const calls = { close: 0, verify: 0, released: 0 };
  const closure: CoManagedUpgradeClosure = {
    // L7a's closure is idempotent per operation and releases the allocation once.
    async closeAndArchive(_trx, _actor, _target, input) { calls.close += 1; calls.released += 1; return { operationId: input.operationId }; },
    async verifyDepartedClosure() { calls.verify += 1; return { operationId: OP }; },
  };
  return { store, db, calls, closure };
}
const request = { operationId: OP, expectedRevision: 4 };

describe('independent upgrade (A1: receipt idempotency)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('the same operationId twice yields one closure, one release and one receipt', async () => {
    const first = await upgradeCoManagedRelationship(ctx.db, actor, target, request, entitlement, ctx.closure);
    // After conversion the revision/product moved on; a retry must replay the stored receipt.
    const second = await upgradeCoManagedRelationship(ctx.db, actor, target, request, entitlement, ctx.closure);
    expect(second).toEqual(first);
    expect(ctx.calls).toEqual({ close: 1, verify: 0, released: 1 });
    expect(ctx.store.rows('co_managed_independent_upgrades')).toHaveLength(1);
    expect(ctx.store.rows('tenants').find(t => t.tenant === CUSTOMER)).toMatchObject({ product_code: 'psa', plan: 'pro' });
  });

  it('a changed request on the same operationId raises UPGRADE_CHANGED and does not close again', async () => {
    await upgradeCoManagedRelationship(ctx.db, actor, target, request, entitlement, ctx.closure);
    const changed = { ...request, expectedRevision: 5 };
    await expect(upgradeCoManagedRelationship(ctx.db, actor, target, changed, entitlement, ctx.closure))
      .rejects.toMatchObject({ code: 'UPGRADE_CHANGED' });
    expect(ctx.calls.close).toBe(1);
  });

  it('an unpaid entitlement changes nothing and never closes the relationship', async () => {
    const unpaid = async () => ({ source: 'stripe' as const, reference: '', seats: 3, validUntil: new Date(Date.now() + 1000) });
    await expect(upgradeCoManagedRelationship(ctx.db, actor, target, request, unpaid, ctx.closure))
      .rejects.toBeInstanceOf(CoManagedIndependentUpgradeError);
    expect(ctx.calls.close).toBe(0);
    expect(ctx.store.rows('tenants').find(t => t.tenant === CUSTOMER)?.product_code).toBe('co_managed');
    expect(ctx.store.rows('co_managed_independent_upgrades')).toHaveLength(0);
  });

  it('a stale revision is refused before any closure', async () => {
    await expect(upgradeCoManagedRelationship(ctx.db, actor, target, { ...request, expectedRevision: 3 }, entitlement, ctx.closure))
      .rejects.toMatchObject({ code: 'UPGRADE_CHANGED' });
    expect(ctx.calls.close).toBe(0);
  });

  it('the default closure seam fails closed until CM L7a is wired', async () => {
    await expect(upgradeCoManagedRelationship(ctx.db, actor, target, request, entitlement, coManagedUpgradeClosure))
      .rejects.toThrow(/L7a/);
    expect(ctx.store.rows('tenants').find(t => t.tenant === CUSTOMER)?.product_code).toBe('co_managed');
  });
});
