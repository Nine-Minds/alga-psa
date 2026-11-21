/**
 * Co-managed seat and workspace shapes, slice S21 (F050 / F051 / T028) on real Postgres: what a seat
 * technician may create and edit on a ticket.
 *
 * Nothing about permissions is mocked. The technician is a real internal user holding a role with
 * `ticket:create`, `ticket:read` and `ticket:update`, and RBAC and the authorization kernel both run
 * against their rows. Only the session is injected (there is no app server), so each write is the
 * function the screen or the REST route calls, run as the signed-in principal:
 *
 *  - create: the ticket form action (`addTicket`) and the REST service (`TicketService.create`)
 *  - edit: the ticket screen save (`updateTicketWithCache`) and the REST service (`TicketService.update`)
 *
 * The control case runs the same cross-client and cross-board writes as an MSP administrator.
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
import { createCoManagedSeatArrangement, readCoManagedSeatTicketWork, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { tenantDb } from '@alga-psa/db';
import { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } from '@alga-psa/authorization/bundles/service';
import { updateTicketWithCache } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { addTicket, updateTicket } from '../../../../packages/tickets/src/actions/ticketActions';
import { TicketService } from '../../lib/api/services/TicketService';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;

type Board = { boardId: string; statusId: string };

let db: Knex;
let fixture: CloseRulesFixture;
let arrangementId: string;
let mspUser: any;
let technician: any;
/** A board in the arrangement's scope that does not admit creation. */
let readOnlyBoard: Board;
/** A second board in scope that admits creation. */
let secondBoard: Board;
/** A board the arrangement does not share. */
let outsideBoard: Board;
let otherClientId: string;
let otherContactId: string;

const tenant = () => fixture.tenantId;

async function principal(userId: string): Promise<any> {
  const user = await db('users').where({ tenant: dbRef.tenant, user_id: userId }).first();
  const roles = await db('user_roles as ur').join('roles as r', function () {
    this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id');
  }).where({ 'ur.tenant': dbRef.tenant, 'ur.user_id': userId }).select('r.*');
  return { ...user, roles };
}

