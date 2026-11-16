/**
 * Co-managed seat and workspace shapes, slice S23 (F054–F057 / T030) on real Postgres.
 *
 * A ticket of a client in a seat arrangement is the MSP's until it is handed to client IT, with no
 * row saying so. A handoff in either direction changes responsibility, carries a shared note and
 * leaves a receipt; a replay returns that receipt; a stale revision and an out-of-scope board are
 * refused. Handing to the MSP clears a technician assignee and applies the arrangement's defaults.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  coManagedSeatHandoffDefaults, createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt,
  handCoManagedSeatTicketToMsp, readCoManagedSeatTicketWork, recordCoManagedSeatTicketReassignment,
  setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { tenantDeletionOrder } from '@alga-psa/db';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const WORK_TABLES = ['co_managed_seat_ticket_work', 'co_managed_seat_ticket_handoffs'];
const DAY = 86_400_000;
const NOTE = 'Needs a firewall change we cannot make.';
const describeDb = await describeWithDb();

describeDb('co-managed seat ticket responsibility and handoff', { shuffle: false }, () => {
  let db: Knex;
  let ticketNumber = 0;

  /** A sponsor with one arranged client, a board in scope and one out of it, MSP staff and two technicians. */
  const world = async () => {
    const sponsor = await createTenant(db, `Handoff sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `Handoff client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 3 });
    const [inScope, outOfScope] = [await board(sponsor), await board(sponsor)];
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id,
      boards: [{ boardId: inScope, canCreate: true }] });
    const [staff, otherStaff] = [await createUser(db, sponsor), await createUser(db, sponsor)];
    const [technician, otherTechnician] = [await seat(sponsor, arrangement.arrangement_id), await seat(sponsor, arrangement.arrangement_id)];
    return { sponsor, clientId, arrangementId: arrangement.arrangement_id, inScope, outOfScope, staff, otherStaff, technician, otherTechnician };
  };
  type World = Awaited<ReturnType<typeof world>>;

  const board = async (tenant: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    return boardId;
  };
  const seat = async (tenant: string, arrangementId: string, state: 'invited' | 'active' | 'revoked' = 'active') => {
    const userId = await createUser(db, tenant);
    await db.transaction(async trx => {
      await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId,
        user_id: userId, state, revoked_at: state === 'revoked' ? new Date() : null });
    });
    return userId;
  };
  const ticket = async (w: World, options: { boardId?: string; clientId?: string; assignedTo?: string | null } = {}) => {
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: w.sponsor, ticket_id: ticketId, ticket_number: `S23-${++ticketNumber}`, title: 'Handoff ticket',
      client_id: options.clientId ?? w.clientId, board_id: options.boardId ?? w.inScope, assigned_to: options.assignedTo ?? null,
      entered_at: new Date(), updated_at: new Date() });
    return ticketId;
  };
  const request = (w: World, ticketId: string, actorUserId: string, expectedRevision: number, operationId: string = randomUUID()) =>
    ({ sponsorTenant: w.sponsor, ticketId, actorUserId, operationId, expectedRevision, note: NOTE });
  const toClientIt = (w: World, ticketId: string, expectedRevision: number, extra: { technicianUserId?: string; operationId?: string; note?: string } = {}) =>
    handCoManagedSeatTicketToClientIt(db, { ...request(w, ticketId, w.staff, expectedRevision, extra.operationId), ...extra });
  const toMsp = (w: World, ticketId: string, expectedRevision: number, extra: { operationId?: string; note?: string; actorUserId?: string } = {}) =>
    handCoManagedSeatTicketToMsp(db, { ...request(w, ticketId, extra.actorUserId ?? w.technician, expectedRevision, extra.operationId),
      ...(extra.note === undefined ? {} : { note: extra.note }) });
  const work = (w: World, ticketId: string) => readCoManagedSeatTicketWork(db, { sponsorTenant: w.sponsor, ticketId });
  const workRows = (w: World) => db('co_managed_seat_ticket_work').where({ tenant: w.sponsor });
  const receipts = (w: World) => db('co_managed_seat_ticket_handoffs').where({ tenant: w.sponsor }).orderBy('revision');
  const assignee = async (w: World, ticketId: string) =>
    (await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).first('assigned_to')).assigned_to;

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's23_seat_ticket_handoff_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('the work tables exist with tenant-first keys and no triggers or foreign keys, and tenant deletion knows them', async () => {
    const order = tenantDeletionOrder();
    for (const table of WORK_TABLES) {
      const { rows: keys } = await db.raw(`
        SELECT i.indexrelid::regclass::text AS name, (SELECT attname FROM pg_attribute
          WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) AS leading
        FROM pg_index i WHERE i.indrelid = ?::regclass`, [table]);
      expect(keys.length, table).toBeGreaterThan(0);
      for (const key of keys) expect(key.leading, `${table}.${key.name}`).toBe('tenant');
      const { rows: triggers } = await db.raw(`SELECT tgname FROM pg_trigger WHERE tgrelid = ?::regclass`, [table]);
      expect(triggers, table).toEqual([]);
      // A work row is deleted before the arrangement it was written under.
      expect(order.indexOf(table), table).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(table), table).toBeLessThan(order.indexOf('co_managed_seat_arrangements'));
    }
  });

  // T030 / F054
  it('an existing ticket of an arranged client is the MSP\'s at revision 0, with no row written', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.staff });

    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'msp', revision: 0 });
    expect(await workRows(w)).toHaveLength(0);
  });

  // T030 / F054
  it('a ticket of a client without a live arrangement has no responsibility and cannot be handed off', async () => {
    const w = await world();
    const elsewhere = await ticket(w, { clientId: await createClient(db, w.sponsor, 'No arrangement') });
    expect(await work(w, elsewhere)).toBeNull();
    await expect(toClientIt(w, elsewhere, 0)).rejects.toMatchObject({ name: 'CoManagedSeatHandoffError', code: 'NO_SEAT_ARRANGEMENT' });
    await expect(toClientIt(w, randomUUID(), 0)).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });

    // Ended: the ticket reads as having no responsibility again, and handoffs stop.
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0);
    await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId })
      .update({ state: 'ended', ended_at: new Date() });
    expect(await work(w, ticketId)).toBeNull();
    await expect(toMsp(w, ticketId, 1)).rejects.toMatchObject({ code: 'NO_SEAT_ARRANGEMENT' });
    // Another tenant reaches neither the ticket nor its work.
    const other = await world();
    expect(await readCoManagedSeatTicketWork(db, { sponsorTenant: other.sponsor, ticketId })).toBeNull();
  });

  // T030 / F056
  it('hand to client IT makes client IT responsible and stores a receipt; the assignee is left alone', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.otherStaff });
    const operationId = randomUUID();

    const receipt = await toClientIt(w, ticketId, 0, { operationId });

    expect(receipt).toEqual({ operationId, ticketId, arrangementId: w.arrangementId, from: 'msp', to: 'client_it', revision: 1,
      note: NOTE, actorUserId: w.staff, assignedTo: w.otherStaff, occurredAt: expect.any(String) });
    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'client_it', revision: 1 });
    expect(await receipts(w)).toEqual([expect.objectContaining({ operation_id: operationId, ticket_id: ticketId,
      arrangement_id: w.arrangementId, revision: 1, from_responsibility: 'msp', to_responsibility: 'client_it',
      note: NOTE, actor_user_id: w.staff, assigned_to: w.otherStaff, request_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(await assignee(w, ticketId)).toBe(w.otherStaff);
  });

  // T030 / F056
  it('hand to client IT assigns a named technician of the client, and refuses anyone else', async () => {
    const w = await world();
    const ticketId = await ticket(w);

    const stranger = await world();
    for (const technicianUserId of [w.staff, stranger.technician, await seat(w.sponsor, w.arrangementId, 'invited'),
      await seat(w.sponsor, w.arrangementId, 'revoked'), randomUUID()]) {
      await expect(toClientIt(w, ticketId, 0, { technicianUserId })).rejects.toMatchObject({ code: 'TECHNICIAN_NOT_AVAILABLE' });
    }
    const inactive = await seat(w.sponsor, w.arrangementId);
    await db('users').where({ tenant: w.sponsor, user_id: inactive }).update({ is_inactive: true });
    await expect(toClientIt(w, ticketId, 0, { technicianUserId: inactive })).rejects.toMatchObject({ code: 'TECHNICIAN_NOT_AVAILABLE' });
    expect(await workRows(w)).toHaveLength(0);

    const receipt = await toClientIt(w, ticketId, 0, { technicianUserId: w.technician });
    expect(receipt).toMatchObject({ to: 'client_it', assignedTo: w.technician });
    expect(await assignee(w, ticketId)).toBe(w.technician);
  });

  // T030 / F056
  it('hand to client IT is refused on a board outside the arrangement\'s scope', async () => {
    const w = await world();
    const ticketId = await ticket(w, { boardId: w.outOfScope });

    await expect(toClientIt(w, ticketId, 0)).rejects.toMatchObject({ code: 'BOARD_OUT_OF_SCOPE' });
    expect(await work(w, ticketId)).toMatchObject({ responsibility: 'msp', revision: 0 });
    expect(await receipts(w)).toHaveLength(0);

    // Brought into scope, the same ticket can be handed over; emptied, it cannot.
    await setCoManagedSeatBoardScope(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId,
      boards: [{ boardId: w.outOfScope, canCreate: false }] });
    expect(await toClientIt(w, ticketId, 0)).toMatchObject({ to: 'client_it', revision: 1 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId, boards: [] });
    await expect(toClientIt(w, await ticket(w), 0)).rejects.toMatchObject({ code: 'BOARD_OUT_OF_SCOPE' });
  });

  // T030 / F055
  it('hand to MSP makes the MSP responsible, clears the technician assignee and stores a receipt', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0, { technicianUserId: w.otherTechnician });
    const operationId = randomUUID();

    const receipt = await toMsp(w, ticketId, 1, { operationId });

    expect(receipt).toEqual({ operationId, ticketId, arrangementId: w.arrangementId, from: 'client_it', to: 'msp', revision: 2,
      note: NOTE, actorUserId: w.technician, assignedTo: null, occurredAt: expect.any(String) });
    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'msp', revision: 2 });
    expect(await assignee(w, ticketId)).toBeNull();
    expect(await workRows(w)).toHaveLength(1);
    expect((await receipts(w)).map((row) => [row.revision, row.from_responsibility, row.to_responsibility]))
      .toEqual([[1, 'msp', 'client_it'], [2, 'client_it', 'msp']]);
  });

  // T030 / F055
  it('hand to MSP applies the arrangement\'s handoff defaults to a ticket left unassigned', async () => {
    const w = await world();
    const setDefaults = (handoff_defaults: object) => db('co_managed_seat_arrangements')
      .where({ tenant: w.sponsor, arrangement_id: w.arrangementId }).update({ handoff_defaults: JSON.stringify(handoff_defaults) });
    const roundTrip = async (assignedTo: string | null) => {
      const ticketId = await ticket(w, { assignedTo });
      await toClientIt(w, ticketId, 0);
      return { ticketId, receipt: await toMsp(w, ticketId, 1) };
    };
    await setDefaults({ assigned_to: w.otherStaff });

    // A technician assignee is replaced by the default; so is no assignee at all.
    for (const before of [w.technician, null]) {
      const { ticketId, receipt } = await roundTrip(before);
      expect(receipt.assignedTo).toBe(w.otherStaff);
      expect(await assignee(w, ticketId)).toBe(w.otherStaff);
    }
    // An MSP assignee is kept: the default is for a ticket that would arrive unassigned.
    const kept = await roundTrip(w.staff);
    expect(kept.receipt.assignedTo).toBe(w.staff);
    expect(await assignee(w, kept.ticketId)).toBe(w.staff);

    // A default that is not MSP staff is skipped, never assigned.
    for (const stale of [{ assigned_to: w.otherTechnician }, { assigned_to: randomUUID() }, { assigned_to: 'nobody' }, { board_id: w.outOfScope }]) {
      await setDefaults(stale);
      const { ticketId, receipt } = await roundTrip(w.technician);
      expect(receipt.assignedTo, JSON.stringify(stale)).toBeNull();
      expect(await assignee(w, ticketId)).toBeNull();
    }
    expect(coManagedSeatHandoffDefaults({})).toEqual({});
    expect(coManagedSeatHandoffDefaults(null)).toEqual({});
  });

  // T030 / F055, F056
  it('each direction admits only its own actor', async () => {
    const w = await world();
    const stranger = await world();
    const ticketId = await ticket(w);

    // Hand to client IT: MSP staff only.
    for (const actorUserId of [w.technician, randomUUID()]) {
      await expect(handCoManagedSeatTicketToClientIt(db, request(w, ticketId, actorUserId, 0))).rejects.toMatchObject({ code: 'ACTOR_NOT_ALLOWED' });
    }
    await toClientIt(w, ticketId, 0);
    // Hand to MSP: an active technician of this ticket's client only.
    for (const actorUserId of [w.staff, stranger.technician, await seat(w.sponsor, w.arrangementId, 'revoked'), randomUUID()]) {
      await expect(toMsp(w, ticketId, 1, { actorUserId })).rejects.toMatchObject({ code: 'ACTOR_NOT_ALLOWED' });
    }
    expect(await work(w, ticketId)).toMatchObject({ responsibility: 'client_it', revision: 1 });
    expect(await receipts(w)).toHaveLength(1);
  });

  // T030 / F055, F056
  it('a handoff without a shared note is refused in both directions', async () => {
    const w = await world();
    const ticketId = await ticket(w);

    for (const note of ['', '   \n\t ', 'x'.repeat(10001)]) {
      await expect(toClientIt(w, ticketId, 0, { note })).rejects.toMatchObject({ code: 'INVALID_HANDOFF' });
    }
    await toClientIt(w, ticketId, 0, { note: `  ${NOTE}  ` });
    for (const note of ['', '   ']) await expect(toMsp(w, ticketId, 1, { note })).rejects.toMatchObject({ code: 'INVALID_HANDOFF' });
    await expect(handCoManagedSeatTicketToMsp(db, { ...request(w, ticketId, w.technician, 1), operationId: 'not-a-uuid' }))
      .rejects.toMatchObject({ code: 'INVALID_HANDOFF' });
    await expect(handCoManagedSeatTicketToMsp(db, request(w, ticketId, w.technician, -1))).rejects.toMatchObject({ code: 'INVALID_HANDOFF' });

    // The stored note is the trimmed one, and nothing was written for the refusals.
    expect(await receipts(w)).toEqual([expect.objectContaining({ note: NOTE })]);
  });

  // T030 / F055, F056
  it('a replay returns the original receipt, even after later handoffs, and changes nothing', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    const [handOver, handBack] = [randomUUID(), randomUUID()];
    const first = await toClientIt(w, ticketId, 0, { operationId: handOver, technicianUserId: w.technician });
    expect(await toClientIt(w, ticketId, 0, { operationId: handOver, technicianUserId: w.technician })).toEqual(first);

    const back = await toMsp(w, ticketId, 1, { operationId: handBack });
    expect(await toMsp(w, ticketId, 1, { operationId: handBack })).toEqual(back);
    // The first operation still answers with its own receipt, though its revision is long stale.
    expect(await toClientIt(w, ticketId, 0, { operationId: handOver, technicianUserId: w.technician })).toEqual(first);
    // And after the arrangement has ended.
    await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId })
      .update({ state: 'ended', ended_at: new Date() });
    expect(await toMsp(w, ticketId, 1, { operationId: handBack })).toEqual(back);

    expect(await receipts(w)).toHaveLength(2);
    expect(await workRows(w)).toEqual([expect.objectContaining({ responsibility: 'msp', revision: 2 })]);
    expect(await assignee(w, ticketId)).toBeNull();
  });

  // T030 / F055, F056
  it('an operation id reused with different details is refused', async () => {
    const w = await world();
    const [ticketId, another] = [await ticket(w), await ticket(w)];
    const operationId = randomUUID();
    await toClientIt(w, ticketId, 0, { operationId });

    await expect(toClientIt(w, ticketId, 0, { operationId, note: 'A different note.' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(toClientIt(w, ticketId, 0, { operationId, technicianUserId: w.technician })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(toClientIt(w, another, 0, { operationId })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(toMsp(w, ticketId, 1, { operationId })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });

    expect(await receipts(w)).toHaveLength(1);
    expect(await work(w, another)).toMatchObject({ responsibility: 'msp', revision: 0 });
  });

  // T030 / F057
  it('a handoff naming a stale revision is refused, and so is one that changes nothing', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await expect(toClientIt(w, ticketId, 1)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    await toClientIt(w, ticketId, 0);

    // Another handoff has intervened: the revision this one saw is gone.
    await expect(toClientIt(w, ticketId, 0)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    await expect(toMsp(w, ticketId, 0)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    await expect(toMsp(w, ticketId, 2)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    // The right revision, but responsibility is already there.
    await expect(toClientIt(w, ticketId, 1)).rejects.toMatchObject({ code: 'ALREADY_RESPONSIBLE' });
    await expect(toMsp(w, await ticket(w), 0)).rejects.toMatchObject({ code: 'ALREADY_RESPONSIBLE' });

    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'client_it', revision: 1 });
    expect(await receipts(w)).toHaveLength(1);
  });

  // T030 / F057
  it('of two handoffs naming the same revision at once, exactly one wins', async () => {
    const w = await world();
    const ticketId = await ticket(w);

    const outcomes = await Promise.allSettled([toClientIt(w, ticketId, 0), toClientIt(w, ticketId, 0, { technicianUserId: w.technician })]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: { code: 'HANDOFF_CHANGED' } });
    expect(await receipts(w)).toHaveLength(1);
    expect(await work(w, ticketId)).toMatchObject({ responsibility: 'client_it', revision: 1 });
  });

  // T030 / F057
  it('a recorded reassignment moves the revision on, so a handoff prepared before it is refused', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    const reassign = (id: string) => db.transaction((trx) => recordCoManagedSeatTicketReassignment(trx, { sponsorTenant: w.sponsor, ticketId: id }));

    // Before any handoff: the ticket stays the MSP's, one revision on.
    expect(await reassign(ticketId)).toBe(1);
    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'msp', revision: 1 });
    await expect(toClientIt(w, ticketId, 0)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    await toClientIt(w, ticketId, 1);

    // While with client IT: responsibility is kept, and the technician's stale handoff is refused.
    expect(await reassign(ticketId)).toBe(3);
    expect(await work(w, ticketId)).toEqual({ arrangementId: w.arrangementId, responsibility: 'client_it', revision: 3 });
    await expect(toMsp(w, ticketId, 2)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    expect(await toMsp(w, ticketId, 3)).toMatchObject({ to: 'msp', revision: 4 });

    // A ticket of a client without an arrangement is not tracked at all.
    const elsewhere = await ticket(w, { clientId: await createClient(db, w.sponsor, 'Untracked') });
    expect(await reassign(elsewhere)).toBeNull();
    expect(await workRows(w)).toHaveLength(1);
  });

  // F054: under a new arrangement, a ticket starts with the MSP again and its revisions carry on.
  it('work written under an ended arrangement does not make client IT responsible under a new one', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0);
    await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId })
      .update({ state: 'ended', ended_at: new Date() });
    const arrangementId = randomUUID();
    await db('co_managed_seat_arrangements').insert({ tenant: w.sponsor, arrangement_id: arrangementId, client_id: w.clientId, allocation_id: randomUUID() });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: w.sponsor, arrangementId, boards: [{ boardId: w.inScope, canCreate: true }] });

    expect(await work(w, ticketId)).toEqual({ arrangementId, responsibility: 'msp', revision: 1 });
    expect(await toClientIt(w, ticketId, 1)).toMatchObject({ arrangementId, from: 'msp', to: 'client_it', revision: 2 });
  });
});
