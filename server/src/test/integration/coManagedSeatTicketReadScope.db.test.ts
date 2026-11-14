/**
 * Co-managed seat and workspace shapes, slice S39 (F094) on real Postgres: a seat technician's
 * access to a ticket ends when the ticket leaves the arrangement.
 *
 * Nothing about permissions is mocked. The technician is a real internal user holding a role with
 * `ticket:read` and nothing else, the MSP user is the seeded administrator, and RBAC and the
 * authorization kernel both run against their rows. Only the session is injected (there is no
 * app server), so each read below is the function the screen or the REST route calls, run as the
 * signed-in principal:
 *
 *  - the MSP ticket screen loader (`getConsolidatedTicketData`)
 *  - the ticket read action (`getTicketById`)
 *  - the comment reads (`findCommentsByTicketId`, `findCommentById`)
 *  - the REST read decision (`authorizeApiResourceRead` on the row `TicketService.getById` loads,
 *    which is what `ApiTicketController` gates the ticket and its comments on)
 *
 * The move itself is made by the MSP user through the ticket screen save.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
/** The signed-in principal of the request being made. */
const session = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

// The session only. `hasPermission` stays the real one and reads the principal's role rows.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(session.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(session.user, { tenant: dbRef.tenant }, ...args),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

// What the server registers at boot (instrumentation.ts): the seat authority resolver comes with it.
import '@alga-psa/co-managed/capability';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { coManagedSeatParticipants } from '@alga-psa/co-managed/seatCapability';
import {
  createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, readCoManagedSeatTicketWork, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { tenantDb } from '@alga-psa/db';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  getConsolidatedTicketData, updateTicketWithCache,
} from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { getTicketById } from '../../../../packages/tickets/src/actions/ticketActions';
import { findCommentById, findCommentsByTicketId } from '../../../../packages/tickets/src/actions/comment-actions/commentActions';
import { authorizeApiResourceRead } from '../../lib/api/controllers/authorizationKernel';
import { buildTicketRecordContext } from '../../lib/api/controllers/recordContexts';
import { TicketService } from '../../lib/api/services/TicketService';
import {
  createCloseRulesFixture, insertResolutionComment, insertTicket, type CloseRulesFixture,
} from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;
const SHARED_NOTE = 'Shared IT note: the user is on site until four.';

let db: Knex;
let fixture: CloseRulesFixture;
let arrangementId: string;
let mspUser: any;
let technician: any;
/** A second technician of the same arrangement, never assigned to anything. */
let colleague: any;
let notShared: { boardId: string; statusId: string };
let otherClientId: string;

const tenant = () => fixture.tenantId;

/** The principal as a session carries it: the user row with its roles. */
async function principal(userId: string): Promise<any> {
  const user = await db('users').where({ tenant: dbRef.tenant, user_id: userId }).first();
  const roles = await db('user_roles as ur').join('roles as r', function () {
    this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id');
  }).where({ 'ur.tenant': dbRef.tenant, 'ur.user_id': userId }).select('r.*');
  return { ...user, roles };
}