async function insertBoard(label: string): Promise<Board> {
  const [boardId, statusId] = [randomUUID(), randomUUID()];
  await db('boards').insert({ tenant: tenant(), board_id: boardId, board_name: `S21 ${label} ${boardId.slice(0, 8)}`,
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

const restContext = (user: any) => ({ tenant: tenant(), userId: user.user_id, user }) as any;
const ticketRow = (ticketId: string) => db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).first();
const ticketCount = async () => Number((await db('tickets').where({ tenant: tenant() }).count('* as n').first())!.n);
const work = (ticketId: string) => readCoManagedSeatTicketWork(db, { sponsorTenant: tenant(), ticketId });

function createForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    title: `S21 ticket ${randomUUID().slice(0, 8)}`, description: 'Raised from the client side',
    client_id: fixture.clientId, contact_name_id: fixture.contactId, board_id: fixture.boardId,
    status_id: fixture.openStatusId, priority_id: fixture.priorityId, ...fields,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

/** Either the ticket form action or the REST service, as `user`. Resolves to the created ticket id, or the refusal. */
type Outcome = { ok: true; ticketId: string } | { ok: false; message: string };
const settle = async (run: () => Promise<any>): Promise<Outcome> => {
  try {
    const result = await run();
    if (result?.ticket_id) return { ok: true, ticketId: result.ticket_id };
    return { ok: false, message: JSON.stringify(result) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
const createVia = {
  'the ticket form action': (user: any, fields: Record<string, string>) =>
    settle(() => as(user, () => addTicket(createForm(fields)))),
  'the REST service': (user: any, fields: Record<string, string>) =>
    settle(() => new TicketService().create({ title: `S21 rest ${randomUUID().slice(0, 8)}`, client_id: fixture.clientId,
      contact_name_id: fixture.contactId, board_id: fixture.boardId, status_id: fixture.openStatusId,
      priority_id: fixture.priorityId, ...fields } as any, restContext(user))),
};
const editVia = {
  'the ticket screen save': async (user: any, ticketId: string, patch: Record<string, unknown>): Promise<Outcome> =>
    settle(async () => {
      const result = await as(user, () => updateTicketWithCache(ticketId, patch as any));
      if (result !== 'success') return result;
      return { ticket_id: ticketId };
    }),
  'the ticket form update action': async (user: any, ticketId: string, patch: Record<string, unknown>): Promise<Outcome> =>
    settle(async () => {
      const result = await as(user, () => updateTicket(ticketId, patch as any));
      if (result !== 'success') return result;
      return { ticket_id: ticketId };
    }),
  'the REST service': async (user: any, ticketId: string, patch: Record<string, unknown>): Promise<Outcome> =>
    settle(async () => { await new TicketService().update(ticketId, patch as any, restContext(user)); return { ticket_id: ticketId }; }),
};

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName: 's21_seat_ticket_create_edit_test' });
  // The gate's own resolver, pointed at this suite's database, with no verdict cached between steps.
  registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  dbRef.knex = db;

  const admin = await tenantDb(db, '__test_discovery__')
    .unscoped('users as u', 'test discovery of the seeded MSP administrator for seat ticket create and edit integration')
    .join('user_roles as ur', function () { this.on('ur.tenant', 'u.tenant').andOn('ur.user_id', 'u.user_id'); })
    .join('roles as r', function () { this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id'); })
    .where({ 'u.user_type': 'internal', 'r.role_name': 'Admin', 'r.msp': true })
    .select('u.tenant', 'u.user_id')
    .first();
  expect(admin).toBeTruthy();
  dbRef.tenant = admin.tenant;
  mspUser = await principal(admin.user_id);
  fixture = await createCloseRulesFixture(db, admin.tenant, admin.user_id);

  [readOnlyBoard, secondBoard, outsideBoard] = [await insertBoard('read only'), await insertBoard('second'), await insertBoard('outside')];
  otherClientId = randomUUID();
  otherContactId = randomUUID();
  const ownClient = await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first();
  await db('clients').insert({ ...ownClient, client_id: otherClientId, client_name: `S21 other client ${otherClientId.slice(0, 8)}` });
  const ownContact = await db('contacts').where({ tenant: tenant(), contact_name_id: fixture.contactId }).first();
  await db('contacts').insert({ ...ownContact, contact_name_id: otherContactId, client_id: otherClientId,
    full_name: 'Other Client Contact', email: `s21-${otherContactId.slice(0, 8)}@example.com` });

  await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId: fixture.clientId,
    operationId: randomUUID(), seats: 2 });
  arrangementId = arrangement.arrangement_id;
  await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId, boards: [
    { boardId: fixture.boardId, canCreate: true },
    { boardId: secondBoard.boardId, canCreate: true },
    { boardId: readOnlyBoard.boardId, canCreate: false },
  ] });

  // A role that grants ticket create, read and update and nothing else: the seeded permission rows.
  const roleId = randomUUID();
  await db('roles').insert({ tenant: tenant(), role_id: roleId, role_name: `S21 seat ticket writer ${roleId.slice(0, 8)}`, msp: true, client: false });
  for (const action of ['create', 'read', 'update']) {
    const permission = await db('permissions').where({ tenant: tenant(), resource: 'ticket', action, msp: true }).first();
    expect(permission, `ticket:${action}`).toBeTruthy();
    await db('role_permissions').insert({ tenant: tenant(), role_id: roleId, permission_id: permission.permission_id });
  }
  const userId = randomUUID();
  await db('users').insert({ tenant: tenant(), user_id: userId, username: `s21-${userId.slice(0, 8)}`, first_name: 'Seat', last_name: 'Writer',
    hashed_password: 'not-used', user_type: 'internal', email: `s21-${userId.slice(0, 8)}@example.com` });
  await db('user_roles').insert({ tenant: tenant(), user_id: userId, role_id: roleId });
  await db.transaction(async (trx) => {
    await retainBuiltinResolverSubject(trx, { tenant: tenant(), userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await trx('co_managed_seat_assignments').insert({ tenant: tenant(), assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state: 'active' });
  });
  technician = await principal(userId);
}, HOOK_TIMEOUT);

afterAll(async () => {
  delete process.env.CAPABILITY_CACHE_TTL_MS;
  await db?.destroy().catch(() => undefined);
});

describe.each(Object.entries(createVia))('a seat technician creates a ticket through %s (F050)', (_via, create) => {
  it('succeeds for their own client, on a creatable board, with an own-client contact, and starts with client IT', async () => {
    const outcome = await create(technician, {});
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    const ticketId = (outcome as { ticketId: string }).ticketId;
    expect(await ticketRow(ticketId)).toMatchObject({ client_id: fixture.clientId, board_id: fixture.boardId, contact_name_id: fixture.contactId });
    expect(await work(ticketId)).toMatchObject({ arrangementId, responsibility: 'client_it' });
  }, HOOK_TIMEOUT);

  it('is refused for another client, and confirms nothing about it', async () => {
    const before = await ticketCount();
    const outcome = await create(technician, { client_id: otherClientId, contact_name_id: otherContactId });
    expect(outcome).toMatchObject({ ok: false });
    const message = (outcome as { message: string }).message;
    expect(message).toMatch(/Permission denied/);
    expect(message).not.toContain(otherClientId);
    expect(await ticketCount()).toBe(before);
  }, HOOK_TIMEOUT);

  it('is refused on a board in scope that does not admit creation, and on a board outside it', async () => {
    const before = await ticketCount();
    for (const board of [readOnlyBoard, outsideBoard]) {
      const outcome = await create(technician, { board_id: board.boardId, status_id: board.statusId });
      expect(outcome, board.boardId).toMatchObject({ ok: false });
      expect((outcome as { message: string }).message).toMatch(/Permission denied/);
    }
    expect(await ticketCount()).toBe(before);
  }, HOOK_TIMEOUT);

  it('is refused with a contact of another client', async () => {
    const before = await ticketCount();
    const outcome = await create(technician, { contact_name_id: otherContactId });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toMatch(/Permission denied/);
    expect(await ticketCount()).toBe(before);
  }, HOOK_TIMEOUT);
});

describe.each(Object.entries(editVia))('a seat technician edits a ticket through %s (F051)', (_via, edit) => {
  it('may change the native fields of a ticket in scope', async () => {
    const ticketId = await insertTicket(db, fixture);
    const outcome = await edit(technician, ticketId, { title: 'Renamed by client IT', priority_id: fixture.priorityId });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    expect(await ticketRow(ticketId)).toMatchObject({ title: 'Renamed by client IT' });
  }, HOOK_TIMEOUT);

  it('may save a ticket back with its own client, board and contact', async () => {
    const ticketId = await insertTicket(db, fixture);
    const outcome = await edit(technician, ticketId, { title: 'Same placement', client_id: fixture.clientId, board_id: fixture.boardId });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
  }, HOOK_TIMEOUT);

  it('is refused a change of client, and the ticket is left as it was', async () => {
    const ticketId = await insertTicket(db, fixture);
    const outcome = await edit(technician, ticketId, { client_id: otherClientId, contact_name_id: null, title: 'Moved away' });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).not.toContain(otherClientId);
    expect(await ticketRow(ticketId)).toMatchObject({ client_id: fixture.clientId, title: expect.not.stringMatching(/^Moved away$/) });
  }, HOOK_TIMEOUT);

  it('is refused a move to a board outside the arrangement, and may move to another board in scope', async () => {
    const ticketId = await insertTicket(db, fixture);
    const refused = await edit(technician, ticketId, { board_id: outsideBoard.boardId, status_id: outsideBoard.statusId });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { message: string }).message).toMatch(/Permission denied/);
    expect(await ticketRow(ticketId)).toMatchObject({ board_id: fixture.boardId });

    const moved = await edit(technician, ticketId, { board_id: secondBoard.boardId, status_id: secondBoard.statusId });
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true });
    expect(await ticketRow(ticketId)).toMatchObject({ board_id: secondBoard.boardId });
  }, HOOK_TIMEOUT);

  it('is refused a contact of another client, and may set one of their own', async () => {
    const ticketId = await insertTicket(db, fixture, { contact_name_id: null });
    const refused = await edit(technician, ticketId, { contact_name_id: otherContactId });
    expect(refused).toMatchObject({ ok: false });
    expect(await ticketRow(ticketId)).toMatchObject({ contact_name_id: null });

    const set = await edit(technician, ticketId, { contact_name_id: fixture.contactId });
    expect(set, JSON.stringify(set)).toMatchObject({ ok: true });
  }, HOOK_TIMEOUT);
});

