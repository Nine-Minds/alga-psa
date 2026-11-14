/**
 * Co-managed seat and workspace shapes, slice S39 (F093, F094 / T050) on real Postgres, through
 * the native client and ticket writers.
 *
 * A client with a live seat arrangement cannot be deleted, merged away or made inactive, and is
 * told why; once the arrangement has ended all three go through. A ticket that changes client, or
 * moves to a board the arrangement does not share, loses a seat technician assignee and returns
 * to the MSP, keeping its shared notes; a move that keeps it shared changes nothing, MSP staff
 * stay assigned, and a tenant the co-managed-seat capability does not serve pays nothing and is never refused.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { coManagedSeatParticipants } from '@alga-psa/co-managed/seatCapability';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() =>
  vi.fn<typeof import('server/src/lib/eventBus/publishers').publishWorkflowEvent>(async () => undefined)
);

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

// BaseService (the service base) imports createTenantKnex from the internal tenant module, not
// the @alga-psa/db barrel, so the barrel mock above never intercepts it.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import {
  createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, readCoManagedSeatTicketWork, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import {
  assertClientPatchKeepsSeatArrangement, countLiveCoManagedSeatArrangementsForClient,
} from '@alga-psa/core/config/deletion';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { releaseSeatTicketOnMove, tenantDb } from '@alga-psa/db';
import { ClientMergeBlockedError, executeClientMerge, previewClientMerge } from '@alga-psa/clients/lib/clientMergeEngine';
import { updateTicketWithCache } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { ClientModel } from '../../../../shared/models/clientModel';
import { TicketModel } from '../../../../shared/models/ticketModel';
import { ClientService } from '../../lib/api/services/ClientService';
import { TicketService } from '../../lib/api/services/TicketService';
import {
  createCloseRulesFixture, createSecondaryTenant, insertResolutionComment, insertTicket, type CloseRulesFixture,
} from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;
const REASON = 'This client has a co-managed IT seat arrangement. End the arrangement before making the client inactive.';

let db: Knex;
let fixture: CloseRulesFixture;
let arrangementId: string;
let technician: string;
let otherStaff: string;
/** A board the arrangement shares besides the fixture's, and one it does not. Each has an open status. */
let alsoShared: { boardId: string; statusId: string };
let notShared: { boardId: string; statusId: string };

const tenant = () => fixture.tenantId;
const serviceContext = () => ({ tenant: tenant(), userId: fixture.userId, user: userRef.user }) as any;

async function insertUser(label: string): Promise<string> {
  const userId = randomUUID();
  await db('users').insert({ tenant: tenant(), user_id: userId, username: `s39-${label}-${userId.slice(0, 8)}`,
    first_name: 'Dorothy', last_name: 'Gale', hashed_password: 'not-used', user_type: 'internal',
    email: `s39-${userId.slice(0, 8)}@example.com` });
  return userId;
}

async function insertBoard(): Promise<{ boardId: string; statusId: string }> {
  const [boardId, statusId] = [randomUUID(), randomUUID()];
  await db('boards').insert({ tenant: tenant(), board_id: boardId, board_name: `S39 board ${boardId.slice(0, 8)}`,
    is_default: false, is_inactive: false, display_order: 999 });
  await db('statuses').insert({ tenant: tenant(), status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, order_number: 10, created_by: fixture.userId });
  return { boardId, statusId };
}

/** A copy of the fixture's client under a new id: same tenant, no arrangement of its own. */
async function insertClient(label: string): Promise<string> {
  const clientId = randomUUID();
  await db('clients').insert({ ...(await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first()),
    client_id: clientId, client_name: `${label} ${clientId.slice(0, 8)}` });
  return clientId;
}

async function enableSeats(clientId: string, boards: string[]): Promise<string> {
  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId, operationId: randomUUID(), seats: 2 });
  await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId: arrangement.arrangement_id,
    boards: boards.map((boardId) => ({ boardId, canCreate: true })) });
  return arrangement.arrangement_id;
}

