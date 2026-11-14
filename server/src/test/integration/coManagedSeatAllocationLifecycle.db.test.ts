/**
 * Co-managed seat and workspace shapes, slice S4 (F008, F009, F010 / T006) on real Postgres.
 *
 * A seat allocation is resized and released against the same pool a workspace allocation sits
 * on. A raise fits in what the pool has left, a reduction stops at the seats in use, a release
 * gives the seats back once however often it is replayed, and the pool cannot be bought down
 * below what both kinds hold together.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  getCoManagedEntitlementState, readCoManagedPoolCapacity, releaseCoManagedSeatAllocation,
  resizeCoManagedSeatAllocation, runCoManagedPurchase,
} from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant } from '../../../test-utils/testDataFactory';

const TABLE = 'co_managed_allocations';
const PURCHASED = 10;
const SUBSCRIPTION = 'sub_s4_test';
const describeDb = await describeWithDb();

describeDb('resize and release a seat allocation on the co-managed pool', { shuffle: false }, () => {
  let db: Knex; let sponsor: string; let seatId: string; let workspaceId: string;
  /** Seats in use inside the seat allocation: what later slices count from technicians and invitations. */
  let committed = 3;
  const counted: Array<{ allocation_id: string; seats: number }> = [];
  const countCommittedSeats = async (_trx: Knex.Transaction, allocation: { allocation_id: string; seats: number }) => {
    counted.push({ allocation_id: allocation.allocation_id, seats: allocation.seats });
    return committed;
  };

  const base = (seats: number) => ({
    tenant: sponsor, allocation_id: randomUUID(), operation_id: randomUUID(),
    request_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'), seats, state: 'active',
  });
  const workspace = (seats: number) => ({ ...base(seats), customer_tenant: randomUUID(), relationship_id: randomUUID() });
  const seat = (seats: number) => ({ ...base(seats), allocation_kind: 'seat', sponsor_client_id: randomUUID() });
  const row = (allocationId: string) => db(TABLE).where({ tenant: sponsor, allocation_id: allocationId }).first();
  const reading = () => db.transaction((trx) => readCoManagedPoolCapacity(trx, sponsor, PURCHASED));
  const resize = (seats: number, expectedSeats: number, allocationId = seatId) =>
    resizeCoManagedSeatAllocation(db, sponsor, { allocationId, seats, expectedSeats, countCommittedSeats });
  const release = (allocationId = seatId) => releaseCoManagedSeatAllocation(db, sponsor, { allocationId });

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's4_seat_allocation_test' });
    sponsor = await createTenant(db, 'Seat pool sponsor', { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: SUBSCRIPTION, capacity: PURCHASED,
      verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
    const [w, s] = [workspace(3), seat(4)];
    await db(TABLE).insert([w, s]);
    workspaceId = w.allocation_id; seatId = s.allocation_id;
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('refuses a reduction below the committed seats and leaves the allocation as it was', async () => {
    await expect(resize(2, 4)).rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
    expect(await row(seatId)).toMatchObject({ seats: 4, state: 'active' });
    // The count was asked of this allocation, at its current size.
    expect(counted).toEqual([{ allocation_id: seatId, seats: 4 }]);
  });

  it('lowers a seat allocation down to its committed seats, returning the difference to the pool', async () => {
    await resize(3, 4);
    expect(await row(seatId)).toMatchObject({ seats: 3 });
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 6, available: 4, byKind: { workspace: 3, seat: 3 } });
  });

  it('refuses a raise beyond what the pool has available, counting the workspace allocation too', async () => {
    // 5 more seats are asked for; the workspace allocation leaves only 4.
    await expect(resize(8, 3)).rejects.toMatchObject({ code: 'CO_MANAGED_POOL_LIMIT' });
    expect(await row(seatId)).toMatchObject({ seats: 3 });
  });

  it('raises a seat allocation within available capacity, up to exactly what is left', async () => {
    await resize(7, 3);
    expect(await row(seatId)).toMatchObject({ seats: 7 });
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 10, available: 0, byKind: { workspace: 3, seat: 7 } });
    await expect(resize(8, 7)).rejects.toMatchObject({ code: 'CO_MANAGED_POOL_LIMIT' });
  });

  it('treats a stale size, a workspace allocation and an unknown allocation as a conflict', async () => {
    await expect(resize(6, 4)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
    await expect(resize(2, 3, workspaceId)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
    await expect(resize(2, 3, randomUUID())).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
    await expect(release(workspaceId)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
    expect(await row(workspaceId)).toMatchObject({ seats: 3, state: 'active', released_at: null });
    expect(await row(seatId)).toMatchObject({ seats: 7 });
  });

  it('refuses a pool purchase below the seats allocated across both kinds', async () => {
    const unreachable = async () => { throw new Error('the provider must not be reached'); };
    const purchase = (quantity: number) => runCoManagedPurchase(db, { sponsorTenant: sponsor, operationId: randomUUID(), quantity }, unreachable);
    // 9 is one short of workspace 3 + seat 7.
    await expect(purchase(9)).rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });
    // Either kind alone would fit in 7; together they do not.
    await expect(purchase(7)).rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });
    expect(await db('co_managed_purchase_operations').where({ tenant: sponsor }).first()).toBeUndefined();
    expect(await db('co_managed_entitlements').where({ tenant: sponsor }).first()).toMatchObject({ capacity: PURCHASED, lapse_started_at: null });
  });

  it('releases a seat allocation, returning exactly its seats to the pool', async () => {
    expect(await release()).toEqual({ released: true, seats: 7 });
    const released = await row(seatId);
    expect(released).toMatchObject({ state: 'released', seats: 7 });
    expect(released.released_at).not.toBeNull();
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 3, available: 7, byKind: { workspace: 3, seat: 0 } });
  });

  it('a replayed release changes nothing', async () => {
    const before = await row(seatId);
    expect(await release()).toEqual({ released: false, seats: 0 });
    expect(await release()).toEqual({ released: false, seats: 0 });
    expect(await row(seatId)).toEqual(before);
    expect(await reading()).toEqual({ purchased: PURCHASED, allocated: 3, available: 7, byKind: { workspace: 3, seat: 0 } });
    // A released allocation cannot be resized back into the pool.
    await expect(resize(1, 7)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
  });

  it('two releases racing each other return the seats once', async () => {
    const racing = seat(2);
    await db(TABLE).insert(racing);
    expect((await reading()).allocated).toBe(5);
    const results = await Promise.all([release(racing.allocation_id), release(racing.allocation_id), release(racing.allocation_id)]);
    expect(results.filter((result) => result.released)).toEqual([{ released: true, seats: 2 }]);
    expect((await reading()).allocated).toBe(3);
  });

  it('a purchase down to exactly what both kinds hold goes through', async () => {
    const held = seat(4);
    await db(TABLE).insert(held);
    const result = await runCoManagedPurchase(db, { sponsorTenant: sponsor, operationId: randomUUID(), quantity: 7 },
      async () => ({ kind: 'updated', subscriptionId: SUBSCRIPTION }));
    expect(result).toEqual({ kind: 'updated', subscriptionId: SUBSCRIPTION });
    expect(await getCoManagedEntitlementState(db, sponsor)).toMatchObject({
      capacity: 7, allocated: 7, available: 0, isReadOnly: false, graceEndsAt: null });
  });
});