describe.each(Object.entries(editVia))('control: an MSP administrator through %s is unaffected', (_via, edit) => {
  it('creates for another client, on any board, with that client\'s contact', async () => {
    const outcome = await createVia['the ticket form action'](mspUser, { client_id: otherClientId, contact_name_id: otherContactId,
      board_id: outsideBoard.boardId, status_id: outsideBoard.statusId });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    // Not a seat technician's ticket: nothing is written, and it starts with the MSP as it always has.
    expect(await work((outcome as { ticketId: string }).ticketId)).toBeNull();
    const own = await createVia['the ticket form action'](mspUser, {});
    expect(own).toMatchObject({ ok: true });
    expect(await work((own as { ticketId: string }).ticketId)).toMatchObject({ responsibility: 'msp' });
  }, HOOK_TIMEOUT);

  it('moves a ticket to another client and to a board the arrangement does not share', async () => {
    const ticketId = await insertTicket(db, fixture);
    expect(await edit(mspUser, ticketId, { board_id: outsideBoard.boardId, status_id: outsideBoard.statusId })).toMatchObject({ ok: true });
    expect(await ticketRow(ticketId)).toMatchObject({ board_id: outsideBoard.boardId });
    expect(await edit(mspUser, ticketId, { client_id: otherClientId, contact_name_id: otherContactId })).toMatchObject({ ok: true });
    expect(await ticketRow(ticketId)).toMatchObject({ client_id: otherClientId, contact_name_id: otherContactId });
  }, HOOK_TIMEOUT);
});

