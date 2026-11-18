/**
 * Co-managed seat and workspace shapes, slice S3 (F005–F007 / T004, T005) on real Postgres.
 *
 * Taking seats for one of the sponsor's own clients is one command: the allocation is reserved
 * and active when it returns, a replay by operation id returns the same allocation, and every
 * refusal names its reason. A client holds one live allocation, of either kind, and the pool is
 * never over-allocated however a seat request and a workspace request race.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  readCoManagedPoolCapacity, reserveAndActivateCoManagedSeatAllocation, reserveCoManagedWorkspace,
} from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant } from '../../../test-utils/testDataFactory';

const TABLE = 'co_managed_allocations';
const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('reserve and activate a co-managed seat allocation', { shuffle: false }, () => {
  let db: Knex;

  /** A sponsor with a verified hosted pool of `capacity` seats, valid for `validForDays` from now. */
  const sponsorWithPool = async (capacity: number, validForDays = 365) => {
    const sponsor = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + validForDays * DAY) });
    return sponsor;
  };
  const client = (sponsor: string) => createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
  const seat = (sponsorTenant: string, clientId: string, seats: number, operationId: string = randomUUID(), on: Knex = db) =>
    reserveAndActivateCoManagedSeatAllocation(on, { sponsorTenant, clientId, operationId, seats });
  const workspace = (sponsorTenant: string, clientId: string, seats: number, operationId: string = randomUUID(), on: Knex = db) =>
    reserveCoManagedWorkspace(on, { sponsorTenant, clientId, operationId, seats, visibilityMode: 'board_scope' });
  const rows = (sponsor: string) => db(TABLE).where({ tenant: sponsor }).orderBy('created_at');
  const reading = (sponsor: string, purchased: number) => db.transaction((trx) => readCoManagedPoolCapacity(trx, sponsor, purchased));
  const release = (sponsor: string, allocationId: string) => db(TABLE).where({ tenant: sponsor, allocation_id: allocationId })
    .update({ state: 'released', released_at: new Date() });

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's3_seat_reservation_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('takes the seats in one step: the allocation is active, of kind seat, and counted by the pool', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    const operationId = randomUUID();

    const allocation = await seat(sponsor, clientId, 3, operationId);

    expect(allocation).toEqual({ allocation_id: expect.any(String), operation_id: operationId, sponsor_client_id: clientId, seats: 3, state: 'active' });
    expect(await rows(sponsor)).toEqual([expect.objectContaining({ allocation_id: allocation.allocation_id, allocation_kind: 'seat',
      sponsor_client_id: clientId, customer_tenant: null, relationship_id: null, seats: 3, state: 'active', released_at: null })]);
    expect(await reading(sponsor, 10)).toEqual({ purchased: 10, allocated: 3, available: 7, byKind: { workspace: 0, seat: 3 } });
  });

  it('a replay by operation id returns the original allocation, even after the pool has filled and lapsed', async () => {
    const sponsor = await sponsorWithPool(4);
    const clientId = await client(sponsor);
    const operationId = randomUUID();
    const first = await seat(sponsor, clientId, 3, operationId);

    expect(await seat(sponsor, clientId, 3, operationId)).toEqual(first);
    // Fill the pool, then let it lapse: neither may turn a replay into a refusal or a second row.
    await seat(sponsor, await client(sponsor), 1);
    expect(await seat(sponsor, clientId, 3, operationId)).toEqual(first);
    await db('co_managed_entitlements').where({ tenant: sponsor }).update({ valid_until: new Date(Date.now() - DAY) });
    expect(await seat(sponsor, clientId, 3, operationId)).toEqual(first);

    expect((await rows(sponsor)).filter((row) => row.operation_id === operationId)).toHaveLength(1);
  });

  it('refuses an operation id reused with different details, or across kinds', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    const seatOperation = randomUUID();
    await seat(sponsor, clientId, 2, seatOperation);
    const workspaceOperation = randomUUID();
    const otherClient = await client(sponsor);
    await workspace(sponsor, otherClient, 2, workspaceOperation);

    await expect(seat(sponsor, clientId, 3, seatOperation)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(seat(sponsor, await client(sponsor), 2, seatOperation)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(seat(sponsor, otherClient, 2, workspaceOperation)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(workspace(sponsor, clientId, 2, seatOperation)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(await rows(sponsor)).toHaveLength(2);
  });

  it('refuses a malformed request before touching the pool', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    for (const seats of [0, -1, 1.5, 2147483648]) {
      await expect(seat(sponsor, clientId, seats)).rejects.toMatchObject({ code: 'INVALID_RESERVATION' });
    }
    await expect(seat(sponsor, 'not-a-uuid', 1)).rejects.toMatchObject({ code: 'INVALID_RESERVATION' });
    expect(await rows(sponsor)).toHaveLength(0);
  });

  it('refuses for insufficient capacity, and admits exactly what is left', async () => {
    const sponsor = await sponsorWithPool(5);
    await seat(sponsor, await client(sponsor), 3);
    const clientId = await client(sponsor);

    await expect(seat(sponsor, clientId, 3)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(await rows(sponsor)).toHaveLength(1);
    expect(await seat(sponsor, clientId, 2)).toMatchObject({ seats: 2, state: 'active' });
    expect(await reading(sponsor, 5)).toMatchObject({ allocated: 5, available: 0 });
    // No pool at all is no capacity.
    const noPool = await createTenant(db, 'No pool', { productCode: 'psa' });
    await expect(seat(noPool, await client(noPool), 1)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
  });

  it('refuses an ineligible sponsor: not on Pro, suspended, or itself a co-managed customer', async () => {
    const offPro = await sponsorWithPool(10);
    await db('tenants').where({ tenant: offPro }).update({ plan: 'solo' });
    await expect(seat(offPro, await client(offPro), 1)).rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });

    const suspended = await sponsorWithPool(10);
    await db('tenants').where({ tenant: suspended }).update({ suspended_at: new Date(), suspended_reason: 'tenant_cancelled' });
    await expect(seat(suspended, await client(suspended), 1)).rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });

    const customer = await sponsorWithPool(10);
    await db('co_management_relationships').insert({ tenant: customer, relationship_id: randomUUID(),
      sponsor_tenant: randomUUID(), sponsor_client_id: randomUUID(), state: 'provisioning' });
    await expect(seat(customer, await client(customer), 1)).rejects.toMatchObject({ code: 'SPONSOR_NOT_ELIGIBLE' });

    for (const sponsor of [offPro, suspended, customer]) expect(await rows(sponsor)).toHaveLength(0);
  });

  it('refuses while the pool is in lapse grace or read-only, and leaves the pool as it was', async () => {
    // Expired yesterday: inside the 30-day grace window.
    const inGrace = await sponsorWithPool(10, -1);
    await expect(seat(inGrace, await client(inGrace), 1)).rejects.toMatchObject({ code: 'ENTITLEMENT_LAPSED' });
    // Expired 40 days ago: past the window, read-only.
    const readOnly = await sponsorWithPool(10, -40);
    await expect(seat(readOnly, await client(readOnly), 1)).rejects.toMatchObject({ code: 'ENTITLEMENT_LAPSED' });
    // Over-allocated after a capacity cut: lapsed although the entitlement is still valid.
    const overAllocated = await sponsorWithPool(5);
    await seat(overAllocated, await client(overAllocated), 4);
    await db('co_managed_entitlements').where({ tenant: overAllocated }).update({ capacity: 2 });
    await expect(seat(overAllocated, await client(overAllocated), 1)).rejects.toMatchObject({ code: 'ENTITLEMENT_LAPSED' });

    expect(await rows(inGrace)).toHaveLength(0);
    expect(await rows(readOnly)).toHaveLength(0);
    expect(await rows(overAllocated)).toHaveLength(1);
  });

  it('refuses a client the sponsor does not have', async () => {
    const sponsor = await sponsorWithPool(10);
    const elsewhere = await sponsorWithPool(10);
    await expect(seat(sponsor, randomUUID(), 1)).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(seat(sponsor, await client(elsewhere), 1)).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    expect(await rows(sponsor)).toHaveLength(0);
  });

  it('a client holds one live allocation of either kind; the refusal names the existing shape', async () => {
    const sponsor = await sponsorWithPool(20);

    const seated = await client(sponsor);
    const held = await seat(sponsor, seated, 2);
    await expect(seat(sponsor, seated, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'seat' });
    await expect(workspace(sponsor, seated, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'seat' });

    const inWorkspace = await client(sponsor);
    const reserved = await workspace(sponsor, inWorkspace, 2);
    expect(await db(TABLE).where({ tenant: sponsor, allocation_id: reserved.allocation_id }).first())
      .toMatchObject({ allocation_kind: 'workspace', sponsor_client_id: inWorkspace });
    await expect(seat(sponsor, inWorkspace, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'workspace' });
    await expect(workspace(sponsor, inWorkspace, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'workspace' });

    // A workspace allocation written before the row carried its client names it on the relationship only.
    const legacy = await client(sponsor);
    const customerTenant = randomUUID(); const relationshipId = randomUUID();
    await db('co_management_relationships').insert({ tenant: customerTenant, relationship_id: relationshipId,
      sponsor_tenant: sponsor, sponsor_client_id: legacy, state: 'provisioning' });
    await db(TABLE).insert({ tenant: sponsor, allocation_id: randomUUID(), operation_id: randomUUID(),
      request_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
      customer_tenant: customerTenant, relationship_id: relationshipId, seats: 1, state: 'active' });
    await expect(seat(sponsor, legacy, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'workspace' });

    expect(await reading(sponsor, 20)).toMatchObject({ allocated: 5, byKind: { workspace: 3, seat: 2 } });
    // Only a live allocation holds the client: once released, the client can be seated again.
    await release(sponsor, held.allocation_id);
    expect(await seat(sponsor, seated, 1)).toMatchObject({ sponsor_client_id: seated, state: 'active' });
  });

  /** Runs both requests so that each is already waiting on the pool lock before either may proceed. */
  const race = async (sponsor: string, contenders: Array<() => Promise<unknown>>) => {
    const waiting = async () => Number((await db.raw(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].n);
    let outcomes!: Promise<PromiseSettledResult<unknown>[]>;
    await db.transaction(async (holder) => {
      await holder('co_managed_entitlements').where({ tenant: sponsor }).forUpdate().first();
      outcomes = Promise.allSettled(contenders.map((run) => run()));
      const deadline = Date.now() + 15_000;
      while (await waiting() < contenders.length) {
        if (Date.now() > deadline) throw new Error('the contenders never reached the pool lock');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    return outcomes;
  };

  it('with one seat available, a seat request and a workspace request race and exactly one succeeds', async () => {
    for (let round = 0; round < 6; round++) {
      const sponsor = await sponsorWithPool(3);
      await seat(sponsor, await client(sponsor), 2);
      expect(await reading(sponsor, 3)).toMatchObject({ available: 1 });
      const seatClient = await client(sponsor); const workspaceClient = await client(sponsor);
      // Alternate who asks first, so neither kind wins by its place in the queue alone.
      const contenders = [() => seat(sponsor, seatClient, 1), () => workspace(sponsor, workspaceClient, 1)];
      const outcomes = await race(sponsor, round % 2 ? contenders.reverse() : contenders);

      const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const lost = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
      const pool = await reading(sponsor, 3);
      expect(pool).toMatchObject({ allocated: 3, available: 0 });
      expect(pool.byKind.seat + pool.byKind.workspace).toBe(3);
      expect(await rows(sponsor)).toHaveLength(2);
    }
  }, 120_000);

  it('a seat request and a workspace request for the same client race and exactly one succeeds', async () => {
    for (let round = 0; round < 4; round++) {
      const sponsor = await sponsorWithPool(10);
      const clientId = await client(sponsor);
      const contenders = [() => seat(sponsor, clientId, 1), () => workspace(sponsor, clientId, 1)];
      const outcomes = await race(sponsor, round % 2 ? contenders.reverse() : contenders);

      const lost = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(lost).toHaveLength(1);
      const [winner] = await rows(sponsor);
      expect(await rows(sponsor)).toHaveLength(1);
      expect(lost[0].reason).toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: winner.allocation_kind });
    }
  }, 120_000);
});
