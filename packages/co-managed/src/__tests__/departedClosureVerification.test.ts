import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});

import { verifyCoManagedDepartedClosure, CoManagedDepartedClosureError } from '../departedClosureVerification';
import { coManagedUpgradeClosure } from '../upgradeClosureWiring';

const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const REL = '00000000-0000-4000-8000-0000000000d1';
const CLOSURE_OP = '00000000-0000-4000-8000-0000000000e1';
const ENDED = '2026-10-30T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const target = { customerTenant: CUSTOMER, relationshipId: REL };
const relationship: { revision: number; ended_at: string | null; sponsor_tenant: string } = { revision: 5, ended_at: ENDED, sponsor_tenant: SPONSOR };

/** A departure exactly as L7a's closeCoManagedRelationship leaves it (rows on the sponsor). */
function world(missing: string[] = []) {
  const { store, db } = createFake();
  db.schema = { hasTable: async (name: string) => !missing.includes(name) };
  store.seed('co_managed_relationship_closures', { tenant: SPONSOR, operation_id: CLOSURE_OP, customer_tenant: CUSTOMER, relationship_id: REL,
    reason: 'departure', applied_revision: 5, cutoff_at: ENDED, closed_at: ENDED });
  store.seed('co_managed_archive_manifests', { tenant: SPONSOR, operation_id: CLOSURE_OP, customer_tenant: CUSTOMER, relationship_id: REL,
    cutoff_at: ENDED, content_hash: HASH });
  store.seed('co_managed_allocations', { tenant: SPONSOR, operation_id: 'alloc', customer_tenant: CUSTOMER, relationship_id: REL, released_at: ENDED });
  return { store, db };
}

describe('departed closure verification (L7a contract, read-only)', () => {
  let ctx: ReturnType<typeof world>;
  beforeEach(() => { ctx = world(); });

  it('a sealed departure verifies and returns the closure operation, writing nothing', async () => {
    const before = structuredClone(ctx.store.tables);
    await expect(verifyCoManagedDepartedClosure(ctx.db, target, relationship)).resolves.toEqual({ operationId: CLOSURE_OP });
    expect(ctx.store.tables).toEqual(before);
  });

  it('is what the wiring uses for departed customers', () => {
    expect(coManagedUpgradeClosure.verifyDepartedClosure).toBe(verifyCoManagedDepartedClosure);
    expect(coManagedUpgradeClosure.available).toBe(false);
  });

  it.each(['co_managed_relationship_closures', 'co_managed_archive_manifests', 'co_managed_allocations'])(
    'fails closed when L7a table %s is absent', async (table) => {
      ctx = world([table]);
      await expect(verifyCoManagedDepartedClosure(ctx.db, target, relationship)).rejects.toBeInstanceOf(CoManagedDepartedClosureError);
    });

  const cases: Array<[string, (c: ReturnType<typeof world>) => void, Partial<typeof relationship>?]> = [
    ['no closure receipt', c => { c.store.tables.co_managed_relationship_closures = []; }],
    ['closure for another relationship only', c => { c.store.tables.co_managed_relationship_closures[0].relationship_id = '00000000-0000-4000-8000-0000000000d2'; }],
    ['closure time differs from the relationship end', c => { c.store.tables.co_managed_relationship_closures[0].closed_at = '2026-10-30T12:00:01.000Z'; }],
    ['relationship changed after closure', () => undefined, { revision: 6 }],
    ['relationship has no end', () => undefined, { ended_at: null }],
    ['no sealed manifest', c => { c.store.tables.co_managed_archive_manifests = []; }],
    ['manifest of another operation', c => { c.store.tables.co_managed_archive_manifests[0].operation_id = '00000000-0000-4000-8000-0000000000e2'; }],
    ['manifest cutoff differs', c => { c.store.tables.co_managed_archive_manifests[0].cutoff_at = '2026-10-30T11:59:59.000Z'; }],
    ['malformed manifest hash', c => { c.store.tables.co_managed_archive_manifests[0].content_hash = 'nothex'; }],
    ['allocation not released', c => { c.store.tables.co_managed_allocations[0].released_at = null; }],
  ];
  it.each(cases)('refuses: %s', async (_name, mutate, rel) => {
    mutate(ctx);
    await expect(verifyCoManagedDepartedClosure(ctx.db, target, { ...relationship, ...rel })).rejects.toBeInstanceOf(CoManagedDepartedClosureError);
  });
});