// A real narrowing bundle (not a seat) that keeps an MSP user off the ticket's board. Legacy `updateTicket` and the REST
// service judged the stored row not at all (the REST controller's own hook does that), and still do; the ticket screen
// save has always refused. The seat work adds nothing for this user on any of them: the outcomes are origin/main's.
describe('control: an MSP user a narrowing bundle keeps off the ticket\'s board gets the outcomes they always did', () => {
  let bundleId: string;
  beforeAll(async () => {
    const created = await createAuthorizationBundle(db, { tenant: tenant(), name: `S21 board narrowing ${randomUUID()}`, actorUserId: mspUser.user_id });
    bundleId = created.bundleId;
    for (const action of ['read', 'update']) {
      await upsertBundleRule(db, { tenant: tenant(), bundleId, revisionId: created.revisionId, resourceType: 'ticket', action,
        templateKey: 'selected_boards', config: { selectedBoardIds: [randomUUID()] }, actorUserId: mspUser.user_id });
    }
    await publishBundleRevision(db as any, { tenant: tenant(), bundleId, revisionId: created.revisionId, actorUserId: mspUser.user_id });
    await createBundleAssignment(db, { tenant: tenant(), bundleId, targetType: 'user', targetId: mspUser.user_id, actorUserId: mspUser.user_id });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    const t = (table: string) => tenantDb(db, tenant()).table(table);
    await t('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundle_rules').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundles').where({ bundle_id: bundleId }).update({ published_revision_id: null });
    await t('authorization_bundle_revisions').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundles').where({ bundle_id: bundleId }).delete();
  }, HOOK_TIMEOUT);

  it.each([
    ['the ticket form update action', editVia['the ticket form update action'], true],
    ['the REST service', editVia['the REST service'], true],
    ['the ticket screen save', editVia['the ticket screen save'], false],
  ] as const)('%s', async (_name, edit, succeeds) => {
    const ticketId = await insertTicket(db, fixture);
    const outcome = await edit(mspUser, ticketId, { title: 'Edited under a narrowing bundle' });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(succeeds);
  }, HOOK_TIMEOUT);
});

// Statement count for a non-seat update. The ticket screen save is held by hotPathQueryBudget's `ticket.update` step
// (16 statements, unchanged). For legacy `updateTicket` and the REST service the seat gate stops at the cached tenant
// probe and the subject's facts for a user no resolver governs: it never loads the policy snapshot (bundle rules) or
// evaluates the stored row, which is what the earlier full-authorization version did.
describe('control: the seat gate adds no authorization evaluation for a non-seat update', () => {
  it.each([
    ['the ticket form update action', editVia['the ticket form update action']],
    ['the REST service', editVia['the REST service']],
  ] as const)('%s loads no policy snapshot, only the tenant probe', async (_name, edit) => {
    const ticketId = await insertTicket(db, fixture);
    const statements: string[] = [];
    const record = (query: { sql: string }) => statements.push(query.sql);
    db.on('query', record);
    try {
      expect(await edit(mspUser, ticketId, { title: 'Counted' })).toMatchObject({ ok: true });
    } finally {
      db.removeListener('query', record);
    }
    // The one statement that touches bundle tables is the tenant probe (`publishedAssignments`), not a snapshot load.
    const bundleReads = statements.filter((sql) => /authorization_bundle/.test(sql));
    expect(bundleReads).toHaveLength(1);
    expect(bundleReads[0]).toContain('publishedAssignments');
  }, HOOK_TIMEOUT);
});