/** An internal user whose only role grants `ticket:read`, holding a live seat in the arrangement. */
async function insertSeatTechnician(label: string, roleId: string): Promise<any> {
  const userId = randomUUID();
  await db('users').insert({ tenant: tenant(), user_id: userId, username: `s39-${label}-${userId.slice(0, 8)}`,
    first_name: 'Seat', last_name: label, hashed_password: 'not-used', user_type: 'internal',
    email: `s39-${userId.slice(0, 8)}@example.com` });
  await db('user_roles').insert({ tenant: tenant(), user_id: userId, role_id: roleId });
  await db.transaction(async (trx) => {
    await retainBuiltinResolverSubject(trx, { tenant: tenant(), userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await trx('co_managed_seat_assignments').insert({ tenant: tenant(), assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state: 'active' });
  });
  return principal(userId);
}

async function insertBoard(): Promise<{ boardId: string; statusId: string }> {
  const [boardId, statusId] = [randomUUID(), randomUUID()];
  await db('boards').insert({ tenant: tenant(), board_id: boardId, board_name: `S39 MSP only ${boardId.slice(0, 8)}`,
    is_default: false, is_inactive: false, display_order: 999 });
  await db('statuses').insert({ tenant: tenant(), status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, order_number: 10, created_by: fixture.userId });
  return { boardId, statusId };
}

/** Runs `request` as `user`, the way one signed-in request would. */
async function as<T>(user: any, request: () => Promise<T>): Promise<T> {
  session.user = user;
  try {
    return await request();
  } finally {
    session.user = null;
  }
}

type ReadOutcome = { granted: true; value: any } | { granted: false; reason: string };

/** A read either returns its data, or it is refused: by throwing, or by returning the action's error payload. */
async function read(request: () => Promise<unknown>): Promise<ReadOutcome> {
  try {
    const value = await request() as any;
    const refused = value === null || value === undefined || isActionPermissionError(value) || isActionMessageError(value);
    return refused ? { granted: false, reason: JSON.stringify(value) } : { granted: true, value };
  } catch (error) {
    return { granted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Every way the application reads one ticket and its comments, as `user`. */
function readsOf(user: any, ticketId: string, noteId: string): Record<string, () => Promise<ReadOutcome>> {
  const restContext = { tenant: tenant(), userId: user.user_id, user } as any;
  return {
    'the ticket screen loader': () => as(user, () => read(() => getConsolidatedTicketData(ticketId))),
    'the ticket read action': () => as(user, () => read(() => getTicketById(ticketId))),
    'the comment list': () => as(user, () => read(() => findCommentsByTicketId(ticketId))),
    'a single comment': () => as(user, () => read(() => findCommentById(noteId))),
    // ApiTicketController.assertTicketReadAllowed: load the row, ask the kernel, and only then serve
    // the ticket or its comments.
    'the REST ticket and comment routes': () => read(async () => {
      const service = new TicketService();
      const row = await service.getById(ticketId, restContext);
      if (!row) throw new Error('ticket not found');
      const decision = await authorizeApiResourceRead({ knex: db, tenant: tenant(), user, resource: 'ticket',
        recordContext: buildTicketRecordContext(row as Record<string, any>) });
      if (!decision.allowed) throw new Error('Permission denied: Cannot read ticket');
      return { ticket: row, comments: await service.getTicketComments(ticketId, restContext) };
    }),
  };
}

async function expectReadable(user: any, ticketId: string, noteId: string): Promise<void> {
  for (const [name, request] of Object.entries(readsOf(user, ticketId, noteId))) {
    const outcome = await request();
    expect(outcome.granted, `${name}: ${outcome.granted ? '' : outcome.reason}`).toBe(true);
    // Whatever the read returns comments in, the shared note is in it; the ticket-only read returns the ticket.
    const body = JSON.stringify((outcome as { value: unknown }).value);
    expect(body, name).toContain(name === 'the ticket read action' ? ticketId : SHARED_NOTE);
  }
}

async function expectDenied(user: any, ticketId: string, noteId: string): Promise<void> {
  for (const [name, request] of Object.entries(readsOf(user, ticketId, noteId))) {
    const outcome = await request();
    expect(outcome.granted, `${name} must refuse a ticket outside the arrangement`).toBe(false);
    // The refusal carries nothing of the ticket's conversation.
    expect((outcome as { reason: string }).reason, name).not.toContain(SHARED_NOTE);
  }
}

/** A ticket of the arranged client on a shared board, with client IT, assigned to the technician, carrying a shared note. */
async function ticketWithClientIt(): Promise<{ ticketId: string; noteId: string }> {
  const ticketId = await insertTicket(db, fixture);
  await handCoManagedSeatTicketToClientIt(db, { sponsorTenant: tenant(), ticketId, actorUserId: fixture.userId,
    operationId: randomUUID(), expectedRevision: 0, note: 'Yours from here.', technicianUserId: technician.user_id });
  const noteId = await insertResolutionComment(db, fixture, ticketId, { note: SHARED_NOTE, is_resolution: false, is_internal: true });
  await db('comment_threads').where({ tenant: tenant(), ticket_id: ticketId }).update({ is_internal: true, collaboration_audience: 'shared_it' });
  return { ticketId, noteId };
}

const ticketRow = (ticketId: string) => db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).first();
const notesOf = (ticketId: string) => db('comments').where({ tenant: tenant(), ticket_id: ticketId }).select('comment_id', 'note');

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName: 's39_seat_ticket_read_scope_test' });
  // The gate's own resolver, pointed at this suite's database, with no verdict cached between steps.
  registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  dbRef.knex = db;

  // The seeded administrator: the MSP side of every assertion, with the permissions the seed gave it.
  const admin = await tenantDb(db, '__test_discovery__')
    .unscoped('users as u', 'test discovery of the seeded MSP administrator for seat read scope integration')
    .join('user_roles as ur', function () { this.on('ur.tenant', 'u.tenant').andOn('ur.user_id', 'u.user_id'); })
    .join('roles as r', function () { this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id'); })
    .where({ 'u.user_type': 'internal', 'r.role_name': 'Admin', 'r.msp': true })
    .select('u.tenant', 'u.user_id')
    .first();
  expect(admin).toBeTruthy();
  dbRef.tenant = admin.tenant;
  mspUser = await principal(admin.user_id);
  fixture = await createCloseRulesFixture(db, admin.tenant, admin.user_id);

  notShared = await insertBoard();
  otherClientId = randomUUID();
  await db('clients').insert({ ...(await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first()),
    client_id: otherClientId, client_name: `S39 destination client ${otherClientId.slice(0, 8)}` });

  await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId: fixture.clientId,
    operationId: randomUUID(), seats: 2 });
  arrangementId = arrangement.arrangement_id;
  await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId, boards: [{ boardId: fixture.boardId, canCreate: true }] });

  // A role that grants ticket:read and nothing else, the seeded permission row.
  const ticketRead = await db('permissions').where({ tenant: tenant(), resource: 'ticket', action: 'read', msp: true }).first();
  expect(ticketRead).toBeTruthy();
  const roleId = randomUUID();
  await db('roles').insert({ tenant: tenant(), role_id: roleId, role_name: `S39 seat read only ${roleId.slice(0, 8)}`, msp: true, client: false });
  await db('role_permissions').insert({ tenant: tenant(), role_id: roleId, permission_id: ticketRead.permission_id });
  technician = await insertSeatTechnician('assignee', roleId);
  colleague = await insertSeatTechnician('colleague', roleId);
}, HOOK_TIMEOUT);

