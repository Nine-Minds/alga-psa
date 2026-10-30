/**
 * CM L3b1: real-Postgres checks for the co-managed ticket queue SQL and the
 * handoff state machine (no fake DB, no mocked admission wrappers).
 *
 * Fixture: one sponsor MSP workspace (psa) with a technician, and three
 * customer workspaces (co_managed). Customers A and B are assigned to the
 * technician and DELIBERATELY reuse ticket numbers 1001/1002; customer C has a
 * live relationship but no staff assignment for the technician.
 *
 * The lifecycle/write-admission providers are not registered (the repo default
 * for DB tests), so every workspace is writable; the access matrix, the
 * ticket/work/reference locks and the queue SQL are all real. The tests run in
 * order and share state.
 *
 * Each run uses its own scratch database, so it cannot disturb other suites.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  CoManagedTicketHandoffError,
  escalateCoManagedTicket,
  exportCoManagedTicketQueue,
  getCoManagedTicketQueue,
  handBackCoManagedTicket,
  revokeCoManagedTicketGrant,
  type CoManagedSessionActor,
  type CoManagedSharedResource,
  type CoManagedTicketQueueRequest,
} from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

interface Customer {
  tenant: string;
  relationshipId: string;
  sponsorClientId: string;
  admin: CoManagedSessionActor;
  boardScoped: string;
  boardUnscoped: string;
  tickets: Record<string, string>;
}

describeDb('co-managed ticket queue and handoffs on real Postgres', { shuffle: false }, () => {
  // The tests share state and depend on order; the repo's vitest config shuffles by default.
  let db: Knex;
  let msp: string;
  let mspBoard: string;
  let tech: CoManagedSessionActor;
  const A = {} as Customer, B = {} as Customer, C = {} as Customer;

  const expiresAt = () => new Date(Date.now() + 3600_000);

  async function grantRole(tenant: string, userId: string, permissions: Array<[string, string]>) {
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID();
      await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  }

  async function actorFor(tenant: string, permissions: Array<[string, string]>): Promise<CoManagedSessionActor> {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    await grantRole(tenant, userId, permissions);
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: expiresAt(), created_at: new Date() });
    return { kind: 'session', tenant, userId, sessionId };
  }

  async function seedCustomer(target: Customer, label: string, tickets: Array<[string, string, 'scoped' | 'unscoped', boolean]>, assigned: boolean) {
    target.tenant = await createTenant(db, `Customer ${label}`, { productCode: 'co_managed' });
    const customerClient = await createClient(db, target.tenant, `Customer ${label} client`);
    target.sponsorClientId = await createClient(db, msp, `Sponsor client for ${label}`);
    target.relationshipId = randomUUID();
    target.admin = await actorFor(target.tenant, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']]);
    target.boardScoped = randomUUID();
    target.boardUnscoped = randomUUID();
    await db('boards').insert([
      { tenant: target.tenant, board_id: target.boardScoped, board_name: `${label} scoped` },
      { tenant: target.tenant, board_id: target.boardUnscoped, board_name: `${label} unscoped` },
    ]);
    const openStatus = randomUUID(), closedStatus = randomUUID(), priority = randomUUID();
    await db('statuses').insert([
      { tenant: target.tenant, status_id: openStatus, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false },
      { tenant: target.tenant, status_id: closedStatus, name: 'Closed', status_type: 'ticket', order_number: 2, is_closed: true },
    ]);
    await db('priorities').insert({ tenant: target.tenant, priority_id: priority, priority_name: 'Normal', order_number: 1 });
    await db('co_management_relationships').insert({
      tenant: target.tenant, relationship_id: target.relationshipId, sponsor_tenant: msp, sponsor_client_id: target.sponsorClientId,
      state: 'active', visibility_mode: 'board_scope', escalation_board_id: mspBoard, accepted_by: target.admin.userId, accepted_at: new Date(),
    });
    await db('co_management_board_scopes').insert({ tenant: target.tenant, relationship_id: target.relationshipId, board_id: target.boardScoped, can_collaborate: true });
    if (assigned) {
      await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: target.tenant, relationship_id: target.relationshipId,
        principal_type: 'user', principal_id: tech.userId, relationship_role: 'technician' });
    }
    target.tickets = {};
    let seconds = 0;
    for (const [key, number, board, closed] of tickets) {
      const ticketId = randomUUID();
      target.tickets[key] = ticketId;
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds++));
      await db('tickets').insert({ tenant: target.tenant, ticket_id: ticketId, ticket_number: number, title: `${label} ${key} ticket ${number}`,
        client_id: customerClient, board_id: board === 'scoped' ? target.boardScoped : target.boardUnscoped,
        status_id: closed ? closedStatus : openStatus, priority_id: priority, is_closed: closed, entered_by: target.admin.userId,
        entered_at: stamp, updated_at: stamp });
    }
  }

  const resource = (c: Customer, key: string): CoManagedSharedResource => ({ tenant: c.tenant, relationshipId: c.relationshipId, kind: 'ticket', id: c.tickets[key] });
  const note = 'shared IT note';
  const rq = (view: 'working' | 'oversight', extra: Partial<CoManagedTicketQueueRequest> = {}) => getCoManagedTicketQueue(db, tech, { view, ...extra });
  const tag = (page: { items: Array<{ tenant: string; ticketId: string; fields: { ticket_number?: string | null } }> }) =>
    page.items.map(item => `${item.tenant === A.tenant ? 'A' : item.tenant === B.tenant ? 'B' : 'C'}:${item.fields.ticket_number}`).sort();
  const work = (c: Customer, key: string) => db('co_management_ticket_work').where({ tenant: c.tenant, relationship_id: c.relationshipId, ticket_id: c.tickets[key] }).first();
  const rowCounts = async () => Object.fromEntries(await Promise.all(['co_management_ticket_work', 'co_management_ticket_handoffs', 'co_managed_ticket_references']
    .map(async t => [t, Number((await db(t).count('* as n').first())!.n)])));
  const escalate = (c: Customer, key: string, expectedRevision: number, operationId = randomUUID()) =>
    escalateCoManagedTicket(db, c.admin, resource(c, key), { operationId, expectedRevision, note });
  const handBack = (actor: CoManagedSessionActor, c: Customer, key: string, expectedRevision: number, operationId = randomUUID()) =>
    handBackCoManagedTicket(db, actor, resource(c, key), { operationId, expectedRevision, note });
  const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: any) => (error instanceof CoManagedTicketHandoffError ? error.code : `${error?.name}:${error?.message}`));

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'l3b1_queue_test' });
    msp = await createTenant(db, 'Sponsor MSP', { productCode: 'psa' });
    mspBoard = randomUUID();
    await db('boards').insert({ tenant: msp, board_id: mspBoard, board_name: 'Escalations', is_inactive: false });
    tech = await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']]);
    await seedCustomer(A, 'A', [['a1', '1001', 'scoped', false], ['a2', '1002', 'unscoped', false], ['a3', '1003', 'unscoped', false], ['a4', '1004', 'scoped', true]], true);
    await seedCustomer(B, 'B', [['b1', '1001', 'scoped', false], ['b2', '1002', 'unscoped', false]], true);
    await seedCustomer(C, 'C', [['c1', '1001', 'scoped', false]], false);
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('shows nothing in Working and only board-scoped customer tickets in Oversight before any escalation', async () => {
    const working = await rq('working', { state: 'all' });
    expect(working.items).toEqual([]);
    expect(working.assignedRelationshipCount).toBe(2);
    const oversight = await rq('oversight', { state: 'all' });
    expect(tag(oversight)).toEqual(['A:1001', 'A:1004', 'B:1001']);
    // c1 (no staff assignment) and the unscoped, unescalated tickets are not part of the relation at all.
    expect(oversight.items.every(item => item.fields.responsibility === 'customer')).toBe(true);
    expect(oversight.openCount).toBe(2);
    expect(oversight.closedCount).toBe(1);
  });

  it('Working shows only MSP-responsible tickets; Oversight adds the customer-handled board-scoped ones; duplicates stay distinct', async () => {
    const a2 = await escalate(A, 'a2', 0);
    const b2 = await escalate(B, 'b2', 0);
    expect(a2).toMatchObject({ appliedRevision: 1, transition: 'escalated' });
    expect(b2).toMatchObject({ appliedRevision: 1, transition: 'escalated' });

    const working = await rq('working');
    expect(tag(working)).toEqual(['A:1002', 'B:1002']);
    expect(working.items.every(item => item.fields.responsibility === 'msp')).toBe(true);
    // Same ticket number in two workspaces: two rows keyed by workspace tenant + relationship id.
    const keys = working.items.map(item => `${item.tenant}/${item.relationshipId}`);
    expect(new Set(keys).size).toBe(2);
    expect(new Set(working.items.map(item => item.ticketId)).size).toBe(2);
    expect(working.items.map(item => item.relationshipId).sort()).toEqual([A.relationshipId, B.relationshipId].sort());
    expect(working.workspaces.map(w => w.tenant).sort()).toEqual([A.tenant, B.tenant].sort());

    const oversight = await rq('oversight');
    expect(tag(oversight)).toEqual(['A:1001', 'A:1002', 'B:1001', 'B:1002']);
    const handled = oversight.items.filter(item => item.fields.responsibility === 'customer').map(item => item.ticketId).sort();
    expect(handled).toEqual([A.tickets.a1, B.tickets.b1].sort());
    // Workspace narrowing keeps each duplicate number inside its own workspace.
    expect(tag(await rq('oversight', { workspaceTenant: A.tenant }))).toEqual(['A:1001', 'A:1002']);
    expect(tag(await rq('oversight', { workspaceTenant: B.tenant.toUpperCase() }))).toEqual(['B:1001', 'B:1002']);
    // Searching by the duplicated number finds both, never merging them.
    expect(tag(await rq('oversight', { search: '1002' }))).toEqual(['A:1002', 'B:1002']);
    // Sponsor-client narrowing is by relationship.
    expect(tag(await rq('oversight', { clientId: B.sponsorClientId }))).toEqual(['B:1001', 'B:1002']);
  });

  it('paginates with a stable total across pages and equals the export', async () => {
    const all = await exportCoManagedTicketQueue(db, tech, { view: 'oversight', state: 'all', sort: 'number', direction: 'asc' });
    expect(all).toHaveLength(5);
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await rq('oversight', { state: 'all', sort: 'number', direction: 'asc', page, pageSize: 2 }));
    expect(pages.map(p => p.items.length)).toEqual([2, 2, 1]);
    expect(pages.every(p => p.totalCount === 5 && p.pageSize === 2)).toBe(true);
    expect(pages.map(p => p.page)).toEqual([1, 2, 3]);
    const paged = pages.flatMap(p => p.items.map(item => `${item.tenant}/${item.ticketId}`));
    expect(new Set(paged).size).toBe(5);
    expect(paged).toEqual(all.map(item => `${item.tenant}/${item.ticketId}`));
    // Beyond the last page: no rows, same total.
    const beyond = await rq('oversight', { state: 'all', page: 9, pageSize: 2 });
    expect(beyond.items).toEqual([]);
    expect(beyond.totalCount).toBe(5);
    // Numbers sort ascending, ties broken deterministically by tenant.
    expect(all.map(item => item.fields.ticket_number)).toEqual(['1001', '1001', '1002', '1002', '1004']);
  });

  it('signal counts equal the rows of the matching reader filter for both signals', async () => {
    // a2 becomes assigned to the technician and awaits an internal reply; b2 stays escalated and unassigned.
    await db('co_managed_ticket_references').where({ tenant: msp, customer_tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ assigned_to: tech.userId });
    await db('tickets').where({ tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ response_state: 'awaiting_internal' });

    for (const view of ['working', 'oversight'] as const) {
      const page = await rq(view);
      const escalated = await rq(view, { signal: 'escalated_unassigned', state: 'open' });
      const awaiting = await rq(view, { signal: 'awaiting_reply', state: 'open' });
      expect(page.signals).toEqual({ escalatedUnassigned: 1, awaitingReply: 1 });
      expect(escalated.items.length).toBe(page.signals.escalatedUnassigned);
      expect(escalated.totalCount).toBe(page.signals.escalatedUnassigned);
      expect(awaiting.items.length).toBe(page.signals.awaitingReply);
      expect(tag(escalated)).toEqual(['B:1002']);
      expect(tag(awaiting)).toEqual(['A:1002']);
    }
    // Counts ignore workspace/search narrowing and agree with the client-narrowed reader.
    const narrowed = await rq('working', { clientId: A.sponsorClientId });
    expect(narrowed.signals).toEqual({ escalatedUnassigned: 0, awaitingReply: 1 });
    expect((await rq('working', { clientId: A.sponsorClientId, signal: 'escalated_unassigned' })).items).toHaveLength(0);
    // Closing the ticket drops it from the open signal.
    const closed = await db('statuses').where({ tenant: A.tenant, is_closed: true }).first('status_id');
    await db('tickets').where({ tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ status_id: closed.status_id, is_closed: true });
    expect((await rq('working')).signals).toEqual({ escalatedUnassigned: 1, awaitingReply: 0 });
    const reopened = await db('statuses').where({ tenant: A.tenant, is_closed: false }).first('status_id');
    await db('tickets').where({ tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ status_id: reopened.status_id, is_closed: false });
    await db('co_managed_ticket_references').where({ tenant: msp, customer_tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ assigned_to: null });
    await db('tickets').where({ tenant: A.tenant, ticket_id: A.tickets.a2 }).update({ response_state: null });
  });

  it('an unknown, unassigned or unavailable workspaceTenant never widens to all', async () => {
    const baseline = await rq('oversight', { state: 'all' });
    expect(baseline.totalCount).toBeGreaterThan(0);

    const unknown = await rq('oversight', { state: 'all', workspaceTenant: randomUUID() });
    expect(unknown.items).toEqual([]);
    expect(unknown.totalCount).toBe(0);
    // A real workspace with a live relationship, but no staff assignment for this technician.
    const unassigned = await rq('oversight', { state: 'all', workspaceTenant: C.tenant });
    expect(unassigned.items).toEqual([]);
    expect(unassigned.totalCount).toBe(0);
    // The sponsor's own workspace is not a shared-work workspace either.
    expect((await rq('working', { state: 'all', workspaceTenant: msp })).items).toEqual([]);

    // A suspended customer workspace is unavailable: it vanishes, its rows are not served under any filter.
    await db('tenants').where({ tenant: B.tenant }).update({ suspended_at: new Date() });
    try {
      const suspended = await rq('oversight', { state: 'all', workspaceTenant: B.tenant });
      expect(suspended.items).toEqual([]);
      expect(suspended.totalCount).toBe(0);
      const widened = await rq('oversight', { state: 'all' });
      expect(tag(widened).every(row => row.startsWith('A:'))).toBe(true);
      expect(widened.workspaces.map(w => w.tenant)).toEqual([A.tenant]);
    } finally {
      await db('tenants').where({ tenant: B.tenant }).update({ suspended_at: null });
    }
    // Malformed ids are refused outright.
    await expect(rq('oversight', { workspaceTenant: 'not-a-uuid' })).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });

  it('replaying an operation on the real database returns the identical receipt and adds no rows', async () => {
    const operationId = randomUUID();
    const first = await escalate(A, 'a3', 0, operationId);
    const before = await rowCounts();
    const replay = await escalate(A, 'a3', 0, operationId);
    expect(replay).toEqual(first);
    expect(await rowCounts()).toEqual(before);
    // Replay after later transitions still yields the original receipt.
    const back = await handBack(tech, A, 'a3', 1);
    expect(back.appliedRevision).toBe(2);
    const afterBack = await rowCounts();
    expect(await escalate(A, 'a3', 0, operationId)).toEqual(first);
    expect(await rowCounts()).toEqual(afterBack);
    // The same operation id with a different payload is a conflict, never a silent replay.
    expect(await codeOf(escalateCoManagedTicket(db, A.admin, resource(A, 'a3'), { operationId, expectedRevision: 0, note: 'different note' }))).toBe('HANDOFF_CHANGED');
    expect(await rowCounts()).toEqual(afterBack);
    // Hand back replay too.
    const backOperation = randomUUID();
    await escalate(A, 'a3', 2);
    const second = await handBack(tech, A, 'a3', 3, backOperation);
    const beforeReplay = await rowCounts();
    expect(await handBack(tech, A, 'a3', 3, backOperation)).toEqual(second);
    expect(await rowCounts()).toEqual(beforeReplay);
    expect((await work(A, 'a3')).revision).toBe(4);
  });

  it('a ticket leaves Working after MSP hand back, after customer take back, and after revocation', async () => {
    expect(tag(await rq('working'))).toEqual(['A:1002', 'B:1002']);

    // MSP hand back (a2: unscoped board, so the explicit grant is its only visibility).
    await handBack(tech, A, 'a2', 1);
    expect(tag(await rq('working'))).toEqual(['B:1002']);
    expect((await work(A, 'a2')).responsibility).toBe('customer');
    // Hand back never removes visibility: still an Oversight row, now customer-handled.
    const oversight = await rq('oversight');
    expect(oversight.items.find(item => item.ticketId === A.tickets.a2)?.fields.responsibility).toBe('customer');

    // Re-escalate, then the customer takes it back.
    await escalate(A, 'a2', 2);
    expect(tag(await rq('working'))).toEqual(['A:1002', 'B:1002']);
    await handBack(A.admin, A, 'a2', 3);
    expect(tag(await rq('working'))).toEqual(['B:1002']);

    // Re-escalate, then the customer administrator revokes the explicit grant.
    await escalate(A, 'a2', 4);
    expect(tag(await rq('working'))).toEqual(['A:1002', 'B:1002']);
    const revoked = await revokeCoManagedTicketGrant(db, A.admin, resource(A, 'a2'), { operationId: randomUUID(), expectedRevision: 5, note });
    expect(revoked).toMatchObject({ transition: 'access_revoked', appliedRevision: 6 });
    expect(tag(await rq('working'))).toEqual(['B:1002']);
    expect((await work(A, 'a2')).grant_revoked_at).not.toBeNull();
    // An unscoped ticket with a revoked grant is gone from Oversight as well; a board-scoped one would stay.
    expect(tag(await rq('oversight', { workspaceTenant: A.tenant, state: 'all' }))).toEqual(['A:1001', 'A:1003', 'A:1004']);
    // The MSP technician can no longer act on it.
    expect(await codeOf(handBack(tech, A, 'a2', 6))).toMatch(/CoManagedSharedWorkError/);
    // A revocation of a board-scoped ticket leaves it in Oversight (the board grant is independent) but out of Working.
    await escalate(A, 'a1', 0);
    expect(tag(await rq('working', { workspaceTenant: A.tenant }))).toEqual(['A:1001']);
    await revokeCoManagedTicketGrant(db, A.admin, resource(A, 'a1'), { operationId: randomUUID(), expectedRevision: 1, note });
    expect(tag(await rq('working', { workspaceTenant: A.tenant }))).toEqual([]);
    expect(tag(await rq('oversight', { workspaceTenant: A.tenant }))).toContain('A:1001');
  });

  it('serialises concurrent transitions on one ticket: exactly one wins, the other gets HANDOFF_CHANGED', async () => {
    // (1) Two concurrent escalations from revision 0 (customer path, separate pooled connections).
    const escalations = await Promise.all([codeOf(escalate(B, 'b1', 0)), codeOf(escalate(B, 'b1', 0))]);
    expect(escalations.filter(code => code === 'ok')).toHaveLength(1);
    expect(escalations.filter(code => code === 'HANDOFF_CHANGED')).toHaveLength(1);
    expect(await work(B, 'b1')).toMatchObject({ revision: 1, responsibility: 'msp' });
    expect(Number((await db('co_management_ticket_handoffs').where({ tenant: B.tenant, ticket_id: B.tickets.b1 }).count('* as n').first())!.n)).toBe(1);
    expect(Number((await db('co_managed_ticket_references').where({ tenant: msp, customer_tenant: B.tenant, ticket_id: B.tickets.b1 }).count('* as n').first())!.n)).toBe(1);

    // (2) MSP hand back races a customer take back at the same revision (two different admission wrappers, one ticket lock).
    for (let round = 0; round < 3; round++) {
      const revision = (await work(B, 'b2')).revision;
      if ((await work(B, 'b2')).responsibility !== 'msp') await escalate(B, 'b2', revision);
      const current = (await work(B, 'b2')).revision;
      const results = await Promise.all([codeOf(handBack(tech, B, 'b2', current)), codeOf(handBack(B.admin, B, 'b2', current))]);
      expect(results.filter(code => code === 'ok'), JSON.stringify(results)).toHaveLength(1);
      expect(results.filter(code => code === 'HANDOFF_CHANGED'), JSON.stringify(results)).toHaveLength(1);
      expect(await work(B, 'b2')).toMatchObject({ revision: current + 1, responsibility: 'customer' });
      const events = await db('co_management_ticket_handoffs').where({ tenant: B.tenant, ticket_id: B.tickets.b2 }).orderBy('revision');
      expect(events.map(event => event.revision)).toEqual(events.map((_, index) => index + 1));
    }
  }, 120_000);
});
