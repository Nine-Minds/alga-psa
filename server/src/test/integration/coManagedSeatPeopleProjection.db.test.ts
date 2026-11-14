/**
 * Co-managed seat and workspace shapes, slice S14 (F033 / T019) on real Postgres.
 *
 * The people a seat technician can see are projected: MSP staff who participate on a ticket the
 * technician can see (name and avatar only), the technicians of their own client, and their client's
 * contacts. Every user list, assignee option source and mention source answers from that projection.
 * An ordinary internal user gets the same lists as before.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { runWithTenant } from '@alga-psa/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  tenant: '',
  user: { user_id: '', user_type: 'internal' as 'internal' | 'client' },
  db: null as unknown,
  seatUserIds: new Set<string>(),
}));
const withAuthMock = vi.hoisted(() => () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ ...testState.user, tenant: testState.tenant }, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/withAuth', withAuthMock);
vi.mock('@alga-psa/auth', () => ({
  ...withAuthMock(),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action({ ...testState.user, tenant: testState.tenant }, { tenant: testState.tenant }, ...args),
  getCurrentUser: vi.fn(),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
  checkMultiplePermissions: vi.fn(async (_user: unknown, checks: Array<{ resource: string; action: string }>) =>
    checks.map((check) => ({ ...check, granted: true }))),
}));
// The seat role holds no `user:read`; the ordinary user in these tests does. The projection must decide the
// seat technician's answer whichever way this goes, so it answers from the caller's role as the real one does.
vi.mock('../../../../packages/user-composition/src/lib/permissions', () => ({
  hasPermission: vi.fn(async (user: { user_id: string }) => user.user_id !== testState.user.user_id || testState.user.user_type === 'internal' && !testState.seatUserIds.has(user.user_id)),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testState.db, tenant: testState.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction((trx) => callback(trx)),
  };
});

import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import * as userActions from '../../../../packages/user-composition/src/actions/userQueryActions';
import { searchUsersForMentions as searchMentions } from '../../../../packages/user-composition/src/actions/searchUsersForMentions';
import { listUsersForInboundWebhook as listWebhookUsers } from '../../lib/actions/inboundWebhookLookups';
import { getConsolidatedTicketData as consolidatedTicketData, getTicketFormOptions as ticketFormOptions } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
/** The request context createTenantKnex establishes for a real action call. */
const inTenant = <F extends (...args: any[]) => Promise<any>>(action: F) =>
  ((...args: any[]) => runWithTenant(testState.tenant, () => action(...args))) as F;
const { getAllUsers, getAllUsersBasic, getClientUsersForClient, getMultipleUsersWithRoles } = {
  getAllUsers: inTenant(userActions.getAllUsers),
  getAllUsersBasic: inTenant(userActions.getAllUsersBasic),
  getClientUsersForClient: inTenant(userActions.getClientUsersForClient),
  getMultipleUsersWithRoles: inTenant(userActions.getMultipleUsersWithRoles),
};
const searchUsersForMentions = inTenant(searchMentions);
const listUsersForInboundWebhook = inTenant(listWebhookUsers);
const getTicketFormOptions = inTenant(ticketFormOptions);
const getConsolidatedTicketData = inTenant(consolidatedTicketData);
const describeDb = await describeWithDb();