afterAll(async () => {
  delete process.env.CAPABILITY_CACHE_TTL_MS;
  await db?.destroy().catch(() => undefined);
});

describe('a seat technician loses a ticket that leaves the arrangement, and the MSP keeps it with its notes (F094)', () => {
  const MOVES: Array<[string, () => Record<string, unknown>, (row: any) => void]> = [
    ['moved to a board the arrangement does not share',
      () => ({ board_id: notShared.boardId, status_id: notShared.statusId }),
      (row) => expect(row.board_id).toBe(notShared.boardId)],
    ['moved to another client',
      () => ({ client_id: otherClientId, contact_name_id: null }),
      (row) => expect(row.client_id).toBe(otherClientId)],
  ];

  it.each(MOVES)('a ticket %s', async (_name, patch, expectMoved) => {
    const { ticketId, noteId } = await ticketWithClientIt();

    // Before: both technicians of the arrangement, and the MSP, read the ticket and the shared note.
    await expectReadable(technician, ticketId, noteId);
    await expectReadable(colleague, ticketId, noteId);
    await expectReadable(mspUser, ticketId, noteId);

    // The MSP user moves it on the ticket screen.
    expect(await as(mspUser, () => updateTicketWithCache(ticketId, patch() as any))).toBe('success');
    expectMoved(await ticketRow(ticketId));
    expect((await ticketRow(ticketId)).assigned_to).toBeNull();

    // After: no technician reads the ticket or any of its comments, on their very next request.
    await expectDenied(technician, ticketId, noteId);
    await expectDenied(colleague, ticketId, noteId);

    // The MSP still does, and the shared note is the row it was.
    await expectReadable(mspUser, ticketId, noteId);
    expect(await notesOf(ticketId)).toContainEqual({ comment_id: noteId, note: SHARED_NOTE });
  }, HOOK_TIMEOUT);

  it('a ticket that stays in the arrangement stays readable, and one moved back in is readable again', async () => {
    const { ticketId, noteId } = await ticketWithClientIt();
    const untouched = await ticketWithClientIt();

    expect(await as(mspUser, () => updateTicketWithCache(ticketId, { board_id: notShared.boardId, status_id: notShared.statusId } as any)))
      .toBe('success');
    await expectDenied(technician, ticketId, noteId);
    await expectReadable(technician, untouched.ticketId, untouched.noteId);

    expect(await as(mspUser, () => updateTicketWithCache(ticketId, { board_id: fixture.boardId, status_id: fixture.openStatusId } as any)))
      .toBe('success');
    await expectReadable(technician, ticketId, noteId);
    // Back in scope is not back with client IT: the MSP keeps the turn and nobody is assigned.
    expect(await readCoManagedSeatTicketWork(db, { sponsorTenant: tenant(), ticketId }))
      .toMatchObject({ arrangementId, responsibility: 'msp' });
    expect((await ticketRow(ticketId)).assigned_to).toBeNull();
  }, HOOK_TIMEOUT);

  it('a technician without ticket:read reads nothing, in scope or out', async () => {
    const { ticketId, noteId } = await ticketWithClientIt();
    const roleless = { ...technician, roles: [] };
    await db('user_roles').where({ tenant: tenant(), user_id: technician.user_id }).del();
    try {
      for (const [name, request] of Object.entries(readsOf(roleless, ticketId, noteId))) {
        // The REST routes check the permission in the controller's middleware, ahead of the code this drives.
        if (name === 'the REST ticket and comment routes') continue;
        expect((await request()).granted, name).toBe(false);
      }
    } finally {
      await db('user_roles').insert(technician.roles.map((role: any) => ({ tenant: tenant(), user_id: technician.user_id, role_id: role.role_id })));
    }
  }, HOOK_TIMEOUT);
});
