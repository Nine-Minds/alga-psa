/**
 * Co-managed seat and workspace shapes, slice S5 (F012–F015 / T008, T014) on real Postgres.
 *
 * Enabling the seat shape for a client is one command: the allocation and the arrangement are
 * written together or not at all, a replay by operation id returns the same arrangement, and an
 * inactive client or one that already has a live arrangement of either shape is refused. An
 * arrangement's board scope is the whole of its ticket access: no boards, no access; a board
 * without the create flag admits work on its tickets and refuses new ones.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  coManagedSeatBoardAccess, createCoManagedSeatArrangement, readCoManagedSeatBoardScope, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import {
  readCoManagedPoolCapacity, reserveAndActivateCoManagedSeatAllocation, reserveCoManagedWorkspace,
} from '@alga-psa/licensing';
import { tenantDeletionOrder } from '@alga-psa/db';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const SEAT_TABLES = ['co_managed_seat_arrangements', 'co_managed_seat_board_scopes',
  'co_managed_seat_assignments', 'co_managed_seat_project_grants'];
const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('co-managed seat arrangements and their board scope', { shuffle: false }, () => {
  let db: Knex;

  const sponsorWithPool = async (capacity: number) => {
    const sponsor = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return sponsor;
  };
  const client = (sponsor: string, options: { is_inactive?: boolean } = {}) =>
    createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`, options);
  const board = async (tenant: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    return boardId;
  };
  const arrange = (sponsorTenant: string, clientId: string, seats: number, operationId: string = randomUUID()) =>
    createCoManagedSeatArrangement(db, { sponsorTenant, clientId, operationId, seats });
  const arrangements = (sponsor: string) => db('co_managed_seat_arrangements').where({ tenant: sponsor }).orderBy('created_at');
  const allocations = (sponsor: string) => db('co_managed_allocations').where({ tenant: sponsor }).orderBy('created_at');
  const reading = (sponsor: string, purchased: number) => db.transaction((trx) => readCoManagedPoolCapacity(trx, sponsor, purchased));
  const scopeOf = (sponsorTenant: string, arrangementId: string) => readCoManagedSeatBoardScope(db, { sponsorTenant, arrangementId });
  const byBoard = <T extends { boardId: string }>(entries: T[]) => [...entries].sort((a, b) => a.boardId.localeCompare(b.boardId));

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's5_seat_arrangement_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // F012
  it('the seat tables have tenant-first keys, only the resolver-membership and seat-reader foreign keys, no triggers but the seat-reader marker pair, and tenant deletion knows them', async () => {
    for (const table of SEAT_TABLES) {
      const { rows: keys } = await db.raw(`
        SELECT i.indexrelid::regclass::text AS name, (SELECT attname FROM pg_attribute
          WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) AS leading
        FROM pg_index i WHERE i.indrelid = ?::regclass AND (i.indisprimary OR i.indisunique)`, [table]);
      expect(keys.length, table).toBeGreaterThan(0);
      for (const key of keys) expect(key.leading, `${table}.${key.name}`).toBe('tenant');
      // The foreign keys' own constraint triggers are internal. The one pair of row triggers keeps
      // `users.seat_reader` in step on plain Postgres (S18, migration 20261113130000); no command
      // may rely on it, because Citus has no triggers on a distributed table.
      const { rows: triggers } = await db.raw(`SELECT tgname FROM pg_trigger WHERE tgrelid = ?::regclass AND NOT tgisinternal ORDER BY tgname`, [table]);
      expect(triggers.map((row: { tgname: string }) => row.tgname), table).toEqual(table === 'co_managed_seat_assignments'
        ? ['co_managed_seat_assignment_marks_reader', 'co_managed_seat_assignment_unmarks_reader'] : []);
      const { rows: foreignKeys } = await db.raw(`
        SELECT conname, confrelid::regclass::text AS parent, convalidated
        FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'f' ORDER BY conname`, [table]);
      expect(foreignKeys, table).toEqual(table === 'co_managed_seat_assignments' ? [
        { conname: 'co_managed_seat_assignment_resolver_subject_fk', parent: 'authorization_resolver_subjects', convalidated: true },
        { conname: 'co_managed_seat_assignments_seat_reader_foreign', parent: 'users', convalidated: true },
      ] : []);
    }
    const order = tenantDeletionOrder();
    for (const table of SEAT_TABLES) {
      expect(order, table).toContain(table);
      // A seat row is deleted before the allocation it hangs off.
      expect(order.indexOf(table), table).toBeLessThan(order.indexOf('co_managed_allocations'));
    }
  });

  it('deletes seat data in manifest order without violating resolver membership or affecting another tenant', async () => {
    const seed = async () => {
      const tenant = await sponsorWithPool(2);
      const arrangement = await arrange(tenant, await client(tenant), 1);
      const userId = await createUser(db, tenant, { user_type: 'internal' });
      await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id,
        boards: [{ boardId: await board(tenant), canCreate: true }] });
      await db('co_managed_seat_project_grants').insert({ tenant, arrangement_id: arrangement.arrangement_id, project_id: randomUUID() });
      await db.transaction(async (trx) => {
        await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
        await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(),
          arrangement_id: arrangement.arrangement_id, user_id: userId, state: 'active' });
      });
      return tenant;
    };
    const tenant = await seed();
    const survivor = await seed();
    const tables = [...SEAT_TABLES, 'co_managed_allocations', 'authorization_resolver_subjects'];
    const order = tenantDeletionOrder().filter((table) => tables.includes(table));

    await db.transaction(async (trx) => {
      for (const table of order) await trx(table).where({ tenant }).delete();
    });

    for (const table of tables) {
      expect(await db(table).where({ tenant }), table).toEqual([]);
      expect(await db(table).where({ tenant: survivor }), table).toHaveLength(1);
    }
  });

  // T008 / F013
  it('writes the allocation and the arrangement together, and the pool counts the seats', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    const operationId = randomUUID();

    const arrangement = await arrange(sponsor, clientId, 3, operationId);

    expect(arrangement).toEqual({ arrangement_id: expect.any(String), client_id: clientId, allocation_id: expect.any(String),
      seats: 3, state: 'active', revision: 1 });
    expect(await allocations(sponsor)).toEqual([expect.objectContaining({ allocation_id: arrangement.allocation_id,
      operation_id: operationId, allocation_kind: 'seat', sponsor_client_id: clientId, seats: 3, state: 'active' })]);
    expect(await arrangements(sponsor)).toEqual([expect.objectContaining({ arrangement_id: arrangement.arrangement_id,
      client_id: clientId, allocation_id: arrangement.allocation_id, state: 'active', ended_at: null,
      handoff_defaults: {}, settings: {}, revision: 1 })]);
    expect(await reading(sponsor, 10)).toMatchObject({ allocated: 3, available: 7, byKind: { workspace: 0, seat: 3 } });
    // A new arrangement has no boards, so it grants no ticket access yet.
    expect(await scopeOf(sponsor, arrangement.arrangement_id)).toEqual([]);
  });

  // T008 / F013
  it('is atomic: when the arrangement cannot be written, the allocation is not taken either', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    // A live arrangement row with no live allocation behind it: the reservation admits the client,
    // then the arrangement insert collides with the one-live-arrangement index.
    await db('co_managed_seat_arrangements').insert({ tenant: sponsor, arrangement_id: randomUUID(),
      client_id: clientId, allocation_id: randomUUID() });

    await expect(arrange(sponsor, clientId, 2)).rejects.toMatchObject({ constraint: 'co_managed_one_live_seat_arrangement' });

    expect(await allocations(sponsor)).toHaveLength(0);
    expect(await arrangements(sponsor)).toHaveLength(1);
    expect(await reading(sponsor, 10)).toMatchObject({ allocated: 0, available: 10 });
  });

  // T008 / F013
  it('a replay returns the same arrangement, even after the client went inactive and the pool lapsed', async () => {
    const sponsor = await sponsorWithPool(4);
    const clientId = await client(sponsor);
    const operationId = randomUUID();
    const first = await arrange(sponsor, clientId, 3, operationId);

    expect(await arrange(sponsor, clientId, 3, operationId)).toEqual(first);
    await db('clients').where({ tenant: sponsor, client_id: clientId }).update({ is_inactive: true });
    await db('co_managed_entitlements').where({ tenant: sponsor }).update({ valid_until: new Date(Date.now() - DAY) });
    expect(await arrange(sponsor, clientId, 3, operationId)).toEqual(first);

    expect(await allocations(sponsor)).toHaveLength(1);
    expect(await arrangements(sponsor)).toHaveLength(1);
  });

  // T008 / F013
  it('refuses an operation id reused with different details, or one that took seats outside this command', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    const operationId = randomUUID();
    await arrange(sponsor, clientId, 2, operationId);
    await expect(arrange(sponsor, clientId, 3, operationId)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(arrange(sponsor, await client(sponsor), 2, operationId)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });

    const bare = await client(sponsor);
    const bareOperation = randomUUID();
    await reserveAndActivateCoManagedSeatAllocation(db, { sponsorTenant: sponsor, clientId: bare, operationId: bareOperation, seats: 1 });
    await expect(arrange(sponsor, bare, 1, bareOperation)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });

    expect(await allocations(sponsor)).toHaveLength(2);
    expect(await arrangements(sponsor)).toHaveLength(1);
  });

  // T008 / F014
  it('refuses an inactive client and leaves nothing behind', async () => {
    const sponsor = await sponsorWithPool(10);
    const inactive = await client(sponsor, { is_inactive: true });

    await expect(arrange(sponsor, inactive, 1)).rejects.toMatchObject({ name: 'CoManagedSeatArrangementError', code: 'CLIENT_INACTIVE' });

    expect(await allocations(sponsor)).toHaveLength(0);
    expect(await arrangements(sponsor)).toHaveLength(0);
    // Reactivated, the same client can be arranged.
    await db('clients').where({ tenant: sponsor, client_id: inactive }).update({ is_inactive: false });
    expect(await arrange(sponsor, inactive, 1)).toMatchObject({ client_id: inactive, state: 'active' });
  });

  // T008 / F014, F007
  it('refuses a client with a live workspace relationship, naming the workspace', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    await reserveCoManagedWorkspace(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 2, visibilityMode: 'board_scope' });

    await expect(arrange(sponsor, clientId, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'workspace' });

    expect(await allocations(sponsor)).toEqual([expect.objectContaining({ allocation_kind: 'workspace' })]);
    expect(await arrangements(sponsor)).toHaveLength(0);
    expect(await reading(sponsor, 10)).toMatchObject({ allocated: 2, byKind: { workspace: 2, seat: 0 } });
  });

  // T008 / F014, F007
  it('refuses a client with a live seat arrangement, naming the seat shape, and a workspace for that client too', async () => {
    const sponsor = await sponsorWithPool(10);
    const clientId = await client(sponsor);
    const held = await arrange(sponsor, clientId, 2);

    await expect(arrange(sponsor, clientId, 1)).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'seat' });
    await expect(reserveCoManagedWorkspace(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 1,
      visibilityMode: 'board_scope' })).rejects.toMatchObject({ code: 'CLIENT_HAS_ARRANGEMENT', existingKind: 'seat' });

    expect(await allocations(sponsor)).toHaveLength(1);
    expect(await arrangements(sponsor)).toEqual([expect.objectContaining({ arrangement_id: held.arrangement_id })]);
  });

  // T008 / F013: the reservation's own refusals pass through and leave nothing behind.
  it('refuses for a pool without the seats, an unknown client and a malformed request, writing nothing', async () => {
    const sponsor = await sponsorWithPool(2);
    await expect(arrange(sponsor, await client(sponsor), 3)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    await expect(arrange(sponsor, randomUUID(), 1)).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(arrange(sponsor, 'not-a-uuid', 1)).rejects.toMatchObject({ code: 'INVALID_RESERVATION' });
    await expect(arrange(sponsor, await client(sponsor), 0)).rejects.toMatchObject({ code: 'INVALID_RESERVATION' });
    const noPool = await createTenant(db, 'No pool', { productCode: 'psa' });
    await expect(arrange(noPool, await client(noPool), 1)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });

    expect(await allocations(sponsor)).toHaveLength(0);
    expect(await arrangements(sponsor)).toHaveLength(0);
  });

  // T014 / F015
  it('an empty board scope yields no ticket access', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, await client(sponsor), 1);
    const boardId = await board(sponsor);

    const empty = await scopeOf(sponsor, arrangement.arrangement_id);
    expect(empty).toEqual([]);
    expect(coManagedSeatBoardAccess(empty, boardId)).toBe('none');

    // Scoped, then emptied again: access goes with the rows.
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id,
      boards: [{ boardId, canCreate: true }] });
    expect(coManagedSeatBoardAccess(await scopeOf(sponsor, arrangement.arrangement_id), boardId)).toBe('create');
    expect(await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [] })).toEqual([]);
    expect(await db('co_managed_seat_board_scopes').where({ tenant: sponsor })).toHaveLength(0);
    expect(coManagedSeatBoardAccess(await scopeOf(sponsor, arrangement.arrangement_id), boardId)).toBe('none');
  });

  // T014 / F015
  it('a board marked no-create admits work and refuses ticket creation; a board out of scope admits neither', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, await client(sponsor), 1);
    const [creatable, workOnly, outOfScope] = [await board(sponsor), await board(sponsor), await board(sponsor)];

    const set = await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id,
      boards: [{ boardId: creatable, canCreate: true }, { boardId: workOnly, canCreate: false }] });

    const scope = await scopeOf(sponsor, arrangement.arrangement_id);
    expect(scope).toEqual(set);
    expect(scope).toEqual(byBoard([{ boardId: creatable, canCreate: true }, { boardId: workOnly, canCreate: false }]));
    expect(coManagedSeatBoardAccess(scope, creatable)).toBe('create');
    expect(coManagedSeatBoardAccess(scope, workOnly)).toBe('work');
    expect(coManagedSeatBoardAccess(scope, outOfScope)).toBe('none');
  });

  // F015
  it('setting the scope replaces it exactly: flags flip, unlisted boards leave, and a repeat changes nothing', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, await client(sponsor), 1);
    const other = await arrange(sponsor, await client(sponsor), 1);
    const [a, b, c] = [await board(sponsor), await board(sponsor), await board(sponsor)];
    const set = (boards: Array<{ boardId: string; canCreate: boolean }>, arrangementId = arrangement.arrangement_id) =>
      setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId, boards });

    await set([{ boardId: a, canCreate: true }, { boardId: b, canCreate: false }]);
    await set([{ boardId: c, canCreate: true }], other.arrangement_id);
    const next = [{ boardId: b, canCreate: true }, { boardId: c, canCreate: false }];
    expect(await set(next)).toEqual(byBoard(next));
    expect(await set(next)).toEqual(byBoard(next));

    expect(await scopeOf(sponsor, arrangement.arrangement_id)).toEqual(byBoard(next));
    // Another arrangement's scope is its own.
    expect(await scopeOf(sponsor, other.arrangement_id)).toEqual([{ boardId: c, canCreate: true }]);
    // Each change to the scope moves the arrangement's revision.
    expect((await arrangements(sponsor)).find((row) => row.arrangement_id === arrangement.arrangement_id)).toMatchObject({ revision: 4 });
  });

  // F015
  it('refuses a board of another tenant, a board listed twice, an unknown arrangement and an ended one', async () => {
    const sponsor = await sponsorWithPool(10);
    const elsewhere = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, await client(sponsor), 1);
    const [mine, theirs] = [await board(sponsor), await board(elsewhere)];
    const set = (sponsorTenant: string, arrangementId: string, boards: Array<{ boardId: string; canCreate: boolean }>) =>
      setCoManagedSeatBoardScope(db, { sponsorTenant, arrangementId, boards });
    await set(sponsor, arrangement.arrangement_id, [{ boardId: mine, canCreate: true }]);

    await expect(set(sponsor, arrangement.arrangement_id, [{ boardId: mine, canCreate: true }, { boardId: theirs, canCreate: true }]))
      .rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    await expect(set(sponsor, arrangement.arrangement_id, [{ boardId: mine, canCreate: true }, { boardId: mine, canCreate: false }]))
      .rejects.toMatchObject({ code: 'INVALID_BOARD_SCOPE' });
    await expect(set(sponsor, randomUUID(), [])).rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
    // Another tenant cannot reach the arrangement, to write it or to read it.
    await expect(set(elsewhere, arrangement.arrangement_id, [])).rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
    expect(await scopeOf(elsewhere, arrangement.arrangement_id)).toEqual([]);
    // Every refusal left the scope as it was.
    expect(await scopeOf(sponsor, arrangement.arrangement_id)).toEqual([{ boardId: mine, canCreate: true }]);

    // An ended arrangement keeps its rows and grants nothing.
    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id })
      .update({ state: 'ended', ended_at: new Date() });
    await expect(set(sponsor, arrangement.arrangement_id, [])).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });
    expect(await db('co_managed_seat_board_scopes').where({ tenant: sponsor })).toHaveLength(1);
    expect(await scopeOf(sponsor, arrangement.arrangement_id)).toEqual([]);
  });
});