describeDb('a seat technician sees only the projected people', { shuffle: false }, () => {
  let db: Knex;
  const tag = randomUUID().slice(0, 6);

  const s: Record<string, any> = {};
  /** Staff carry an email, phone and username that must never reach a seat technician. */
  const staff = (name: string) => createUser(db, s.tenant, {
    user_type: 'internal', first_name: name, last_name: `Staff${tag}`, email: `${name.toLowerCase()}.${tag}@msp-secret.test`,
    username: `${name.toLowerCase()}-login-${tag}`, phone: `+1-555-${name.length}${tag.replace(/\D/g, '').padEnd(4, '7')}`,
  });
  const seatTechnician = async (arrangementId: string, name: string) => {
    const userId = await createUser(db, s.tenant, { user_type: 'internal', first_name: name, last_name: `Tech${tag}`, email: `${name.toLowerCase()}.${tag}@client.test` });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant: s.tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant: s.tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: userId, state: 'active' });
    });
    testState.seatUserIds.add(userId);
    return userId;
  };
  const board = async (name: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant: s.tenant, board_id: boardId, board_name: `${name} ${tag}`, is_default: false });
    return boardId;
  };
  const ticket = async (clientId: string, boardId: string, assignedTo: string | null, additional: string[] = [], enteredBy: string | null = null) => {
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: s.tenant, ticket_id: ticketId, ticket_number: `T-${randomUUID().slice(0, 8)}`, title: 'Seat people', status_id: s.statusId,
      priority_id: s.priorityId, board_id: boardId, client_id: clientId, assigned_to: assignedTo, entered_by: enteredBy, entered_at: new Date(), updated_at: new Date() });
    for (const userId of additional) {
      await db('ticket_resources').insert({ tenant: s.tenant, ticket_id: ticketId, assigned_to: assignedTo, additional_user_id: userId });
    }
    return ticketId;
  };
  const contact = async (clientId: string, name: string, options: { inactive?: boolean; portal?: boolean } = {}) => {
    const contactId = randomUUID();
    await db('contacts').insert({ tenant: s.tenant, contact_name_id: contactId, client_id: clientId, full_name: `${name} ${tag}`, email: `${name.toLowerCase()}.${tag}@contact.test`, is_inactive: options.inactive ?? false });
    const userId = options.portal
      ? await createUser(db, s.tenant, { user_type: 'client', contact_id: contactId, first_name: name, last_name: `Portal${tag}`, email: `${name.toLowerCase()}.portal.${tag}@contact.test` })
      : null;
    return { contactId, userId };
  };
  const as = (userId: string, userType: 'internal' | 'client' = 'internal') => { testState.user = { user_id: userId, user_type: userType }; };
  const ids = (rows: Array<{ user_id: string }>) => rows.map((row) => row.user_id).sort();

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's14_seat_people_test' });
    testState.db = db;
    s.tenant = await createTenant(db, `Seat people ${tag}`, { productCode: 'psa' });
    testState.tenant = s.tenant;
    await db('co_managed_entitlements').insert({ tenant: s.tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    s.statusId = randomUUID();
    s.priorityId = randomUUID();
    await db('statuses').insert({ tenant: s.tenant, status_id: s.statusId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false, created_by: null });
    await db('priorities').insert({ tenant: s.tenant, priority_id: s.priorityId, priority_name: 'Normal', order_number: 1, color: '#000000', item_type: 'ticket', created_by: null });

    s.clientX = await createClient(db, s.tenant, `Client X ${tag}`);
    s.clientY = await createClient(db, s.tenant, `Client Y ${tag}`);
    const [boardIn1, boardIn2, boardOut, boardY] = [await board('In1'), await board('In2'), await board('Out'), await board('Y')];
    const arrX = (await createCoManagedSeatArrangement(db, { sponsorTenant: s.tenant, clientId: s.clientX, operationId: randomUUID(), seats: 3 })).arrangement_id;
    const arrY = (await createCoManagedSeatArrangement(db, { sponsorTenant: s.tenant, clientId: s.clientY, operationId: randomUUID(), seats: 2 })).arrangement_id;
    const arrZ = (await createCoManagedSeatArrangement(db, { sponsorTenant: s.tenant, clientId: await createClient(db, s.tenant, `Client Z ${tag}`), operationId: randomUUID(), seats: 1 })).arrangement_id;
    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: arrX, boards: [{ boardId: boardIn1, canCreate: true }, { boardId: boardIn2, canCreate: false }] });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: arrY, boards: [{ boardId: boardY, canCreate: false }] });
    s.arrX = arrX; s.arrZ = arrZ;

    s.A = await seatTechnician(arrX, 'Alpha');
    s.B = await seatTechnician(arrX, 'Bravo');
    s.C = await seatTechnician(arrY, 'Charlie');
    s.E = await seatTechnician(arrZ, 'Echo');
    s.S1 = await staff('Sierra'); s.S2 = await staff('Sable'); s.S3 = await staff('Slate'); s.S4 = await staff('Sepia'); s.S5 = await staff('Smoke');
    s.S6 = await staff('Sand');
    s.ordinary = await staff('Ordinary');
    await db('users').where({ tenant: s.tenant, user_id: s.S6 }).update({ is_inactive: true });

    // S1 assigned, in scope; opened by S5, who participates nowhere (a referenced person, released by name only).
    s.ticketIn = await ticket(s.clientX, boardIn1, s.S1, [], s.S5);
    await ticket(s.clientX, boardIn2, s.B, [s.S2]);                  // S2 additional agent, in scope
    await ticket(s.clientX, boardOut, s.S3);                         // S3 only out of scope board
    await ticket(s.clientY, boardY, s.S4);                           // S4 only on a client Y ticket
    await ticket(s.clientX, boardIn1, s.S6);                         // inactive participant

    s.cx1 = await contact(s.clientX, 'Xena', { portal: true });
    await contact(s.clientX, 'Xavier');
    await contact(s.clientX, 'Xander', { inactive: true, portal: true });
    s.cy1 = await contact(s.clientY, 'Yara', { portal: true });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { testState.db = db; testState.tenant = s.tenant; });

  const expectedInternal = () => [s.S1, s.S2, s.A, s.B].sort();

  it('the seat role does not hold user:read, so the projection alone decides', () => {
    expect(CO_MANAGED_SEAT_ROLE_GRANTS as readonly string[]).not.toContain('user:read');
  });

  it('user list: exactly the projection, MSP staff by name only', async () => {
    as(s.A);
    const users = await getAllUsers();
    expect(ids(users)).toEqual([...expectedInternal(), s.cx1.userId].sort());
    for (const excluded of [s.S3, s.S4, s.S5, s.S6, s.C, s.E, s.ordinary, s.cy1.userId]) expect(ids(users)).not.toContain(excluded);

    expect(ids(await getAllUsersBasic(true, 'internal'))).toEqual(expectedInternal());
    expect(ids(await getAllUsersBasic(true, 'client'))).toEqual([s.cx1.userId]);
    expect(ids(await getMultipleUsersWithRoles([s.S1, s.S3, s.cy1.userId, s.B]))).toEqual([s.S1, s.B].sort());
    expect(ids(await getClientUsersForClient(s.clientX))).toEqual([s.cx1.userId]);
    expect(await getClientUsersForClient(s.clientY)).toEqual([]);
  });

  it('assignee options (ticket form options and the user lookups) are the projection', async () => {
    as(s.A);
    const options = await getTicketFormOptions() as any;
    expect(ids(options.users)).toEqual(expectedInternal());
    expect(options.agentOptions.map((o: any) => o.value).sort()).toEqual(expectedInternal());
    expect(ids(await listUsersForInboundWebhook())).toEqual(expectedInternal());
  });

  it('the ticket screen (consolidated ticket data) offers the projection and names referenced staff only', async () => {
    as(s.A);
    const data = await getConsolidatedTicketData(s.ticketIn) as any;
    expect(data?.ticket?.ticket_id).toBe(s.ticketIn);
    expect(ids(data.availableAgents)).toEqual(expectedInternal());
    expect(data.options.agent.map((o: any) => o.value).sort()).toEqual(expectedInternal());
    expect(Object.keys(data.userMap).filter((userId) => [s.S3, s.S4, s.S5, s.C, s.E, s.ordinary].includes(userId))).toEqual([]);
    expect(data.createdByUser.user_id).toBe(s.S5);
    expect(data.createdByUser.first_name).toBe('Smoke');
    const serialized = JSON.stringify({ agents: data.availableAgents, userMap: data.userMap, createdBy: data.createdByUser, updatedBy: data.updatedByUser });
    expect(serialized).not.toContain('msp-secret.test');
    expect(serialized).not.toContain('-login-');
    expect(serialized).not.toContain('+1-555-');

    as(s.ordinary);
    const full = await getConsolidatedTicketData(s.ticketIn) as any;
    expect(ids(full.availableAgents)).toContain(s.S3);
    expect(full.createdByUser.email).toContain('msp-secret.test');
  });

  it('mention suggestions are the projection and carry no MSP contact detail', async () => {
    as(s.A);
    const mentions = await searchUsersForMentions('');
    expect(mentions.map((m) => m.user_id).sort()).toEqual(expectedInternal());
    const narrowed = await searchUsersForMentions('sierra');
    expect(narrowed.map((m) => m.user_id)).toEqual([s.S1]);
    expect((await searchUsersForMentions('slate'))).toEqual([]);
    for (const mention of mentions.filter((m) => [s.S1, s.S2].includes(m.user_id))) {
      expect(mention.email).toBe('');
      expect(mention.username).toBe('');
      expect(mention.display_name).toMatch(/Staff/);
    }
  });

  it('no MSP staff contact field reaches the technician, checked on the serialized output', async () => {
    as(s.A);
    const surfaces = {
      all: await getAllUsers(),
      basic: await getAllUsersBasic(),
      mentions: await searchUsersForMentions(''),
      form: ((await getTicketFormOptions()) as any).users,
      webhook: await listUsersForInboundWebhook(),
      multiple: await getMultipleUsersWithRoles([s.S1, s.S2]),
    };
    const staffRows = (rows: any[]) => rows.filter((row) => [s.S1, s.S2].includes(row.user_id));
    for (const [name, rows] of Object.entries(surfaces)) {
      const serialized = JSON.parse(JSON.stringify(staffRows(rows as any[])));
      expect(serialized.length, name).toBeGreaterThan(0);
      for (const row of serialized) {
        for (const key of ['email', 'phone', 'phone_extension', 'username', 'timezone', 'hashed_password', 'two_factor_secret', 'reports_to', 'last_login_at']) {
          expect(row[key] === undefined || row[key] === null || row[key] === '', `${name}.${key}`).toBe(true);
        }
        expect(row.roles ?? []).toEqual([]);
      }
    }
    const everything = JSON.stringify(surfaces);
    expect(everything).not.toContain('msp-secret.test');
    expect(everything).not.toContain('-login-');
    expect(everything).not.toContain('+1-555-');
  });

  it('a revoked or ended seat sees nobody, and never falls back to the full list', async () => {
    as(s.A);
    await db('co_managed_seat_assignments').where({ tenant: s.tenant, user_id: s.E }).update({ state: 'revoked', revoked_at: new Date() });
    as(s.E);
    expect(await getAllUsers()).toEqual([]);
    expect(await getAllUsersBasic()).toEqual([]);
    expect(await searchUsersForMentions('')).toEqual([]);
    expect(((await getTicketFormOptions()) as any).users).toEqual([]);

    // An ended arrangement: the technician's assignment is still active, the arrangement is not.
    const ended = await seatTechnician(s.arrX, 'Delta');
    as(ended);
    expect((await getAllUsersBasic()).length).toBeGreaterThan(0);
    await db('co_managed_seat_arrangements').where({ tenant: s.tenant, arrangement_id: s.arrX }).update({ state: 'ended', ended_at: new Date() });
    expect(await getAllUsers()).toEqual([]);
    expect(await searchUsersForMentions('')).toEqual([]);
    await db('co_managed_seat_arrangements').where({ tenant: s.tenant, arrangement_id: s.arrX }).update({ state: 'active', ended_at: null });
  });

  it('an ordinary internal user still gets the full unchanged list', async () => {
    as(s.ordinary);
    const everyone = await db('users').where({ tenant: s.tenant, is_inactive: false }).whereIn('user_type', ['internal', 'client']);
    expect(ids(await getAllUsers(false))).toEqual(ids(everyone));
    const full = (await getAllUsersBasic(true, 'internal')).find((user) => user.user_id === s.S1)!;
    expect(full.email).toContain('msp-secret.test');
    expect(ids(await searchUsersForMentions('')).length).toBeGreaterThan(4);
    const options = await getTicketFormOptions() as any;
    expect(ids(options.users)).toContain(s.S3);
    expect(ids(options.users)).toContain(s.C);
  });

  it('a tenant without seat technicians reads no co_managed_ table on these paths', async () => {
    const plain = await createTenant(db, `Plain ${tag}`, { productCode: 'psa' });
    const plainUser = await createUser(db, plain, { user_type: 'internal' });
    testState.tenant = plain;
    as(plainUser);
    const statements: string[] = [];
    const onQuery = (query: { sql: string }) => { statements.push(query.sql); };
    db.on('query', onQuery);
    try {
      expect((await getAllUsers()).length).toBe(1);
      expect((await getAllUsersBasic()).length).toBe(1);
      expect((await searchUsersForMentions('')).length).toBe(1);
      expect(((await getTicketFormOptions()) as any).users.length).toBe(1);
      expect((await listUsersForInboundWebhook()).length).toBe(1);
    } finally {
      db.removeListener('query', onQuery);
    }
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /co_managed_/.test(sql))).toEqual([]);
  });
});
