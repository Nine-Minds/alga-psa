/**
 * Co-managed seat shape, slice S24 (F063 / T033) on real Postgres: the MSP's SLA timers pause while a
 * ticket of a seat-arrangement client is with client IT and resume when it comes back.
 *
 * The pause is driven by the ticket lifecycle (`seatResponsibility`, dispatched inside the handoff
 * transaction) AND held by a registered pause condition, so a status or response-state change on a
 * ticket still with client IT cannot resume the clock, and a handback does not resume a clock that
 * is still paused for another reason. Nothing changes for other clients, or with the seat shape off.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, handCoManagedSeatTicketToMsp,
  setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import '@alga-psa/co-managed/capability';
import '@alga-psa/co-managed/ticketSlaRegistration';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}), publishWorkflowEvent: vi.fn(async () => {}),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const DAY = 86_400_000;
const MINUTE = 60_000;
const NOTE = 'Needs a firewall change we cannot make.';
const describeDb = await describeWithDb();

describeDb('co-managed seat responsibility pauses and resumes the MSP SLA', { shuffle: false }, () => {
  let db: Knex;
  let ticketNumber = 0;
  let sla: typeof import('@alga-psa/sla/services');

  const world = async () => {
    const sponsor = await createTenant(db, `SLA sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `SLA client ${randomUUID().slice(0, 8)}`);
    const plainClientId = await createClient(db, sponsor, `Plain client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 2 });
    const boardId = randomUUID();
    await db('boards').insert({ tenant: sponsor, board_id: boardId, board_name: 'Support', is_default: false });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });
    const staff = await createUser(db, sponsor);
    const technician = await createUser(db, sponsor);
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant: sponsor, userId: technician }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant: sponsor, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id,
        user_id: technician, state: 'active' });
    });
    let order = 0;
    const status = async (name: string, pauses: boolean) => {
      const statusId = randomUUID();
      await db('statuses').insert({ tenant: sponsor, status_id: statusId, board_id: boardId, name, is_closed: false, status_type: 'ticket', order_number: ++order });
      if (pauses) await db('status_sla_pause_config').insert({ tenant: sponsor, config_id: randomUUID(), status_id: statusId, pauses_sla: true, created_at: db.fn.now() });
      return statusId;
    };
    const policyId = randomUUID();
    await db('sla_policies').insert({ tenant: sponsor, sla_policy_id: policyId, policy_name: 'Standard', is_default: true });
    return { sponsor, clientId, plainClientId, arrangementId: arrangement.arrangement_id, boardId, staff, technician, policyId,
      open: await status('Open', false), waiting: await status('Waiting', true), other: await status('In progress', false) };
  };
  type World = Awaited<ReturnType<typeof world>>;

  /** A ticket with a running SLA clock that started two hours ago. */
  const ticket = async (w: World, clientId = w.clientId) => {
    const ticketId = randomUUID();
    const startedAt = new Date(Date.now() - 120 * MINUTE);
    await db('tickets').insert({ tenant: w.sponsor, ticket_id: ticketId, ticket_number: `S24-${++ticketNumber}`, title: 'SLA ticket',
      client_id: clientId, board_id: w.boardId, status_id: w.open, entered_at: startedAt, updated_at: startedAt,
      sla_policy_id: w.policyId, sla_started_at: startedAt, sla_resolution_due_at: new Date(startedAt.getTime() + 480 * MINUTE) });
    return ticketId;
  };
  const row = (w: World, ticketId: string) =>
    db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).first('sla_paused_at', 'sla_total_pause_minutes', 'sla_resolution_due_at', 'status_id');
  const toClientIt = (w: World, ticketId: string, expectedRevision: number) => handCoManagedSeatTicketToClientIt(db,
    { sponsorTenant: w.sponsor, ticketId, actorUserId: w.staff, operationId: randomUUID(), expectedRevision, note: NOTE });
  const toMsp = (w: World, ticketId: string, expectedRevision: number) => handCoManagedSeatTicketToMsp(db,
    { sponsorTenant: w.sponsor, ticketId, actorUserId: w.technician, operationId: randomUUID(), expectedRevision, note: NOTE });
  /** Pretends the ticket has been paused for `minutes`, so the resume has time to account for. */
  const advanceClock = (w: World, ticketId: string, minutes: number) =>
    db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ sla_paused_at: new Date(Date.now() - minutes * MINUTE) });
  const inTrx = <T>(fn: (trx: Knex.Transaction) => Promise<T>) => db.transaction(fn);
  const pauseEvents = async (w: World, ticketId: string, type: string) =>
    db('sla_audit_log').where({ tenant: w.sponsor, ticket_id: ticketId, event_type: type }).select('event_data');

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ databaseName: 's24_seat_responsibility_sla_test' });
    sla = await import('@alga-psa/sla/services');
  }, 300_000);
  beforeEach(() => { process.env.FORCE_CAPABILITIES = 'co-managed-seat:on'; });
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy().catch(() => undefined); });

  // T033
  it('hands to client IT: the clock pauses; hands back: it resumes and the due date moves out by the pause', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    const dueBefore = (await row(w, ticketId)).sla_resolution_due_at as Date;
    expect((await row(w, ticketId)).sla_paused_at).toBeNull();

    await toClientIt(w, ticketId, 0);
    const paused = await row(w, ticketId);
    expect(paused.sla_paused_at).not.toBeNull();
    const [event] = await pauseEvents(w, ticketId, 'sla_paused');
    expect(JSON.parse(typeof event.event_data === 'string' ? event.event_data : JSON.stringify(event.event_data)).reason).toBe('client_it_responsibility');

    // Ninety minutes with client IT: none of it counts against the MSP.
    await advanceClock(w, ticketId, 90);
    await toMsp(w, ticketId, 1);
    const resumed = await row(w, ticketId);
    expect(resumed.sla_paused_at).toBeNull();
    expect(resumed.sla_total_pause_minutes).toBeGreaterThanOrEqual(89);
    expect(resumed.sla_total_pause_minutes).toBeLessThanOrEqual(91);
    const shifted = (new Date(resumed.sla_resolution_due_at).getTime() - new Date(dueBefore).getTime()) / MINUTE;
    expect(shifted).toBeGreaterThanOrEqual(89);
    expect(shifted).toBeLessThanOrEqual(91);
    expect(await pauseEvents(w, ticketId, 'sla_resumed')).toHaveLength(1);
  });

  // T033
  it('a status or response-state change while the ticket is with client IT does not resume the clock', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0);
    await advanceClock(w, ticketId, 30);

    // Moving between non-pausing statuses, into a pausing one and out of it again.
    for (const [from, to] of [[w.open, w.other], [w.other, w.waiting], [w.waiting, w.open]] as const) {
      await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ status_id: to });
      const result = await inTrx((trx) => sla.handleStatusChange(trx, w.sponsor, ticketId, from, to));
      expect(result.success).toBe(true);
      expect(result.is_now_paused, `${from} -> ${to}`).toBe(true);
      expect((await row(w, ticketId)).sla_paused_at).not.toBeNull();
    }
    // Awaiting client and back.
    await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ response_state: 'awaiting_client' });
    expect((await inTrx((trx) => sla.handleResponseStateChange(trx, w.sponsor, ticketId, null, 'awaiting_client'))).is_now_paused).toBe(true);
    await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ response_state: null });
    expect((await inTrx((trx) => sla.handleResponseStateChange(trx, w.sponsor, ticketId, 'awaiting_client', null))).is_now_paused).toBe(true);
    // A general re-evaluation agrees, and says why.
    expect((await inTrx((trx) => sla.syncPauseState(trx, w.sponsor, ticketId))).is_now_paused).toBe(true);
    expect(await sla.shouldSlaBePaused(db, w.sponsor, ticketId)).toEqual({ paused: true, reason: 'client_it_responsibility' });
    expect((await row(w, ticketId)).sla_total_pause_minutes ?? 0).toBe(0);

    await toMsp(w, ticketId, 1);
    expect((await row(w, ticketId)).sla_paused_at).toBeNull();
  });

  // T033
  it('handing back does not resume a clock that is still paused for another reason', async () => {
    const w = await world();
    const awaiting = await ticket(w);
    await toClientIt(w, awaiting, 0);
    await db('tickets').where({ tenant: w.sponsor, ticket_id: awaiting }).update({ response_state: 'awaiting_client' });
    await toMsp(w, awaiting, 1);
    expect((await row(w, awaiting)).sla_paused_at, 'still awaiting the client').not.toBeNull();
    expect(await sla.shouldSlaBePaused(db, w.sponsor, awaiting)).toEqual({ paused: true, reason: 'awaiting_client' });

    const waiting = await ticket(w);
    await toClientIt(w, waiting, 0);
    await db('tickets').where({ tenant: w.sponsor, ticket_id: waiting }).update({ status_id: w.waiting });
    await toMsp(w, waiting, 1);
    expect((await row(w, waiting)).sla_paused_at, 'still in a pausing status').not.toBeNull();
    expect(await sla.shouldSlaBePaused(db, w.sponsor, waiting)).toEqual({ paused: true, reason: 'status_pause' });

    // Once the other reason ends too, the clock runs.
    await db('tickets').where({ tenant: w.sponsor, ticket_id: waiting }).update({ status_id: w.open });
    await inTrx((trx) => sla.handleStatusChange(trx, w.sponsor, waiting, w.waiting, w.open));
    expect((await row(w, waiting)).sla_paused_at).toBeNull();
  });

  // T033
  it('a ticket of a client with no arrangement is unaffected', async () => {
    const w = await world();
    const ticketId = await ticket(w, w.plainClientId);
    expect(await sla.shouldSlaBePaused(db, w.sponsor, ticketId)).toEqual({ paused: false, reason: null });
    await inTrx((trx) => sla.syncPauseState(trx, w.sponsor, ticketId));
    await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ status_id: w.other });
    await inTrx((trx) => sla.handleStatusChange(trx, w.sponsor, ticketId, w.open, w.other));
    expect((await row(w, ticketId)).sla_paused_at).toBeNull();
    // A work row left by an earlier arrangement or another client does not leak onto it.
    expect(await db('co_managed_seat_ticket_work').where({ tenant: w.sponsor, ticket_id: ticketId })).toHaveLength(0);
  });

  // T033
  it('with the seat shape off nothing changes: no pause on handoff, and no condition holds the clock', async () => {
    const w = await world();
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    const ticketId = await ticket(w);

    await toClientIt(w, ticketId, 0);
    expect((await row(w, ticketId)).sla_paused_at).toBeNull();
    expect(await db('sla_audit_log').where({ tenant: w.sponsor, ticket_id: ticketId })).toHaveLength(0);
    expect(await sla.shouldSlaBePaused(db, w.sponsor, ticketId)).toEqual({ paused: false, reason: null });
    // Neutral: with the shape off the condition reads no co-managed table.
    const statements: string[] = [];
    const listener = (query: { sql: string }) => statements.push(query.sql);
    db.on('query', listener);
    try { await sla.shouldSlaBePaused(db, w.sponsor, ticketId); } finally { db.removeListener('query', listener); }
    expect(statements.filter((sql) => sql.includes('co_managed'))).toEqual([]);

    await toMsp(w, ticketId, 1);
    expect((await row(w, ticketId)).sla_paused_at).toBeNull();
  });

  // T033
  it('a move out of the arrangement returns the ticket to the MSP and its clock resumes', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0);
    expect((await row(w, ticketId)).sla_paused_at).not.toBeNull();
    await advanceClock(w, ticketId, 20);

    const { releaseSeatTicketOnMove } = await import('@alga-psa/db');
    await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ client_id: w.plainClientId });
    await inTrx((trx) => releaseSeatTicketOnMove(trx, w.sponsor, ticketId, { client_id: w.clientId, board_id: w.boardId },
      { client_id: w.plainClientId, board_id: w.boardId }));
    const after = await row(w, ticketId);
    expect(after.sla_paused_at).toBeNull();
    expect(after.sla_total_pause_minutes).toBeGreaterThanOrEqual(19);
  });
});