async function endArrangement(id: string): Promise<void> {
  await db('co_managed_seat_arrangements').where({ tenant: tenant(), arrangement_id: id }).update({ state: 'ended', ended_at: new Date() });
}

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName: 's39_seat_lifecycle_guards_test' });
  dbRef.knex = db;
  // The gate's own resolver, pointed at this suite's database, with no verdict cached between steps.
  registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
  process.env.CAPABILITY_CACHE_TTL_MS = '0';

  const seededUser = await tenantDb(db, '__test_discovery__')
    .unscoped('users', 'test discovery of seeded internal user for seat lifecycle guard integration')
    .where({ user_type: 'internal' })
    .first();
  expect(seededUser).toBeTruthy();
  dbRef.tenant = seededUser.tenant;
  userRef.user = {
    user_id: seededUser.user_id,
    tenant: seededUser.tenant,
    user_type: 'internal',
    first_name: seededUser.first_name ?? 'Test',
    last_name: seededUser.last_name ?? 'User',
    username: seededUser.username,
  };
  fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);

  otherStaff = await insertUser('staff');
  technician = await insertUser('tech');
  alsoShared = await insertBoard();
  notShared = await insertBoard();

  await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
  arrangementId = await enableSeats(fixture.clientId, [fixture.boardId, alsoShared.boardId]);
  await db.transaction(async (trx) => {
    await retainBuiltinResolverSubject(trx, { tenant: tenant(), userId: technician }, CO_MANAGED_SEAT_RESOLVER_ID);
    await trx('co_managed_seat_assignments').insert({ tenant: tenant(), assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: technician, state: 'active' });
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  delete process.env.CAPABILITY_CACHE_TTL_MS;
  delete process.env.FORCE_CAPABILITIES;
  await db?.destroy().catch(() => undefined);
});

