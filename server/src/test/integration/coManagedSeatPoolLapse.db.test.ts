/**
 * Co-managed seat and workspace shapes, slice S4 (F011 / T007) on real Postgres.
 *
 * The lapse belongs to the pool. A pool that holds only seat allocations and falls below what
 * they hold starts the same grace window, on the same deadline, as a pool that holds only a
 * workspace allocation, and turns read-only when that deadline passes. The clock is the durable
 * `lapse_started_at` column; nothing here waits.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  GRACE_MS, getCoManagedEntitlementState, readCoManagedSeatAllocationState, releaseCoManagedSeatAllocation,
  resizeCoManagedSeatAllocation,
} from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant } from '../../../test-utils/testDataFactory';

const TABLE = 'co_managed_allocations';
const describeDb = await describeWithDb();

describeDb('a seat-only pool lapses on the deadlines of a workspace pool', { shuffle: false }, () => {
  let db: Knex; let seatPool: string; let workspacePool: string; let seatId: string; let reservedSeatId: string;

  const base = (tenant: string, seats: number, state = 'active') => ({
    tenant, allocation_id: randomUUID(), operation_id: randomUUID(),
    request_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'), seats, state,
  });
  const entitlement = (tenant: string) => db('co_managed_entitlements').where({ tenant }).first();
  const setEntitlement = (tenant: string, change: Record<string, unknown>) => db('co_managed_entitlements').where({ tenant }).update(change);
  const seatState = (allocationId = seatId) => db.transaction((trx) => readCoManagedSeatAllocationState(trx, seatPool, allocationId));
  const time = (value: unknown) => new Date(value as string).getTime();

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's4_seat_pool_lapse_test' });
    seatPool = await createTenant(db, 'Seat-only sponsor', { productCode: 'psa' });
    workspacePool = await createTenant(db, 'Workspace-only sponsor', { productCode: 'psa' });
    for (const tenant of [seatPool, workspacePool]) {
      await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${tenant.slice(0, 8)}`, capacity: 5,
        verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
    }
    // The same five seats on each pool: one as a workspace, one split over two seat allocations.
    const [first, second] = [base(seatPool, 3), base(seatPool, 2, 'reserved')];
    await db(TABLE).insert([first, second].map((row) => ({ ...row, allocation_kind: 'seat', sponsor_client_id: randomUUID() })));
    await db(TABLE).insert({ ...base(workspacePool, 5), customer_tenant: randomUUID(), relationship_id: randomUUID() });
    seatId = first.allocation_id; reservedSeatId = second.allocation_id;
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('a healthy seat-only pool has no lapse and its active seat allocation is writable', async () => {
    expect(await getCoManagedEntitlementState(db, seatPool)).toMatchObject({ capacity: 5, allocated: 5, isReadOnly: false, graceEndsAt: null });
    expect(await seatState()).toEqual({ state: 'active', canWrite: true, graceEndsAt: null });
    expect(await seatState(reservedSeatId)).toEqual({ state: 'pending_acceptance', canWrite: false, graceEndsAt: null });
    expect(await seatState(randomUUID())).toEqual({ state: 'terminated', canWrite: false, graceEndsAt: null });
  });

  it('capacity below allocated starts grace on a seat-only pool exactly as on a workspace pool', async () => {
    const before = Date.now();
    for (const tenant of [seatPool, workspacePool]) await setEntitlement(tenant, { capacity: 4 });
    const seats = await getCoManagedEntitlementState(db, seatPool);
    const workspaces = await getCoManagedEntitlementState(db, workspacePool);

    // Both kinds are counted: the reserved seat allocation is what puts the seat pool over.
    expect(seats).toMatchObject({ capacity: 4, allocated: 5, available: 0, canGrow: false, isReadOnly: false });
    expect(workspaces).toMatchObject({ capacity: 4, allocated: 5, available: 0, canGrow: false, isReadOnly: false });
    for (const [tenant, state] of [[seatPool, seats], [workspacePool, workspaces]] as const) {
      const row = await entitlement(tenant);
      expect(time(row.lapse_started_at)).toBeGreaterThanOrEqual(before - 5_000);
      expect(time(row.read_only_after) - time(row.lapse_started_at)).toBe(GRACE_MS);
      expect(state.graceEndsAt).toBe(new Date(row.read_only_after).toISOString());
    }
    expect(await seatState()).toEqual({ state: 'grace', canWrite: true, graceEndsAt: seats.graceEndsAt });
  });

  it('the grace clock does not restart on a later reading', async () => {
    const started = (await entitlement(seatPool)).lapse_started_at;
    await getCoManagedEntitlementState(db, seatPool);
    await seatState();
    expect(time((await entitlement(seatPool)).lapse_started_at)).toBe(time(started));
  });

  it('a seat allocation cannot be raised while the pool is lapsed, but can still be lowered', async () => {
    const noneCommitted = async () => 0;
    const resize = (seats: number, expectedSeats: number) =>
      resizeCoManagedSeatAllocation(db, seatPool, { allocationId: seatId, seats, expectedSeats, countCommittedSeats: noneCommitted });
    const started = (await entitlement(seatPool)).lapse_started_at;
    await expect(resize(4, 3)).rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
    expect(await db(TABLE).where({ tenant: seatPool, allocation_id: seatId }).first()).toMatchObject({ seats: 3 });

    // Giving a seat back is allowed. The pool is still one over a capacity of 3, so the clock keeps running.
    await setEntitlement(seatPool, { capacity: 3 });
    await resize(2, 3);
    expect(await db(TABLE).where({ tenant: seatPool, allocation_id: seatId }).first()).toMatchObject({ seats: 2 });
    expect(await getCoManagedEntitlementState(db, seatPool)).toMatchObject({ capacity: 3, allocated: 4, isReadOnly: false });
    expect(time((await entitlement(seatPool)).lapse_started_at)).toBe(time(started));
  });

  it('with one lapse instant, the seat pool and the workspace pool share one deadline and turn read-only together', async () => {
    const lapsedAt = new Date(Date.now() - GRACE_MS + 3_600_000); // an hour of grace left
    for (const tenant of [seatPool, workspacePool]) {
      await setEntitlement(tenant, { lapse_started_at: lapsedAt, read_only_after: new Date(lapsedAt.getTime() + GRACE_MS) });
    }
    const deadline = new Date(lapsedAt.getTime() + GRACE_MS).toISOString();
    expect(await getCoManagedEntitlementState(db, seatPool)).toMatchObject({ isReadOnly: false, graceEndsAt: deadline });
    expect(await getCoManagedEntitlementState(db, workspacePool)).toMatchObject({ isReadOnly: false, graceEndsAt: deadline });
    expect(await seatState()).toEqual({ state: 'grace', canWrite: true, graceEndsAt: deadline });

    // The deadline passes: move the durable lapse instant back, never wait.
    const expiredAt = new Date(Date.now() - GRACE_MS - 1_000);
    for (const tenant of [seatPool, workspacePool]) {
      await setEntitlement(tenant, { lapse_started_at: expiredAt, read_only_after: new Date(expiredAt.getTime() + GRACE_MS) });
    }
    const passed = new Date(expiredAt.getTime() + GRACE_MS).toISOString();
    expect(await getCoManagedEntitlementState(db, seatPool)).toMatchObject({ isReadOnly: true, graceEndsAt: passed });
    expect(await getCoManagedEntitlementState(db, workspacePool)).toMatchObject({ isReadOnly: true, graceEndsAt: passed });
    expect(await seatState()).toEqual({ state: 'read_only', canWrite: false, graceEndsAt: passed });
  });

  it('an expired entitlement lapses both pools at its expiry, on one deadline', async () => {
    const expiry = new Date(Date.now() - 86_400_000);
    for (const tenant of [seatPool, workspacePool]) {
      await setEntitlement(tenant, { capacity: 5, valid_until: expiry, lapse_started_at: null, read_only_after: null });
    }
    const deadline = new Date(expiry.getTime() + GRACE_MS).toISOString();
    expect(await getCoManagedEntitlementState(db, seatPool)).toMatchObject({ capacity: 0, allocated: 4, isReadOnly: false, graceEndsAt: deadline });
    expect(await getCoManagedEntitlementState(db, workspacePool)).toMatchObject({ capacity: 0, allocated: 5, isReadOnly: false, graceEndsAt: deadline });
    expect(await seatState()).toEqual({ state: 'grace', canWrite: true, graceEndsAt: deadline });
  });

  it('releasing seat allocations until the pool fits ends the lapse', async () => {
    await setEntitlement(seatPool, { capacity: 3, valid_until: new Date(Date.now() + 365 * 86_400_000), lapse_started_at: null, read_only_after: null });
    expect((await getCoManagedEntitlementState(db, seatPool)).graceEndsAt).not.toBeNull();
    expect(await releaseCoManagedSeatAllocation(db, seatPool, { allocationId: reservedSeatId })).toEqual({ released: true, seats: 2 });
    // The release itself clears the durable lapse; no later reading is needed.
    expect(await entitlement(seatPool)).toMatchObject({ lapse_started_at: null, read_only_after: null });
    expect(await seatState()).toEqual({ state: 'active', canWrite: true, graceEndsAt: null });
    expect(await seatState(reservedSeatId)).toEqual({ state: 'terminated', canWrite: false, graceEndsAt: null });
  });
});
