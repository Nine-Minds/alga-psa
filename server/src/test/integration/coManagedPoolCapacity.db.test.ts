/**
 * Co-managed seat and workspace shapes, slice S2 (F004 / T003) on real Postgres.
 *
 * The pool is read in one place. On a pool that holds only workspace allocations the reading
 * equals the query the entitlement, purchase and reservation paths each used to carry, so nothing
 * changes for an existing pool. On a mixed pool a seat allocation counts once: in the total, in
 * its own side of the per-kind breakdown, and against all three paths.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  getCoManagedEntitlementState, readCoManagedPoolCapacity, reserveCoManagedWorkspace, runCoManagedPurchase,
} from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant } from '../../../test-utils/testDataFactory';

const TABLE = 'co_managed_allocations';
const PURCHASED = 10;
const describeDb = await describeWithDb();

describeDb('one capacity reading for the co-managed seat pool', { shuffle: false }, () => {
  let db: Knex; let sponsor: string;

  const base = (seats: number, state: string) => ({
    tenant: sponsor, allocation_id: randomUUID(), operation_id: randomUUID(),
    request_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'), seats, state,
    ...(state === 'released' ? { released_at: new Date() } : {}),
  });
  /** A workspace allocation exactly as code before the kind column wrote it. */
  const workspace = (seats: number, state: string) => ({ ...base(seats, state), customer_tenant: randomUUID(), relationship_id: randomUUID() });
  const seat = (seats: number, state: string) => ({ ...base(seats, state), allocation_kind: 'seat', sponsor_client_id: randomUUID() });

  /** The allocated-seat query as the three call sites each wrote it before this slice. */
  const legacyAllocated = async () => {
    const totals = await db(TABLE).where({ tenant: sponsor }).whereNot('state', 'released').sum('seats as used').first();
    return Number(totals?.used ?? 0);
  };
  const reading = (purchased = PURCHASED) => db.transaction((trx) => readCoManagedPoolCapacity(trx, sponsor, purchased));
  const purchase = (quantity: number) => runCoManagedPurchase(db, { sponsorTenant: sponsor, operationId: randomUUID(), quantity },
    async () => { throw new Error('the provider must not be reached'); });
  const reserve = async (seats: number) => reserveCoManagedWorkspace(db, { sponsorTenant: sponsor,
    clientId: await createClient(db, sponsor, `Pool client ${randomUUID().slice(0, 8)}`), operationId: randomUUID(), seats, visibilityMode: 'board_scope' });

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's2_pool_capacity_test' });
    sponsor = await createTenant(db, 'Pool sponsor', { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: 'sub_s2_test', capacity: PURCHASED,
      verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
    // Workspace-only pool: 3 active + 2 reserved hold seats; the released 4 hold none.
    await db(TABLE).insert([workspace(3, 'active'), workspace(2, 'reserved'), workspace(4, 'released')]);
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('reads an empty pool as nothing allocated', async () => {
    const empty = randomUUID();
    expect(await db.transaction((trx) => readCoManagedPoolCapacity(trx, empty, 0)))
      .toEqual({ purchased: 0, allocated: 0, available: 0, byKind: { workspace: 0, seat: 0 } });
  });

  it('on a workspace-only pool the reading equals the previous allocated-seat query', async () => {
    expect(await legacyAllocated()).toBe(5);
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 5, available: 5, byKind: { workspace: 5, seat: 0 } });
  });

  it('on a workspace-only pool the entitlement, purchase and reservation paths answer as before', async () => {
    const allocated = await legacyAllocated();
    expect(await getCoManagedEntitlementState(db, sponsor)).toMatchObject({
      capacity: PURCHASED, allocated, available: PURCHASED - allocated, canGrow: true, isReadOnly: false, graceEndsAt: null });
    await expect(purchase(allocated - 1)).rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });
    await expect(reserve(PURCHASED - allocated + 1)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(await legacyAllocated()).toBe(allocated);
  });

  it('on a mixed pool a seat allocation counts once, and a released one not at all', async () => {
    await db(TABLE).insert([seat(2, 'active'), seat(6, 'released')]);
    const pool = await reading();
    expect(pool).toEqual({ purchased: PURCHASED, allocated: 7, available: 3, byKind: { workspace: 5, seat: 2 } });
    expect(pool.byKind.workspace + pool.byKind.seat).toBe(pool.allocated);
    expect(pool.allocated).toBe(await legacyAllocated());
  });

  it('never reads a negative availability when the pool is over-allocated', async () => {
    expect(await reading(4)).toEqual({ purchased: 4, allocated: 7, available: 0, byKind: { workspace: 5, seat: 2 } });
  });

  it('seat allocations weigh on the entitlement, purchase and reservation paths', async () => {
    expect(await getCoManagedEntitlementState(db, sponsor)).toMatchObject({ capacity: PURCHASED, allocated: 7, available: 3, canGrow: true });
    // 6 would have held the workspace allocations alone; the seat allocation makes it too small.
    await expect(purchase(6)).rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });
    await expect(reserve(4)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    // Exactly what is left still fits, and fills the pool.
    expect(await reserve(3)).toMatchObject({ seats: 3, state: 'reserved' });
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 10, available: 0, byKind: { workspace: 8, seat: 2 } });
    expect(await getCoManagedEntitlementState(db, sponsor)).toMatchObject({ allocated: 10, available: 0, canGrow: false });
  });
});