describe('a client with a live seat arrangement cannot be deleted, merged or made inactive (F093)', () => {
  let clientId: string;
  let contactId: string;

  const clientRow = (id: string) => db('clients').where({ tenant: tenant(), client_id: id }).first();
  const client = () => clientRow(clientId);
  const contact = () => db('contacts').where({ tenant: tenant(), contact_name_id: contactId }).first();
  const tryDelete = (id: string = clientId) => deleteEntityWithValidation('client', id, db, tenant(), async (trx, tenantId) => {
    await tenantDb(trx, tenantId).table('clients').where({ client_id: id }).del();
  });

  beforeAll(async () => {
    clientId = await insertClient('Arranged');
    contactId = randomUUID();
    await db('contacts').insert({ ...(await db('contacts').where({ tenant: tenant(), contact_name_id: fixture.contactId }).first()),
      contact_name_id: contactId, client_id: clientId, email: `s39-${contactId.slice(0, 8)}@example.com`, is_inactive: false });
    await enableSeats(clientId, [fixture.boardId]);
  }, HOOK_TIMEOUT);

  it('refuses deletion and names the seat arrangement as the reason', async () => {
    const result = await tryDelete();

    expect(result.canDelete).toBe(false);
    expect(result.dependencies).toContainEqual(expect.objectContaining({
      type: 'co_managed_seat_arrangement', count: 1, label: expect.stringContaining('co-managed IT seat arrangement') }));
    expect(result.message).toContain('co-managed IT seat arrangement');
    expect(await client()).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('refuses a merge that would absorb the client', async () => {
    const target = await insertClient('Merge target');
    const input = { sourceClientId: clientId, targetClientId: target };

    const preview = await db.transaction((trx) => previewClientMerge(trx, tenant(), input));
    expect(preview.blockers.map((blocker) => blocker.code)).toContain('SOURCE_HAS_CO_MANAGEMENT');

    const merge = db.transaction((trx) => executeClientMerge(trx, tenant(), fixture.userId, input));
    await expect(merge).rejects.toBeInstanceOf(ClientMergeBlockedError);
    await expect(merge).rejects.toThrow(/co-managed IT arrangement/);
    expect((await client()).merged_into_client_id ?? null).toBeNull();
  }, HOOK_TIMEOUT);

  it('refuses inactivation through every writer, with the reason, and leaves the client and its contacts active', async () => {
    await expect(db.transaction((trx) => ClientModel.updateClient(clientId, { is_inactive: true } as any, tenant(), trx)))
      .rejects.toMatchObject({ code: 'CLIENT_HAS_SEAT_ARRANGEMENT', message: REASON, i18nKey: 'msp/clients:errors.client.hasSeatArrangement' });
    await expect(new ClientService().update(clientId, { is_inactive: true } as any, serviceContext()))
      .rejects.toMatchObject({ message: REASON });
    await expect(db.transaction((trx) => assertClientPatchKeepsSeatArrangement(trx, tenant(), clientId, { is_inactive: true })))
      .rejects.toMatchObject({ code: 'CLIENT_HAS_SEAT_ARRANGEMENT' });

    expect((await client()).is_inactive).toBe(false);
    expect((await contact()).is_inactive).toBe(false);
  }, HOOK_TIMEOUT);

  it('lets every other client edit through', async () => {
    await db.transaction((trx) => ClientModel.updateClient(clientId, { notes: 'Still editable' } as any, tenant(), trx));
    await new ClientService().update(clientId, { notes: 'Still editable over REST', is_inactive: false } as any, serviceContext());

    expect((await client()).notes).toBe('Still editable over REST');
  }, HOOK_TIMEOUT);

  it('does not refuse a tenant the co-managed-seat capability does not serve, whatever rows it holds', async () => {
    const closed = await insertClient('Capability closed');
    await enableSeats(closed, [fixture.boardId]);
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    try {
      expect(await countLiveCoManagedSeatArrangementsForClient(db, { tenant: tenant(), entityId: closed })).toBe(0);
      await db.transaction((trx) => ClientModel.updateClient(closed, { is_inactive: true } as any, tenant(), trx));
      expect((await clientRow(closed)).is_inactive).toBe(true);
    } finally {
      delete process.env.FORCE_CAPABILITIES;
    }
  }, HOOK_TIMEOUT);

  it('allows inactivation, merge and deletion once the arrangement has ended', async () => {
    // Its own client, so the refusals above do not depend on the order the tests run in.
    const formerId = await insertClient('Formerly arranged');
    const formerArrangement = await enableSeats(formerId, [fixture.boardId]);
    expect(await countLiveCoManagedSeatArrangementsForClient(db, { tenant: tenant(), entityId: formerId })).toBe(1);
    await endArrangement(formerArrangement);
    expect(await countLiveCoManagedSeatArrangementsForClient(db, { tenant: tenant(), entityId: formerId })).toBe(0);

    await db.transaction((trx) => ClientModel.updateClient(formerId, { is_inactive: true } as any, tenant(), trx));
    expect((await clientRow(formerId)).is_inactive).toBe(true);

    const target = await insertClient('Merge target');
    const preview = await db.transaction((trx) => previewClientMerge(trx, tenant(), { sourceClientId: formerId, targetClientId: target }));
    expect(preview.blockers.map((blocker) => blocker.code)).not.toContain('SOURCE_HAS_CO_MANAGEMENT');

    const result = await tryDelete(formerId);
    expect(result.dependencies.map((dependency) => dependency.type)).not.toContain('co_managed_seat_arrangement');
  }, HOOK_TIMEOUT);
});

describe('a ticket that leaves its seat arrangement returns to the MSP (F094)', () => {
  const work = (ticketId: string) => readCoManagedSeatTicketWork(db, { sponsorTenant: tenant(), ticketId });
  const workRow = (ticketId: string) => db('co_managed_seat_ticket_work').where({ tenant: tenant(), ticket_id: ticketId }).first();
  const ticket = (ticketId: string) => db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).first();
  const agents = async (ticketId: string) =>
    (await db('ticket_resources').where({ tenant: tenant(), ticket_id: ticketId }).select('additional_user_id'))
      .map((row) => row.additional_user_id);
  const notes = (ticketId: string) => db('comments').where({ tenant: tenant(), ticket_id: ticketId }).select('comment_id', 'note');
  const receipts = (ticketId: string) => db('co_managed_seat_ticket_handoffs').where({ tenant: tenant(), ticket_id: ticketId });

  /** A ticket with client IT, assigned to the technician, carrying a shared IT note. Work revision 1. */
  const ticketWithClientIt = async () => {
    const ticketId = await insertTicket(db, fixture);
    await handCoManagedSeatTicketToClientIt(db, { sponsorTenant: tenant(), ticketId, actorUserId: fixture.userId,
      operationId: randomUUID(), expectedRevision: 0, note: 'Yours from here: the user is on site.', technicianUserId: technician });
    const noteId = await insertResolutionComment(db, fixture, ticketId, { note: 'Shared IT note', is_resolution: false, is_internal: true });
    await db('comment_threads').where({ tenant: tenant(), ticket_id: ticketId }).update({ is_internal: true, collaboration_audience: 'shared_it' });
    expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'client_it', revision: 1 });
    expect((await ticket(ticketId)).assigned_to).toBe(technician);
    return { ticketId, noteId };
  };

  const expectReturnedToMsp = async (ticketId: string, noteId: string) => {
    expect((await ticket(ticketId)).assigned_to).toBeNull();
    expect(await workRow(ticketId)).toMatchObject({ arrangement_id: arrangementId, responsibility: 'msp', revision: 2 });
    expect(await agents(ticketId)).not.toContain(technician);
    // The shared note and the handoff receipt that carried one are both still there.
    expect(await notes(ticketId)).toEqual([{ comment_id: noteId, note: 'Shared IT note' }]);
    expect(await receipts(ticketId)).toHaveLength(1);
  };

  const WRITERS: Array<[string, (ticketId: string, patch: Record<string, unknown>) => Promise<unknown>]> = [
    ['the MSP ticket screen save', (ticketId, patch) => updateTicketWithCache(ticketId, patch as any)],
    ['the REST API update', (ticketId, patch) => new TicketService().update(ticketId, patch as any, serviceContext())],
    ['the shared ticket model update that workflows and inbound writers use',
      (ticketId, patch) => db.transaction((trx) => TicketModel.updateTicket(ticketId, patch as any, tenant(), trx))],
  ];

  describe.each(WRITERS)('%s', (_name, write) => {
    it('moving the ticket to a board the arrangement does not share', async () => {
      const { ticketId, noteId } = await ticketWithClientIt();

      await write(ticketId, { board_id: notShared.boardId, status_id: notShared.statusId });

      expect((await ticket(ticketId)).board_id).toBe(notShared.boardId);
      await expectReturnedToMsp(ticketId, noteId);
      // The client still has its arrangement, so the ticket has a responsibility, and it is the MSP's.
      expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'msp', revision: 2 });
    }, HOOK_TIMEOUT);

    it('changing the ticket\'s client, and bringing it back does not revive client IT\'s turn', async () => {
      const { ticketId, noteId } = await ticketWithClientIt();
      const elsewhere = await insertClient('Elsewhere');

      await write(ticketId, { client_id: elsewhere, contact_name_id: null });

      expect((await ticket(ticketId)).client_id).toBe(elsewhere);
      await expectReturnedToMsp(ticketId, noteId);
      expect(await work(ticketId)).toBeNull();

      await write(ticketId, { client_id: fixture.clientId });
      expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'msp', revision: 2 });
      expect((await ticket(ticketId)).assigned_to).toBeNull();
    }, HOOK_TIMEOUT);

    it('moving the ticket to another board the arrangement shares changes nothing', async () => {
      const { ticketId } = await ticketWithClientIt();

      await write(ticketId, { board_id: alsoShared.boardId, status_id: alsoShared.statusId });

      expect((await ticket(ticketId)).board_id).toBe(alsoShared.boardId);
      expect((await ticket(ticketId)).assigned_to).toBe(technician);
      expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'client_it', revision: 1 });
    }, HOOK_TIMEOUT);

    it('MSP staff stay assigned when the ticket leaves the arrangement\'s boards', async () => {
      const ticketId = await insertTicket(db, fixture, { assigned_to: otherStaff });

      await write(ticketId, { board_id: notShared.boardId, status_id: notShared.statusId });

      expect((await ticket(ticketId)).assigned_to).toBe(otherStaff);
      expect(await workRow(ticketId)).toBeUndefined();
    }, HOOK_TIMEOUT);
  });

  it('a technician who is only an additional agent is dropped, and the MSP assignee stays', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: otherStaff });
    await db('ticket_resources').insert({ tenant: tenant(), assignment_id: randomUUID(), ticket_id: ticketId,
      assigned_to: otherStaff, additional_user_id: technician, assigned_at: new Date() });

    expect(await updateTicketWithCache(ticketId, { board_id: notShared.boardId, status_id: notShared.statusId } as any)).toBe('success');

    expect((await ticket(ticketId)).assigned_to).toBe(otherStaff);
    expect(await agents(ticketId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('a technician of the old client is cleared when the new client has an arrangement of its own', async () => {
    const { ticketId } = await ticketWithClientIt();
    const neighbour = await insertClient('Neighbour');
    const neighbourArrangement = await enableSeats(neighbour, [fixture.boardId]);

    await db.transaction((trx) => TicketModel.updateTicket(ticketId, { client_id: neighbour, contact_name_id: null } as any, tenant(), trx));

    expect((await ticket(ticketId)).assigned_to).toBeNull();
    expect(await work(ticketId)).toEqual({ arrangementId: neighbourArrangement, responsibility: 'msp', revision: 2 });
    await endArrangement(neighbourArrangement);
  }, HOOK_TIMEOUT);

  it('a tenant the capability does not serve pays no query on a move, and one with the capability forced off changes nothing', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    try {
      const { ticketId } = await ticketWithClientIt();
      await db.transaction((trx) => TicketModel.updateTicket(ticketId, { board_id: notShared.boardId, status_id: notShared.statusId } as any, tenant(), trx));
      expect((await ticket(ticketId)).assigned_to).toBe(technician);
      expect(await workRow(ticketId)).toMatchObject({ responsibility: 'client_it', revision: 1 });
    } finally {
      delete process.env.FORCE_CAPABILITIES;
    }
  }, HOOK_TIMEOUT);

  it('a tenant with no seat arrangement is not served and pays no query, on a move or otherwise', async () => {
    const other = await createSecondaryTenant(db);
    const [ticketId, boardA, boardB, clientId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const queries: string[] = [];
    // The verdict is cached per tenant: one participation read to learn it, then nothing.
    process.env.CAPABILITY_CACHE_TTL_MS = '30000';
    await db.transaction((trx) => releaseSeatTicketOnMove(trx, other.tenantId, ticketId,
      { client_id: clientId, board_id: boardA }, { client_id: clientId, board_id: boardB }));
    const record = (query: { sql: string }) => { if (!/^(BEGIN|COMMIT|ROLLBACK)/i.test(query.sql)) queries.push(query.sql); };

    db.on('query', record);
    try {
      const unmoved = await db.transaction((trx) => releaseSeatTicketOnMove(trx, other.tenantId, ticketId,
        { client_id: clientId, board_id: boardA }, { client_id: clientId, board_id: boardA }));
      expect(unmoved).toEqual({ assigneeCleared: false });
      expect(queries).toEqual([]);

      const moved = await db.transaction((trx) => releaseSeatTicketOnMove(trx, other.tenantId, ticketId,
        { client_id: clientId, board_id: boardA }, { client_id: clientId, board_id: boardB }));
      expect(moved).toEqual({ assigneeCleared: false });
      expect(queries).toEqual([]);
    } finally {
      db.removeListener('query', record);
      process.env.CAPABILITY_CACHE_TTL_MS = '0';
    }
  }, HOOK_TIMEOUT);
});
