/**
 * Co-managed seat slice S19 (F046 / T026) on real Postgres: the seat technician's ticket list views.
 *
 * Fixture: sponsor tenant, client A (seat arrangement, boards B1 and B2 in scope; B3 is not) and
 * client C. Every view's rows and count come from one predicate; a client or board filter cannot
 * widen the technician's scope; with the release closed, or for an MSP user, the list is what it was.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
// Registers the seat list views the way the server does (instrumentation imports ./capability).
import '@alga-psa/co-managed/capability';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const authMocks = vi.hoisted(() => ({ user: null as any, tenant: null as string | null }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('seat technician ticket list views (F046 / T026)', { shuffle: false }, () => {
  let db: Knex;
  let optimized: typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
  const f: Record<string, any> = {};
  const name = new Map<string, string>();
  const seen: string[] = [];

  const base: ITicketListFilters = { boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false };
  const as = (userId: string) => { authMocks.user = { user_id: userId, user_type: 'internal', tenant: f.tenant }; };
  const list = async (filters: Partial<ITicketListFilters> = {}) => {
    const result: any = await optimized.getTicketsForList({ ...base, ...filters } as ITicketListFilters, 1, 100);
    if (!result.tickets) throw new Error(JSON.stringify(result));
    return { names: result.tickets.map((t: any) => name.get(t.ticket_id) ?? `UNKNOWN`).sort() as string[],
      total: result.totalCount as number, views: result.views as Array<{ key: string; count: number }> | undefined,
      seatResponsibilityOffered: result.seatResponsibilityOffered as boolean | undefined, rawTickets: result.tickets as Array<{ seat_responsibility?: unknown }> };
  };

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    // Record every statement any pool in this process sends, to prove what does not run.
    const original = pg.Client.prototype.query as any;
    (pg.Client.prototype as any).query = function (...args: any[]) {
      seen.push(typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? ''));
      return original.apply(this, args);
    };
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');

    const tenant = await createTenant(db, `Seat views ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientA = await createClient(db, tenant, 'Client A');
    const clientC = await createClient(db, tenant, 'Client C');
    const actor = await createUser(db, tenant, { user_type: 'internal' });
    const mspAgent = await createUser(db, tenant, { user_type: 'internal' });
    const tech = await createUser(db, tenant, { user_type: 'internal' });
    const priority = randomUUID();
    await db('priorities').insert({ tenant, priority_id: priority, priority_name: 'High', created_by: actor, order_number: 1 });
    const boards: Record<string, { id: string; status: string }> = {};
    for (const key of ['B1', 'B2', 'B3']) {
      const id = randomUUID(); const status = randomUUID();
      await db('boards').insert({ tenant, board_id: id, board_name: key, is_default: false, is_inactive: false });
      await db('statuses').insert({ tenant, status_id: status, board_id: id, name: 'Open', status_type: 'ticket',
        is_closed: false, is_default: true, created_by: actor, order_number: 1 });
      boards[key] = { id, status };
    }
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: clientA, operationId: randomUUID(), seats: 1 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id,
      boards: [{ boardId: boards.B1.id, canCreate: true }, { boardId: boards.B2.id, canCreate: false }] });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: tech }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id,
        user_id: tech, state: 'active' });
    });

    let seq = 0;
    const ticket = async (key: string, client: string, board: string, responsibility: 'client_it' | 'msp' | null, assignee: string | null) => {
      const id = randomUUID(); name.set(id, key); seq += 1;
      await db('tickets').insert({ tenant, ticket_id: id, ticket_number: `SV-${seq}`, title: key, client_id: client,
        board_id: boards[board].id, status_id: boards[board].status, priority_id: priority, entered_by: actor,
        assigned_to: assignee, entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)) });
      if (responsibility && client === clientA) {
        await db('co_managed_seat_ticket_work').insert({ tenant, ticket_id: id, arrangement_id: arrangement.arrangement_id,
          responsibility, revision: 1, last_transition_at: new Date() });
      }
    };
    await ticket('A1', clientA, 'B1', 'client_it', tech);
    await ticket('A2', clientA, 'B1', null, null);               // no work row: the MSP's
    await ticket('A3', clientA, 'B2', 'client_it', null);
    await ticket('A4', clientA, 'B2', 'msp', mspAgent);
    await ticket('A5', clientA, 'B3', 'client_it', null);        // out-of-scope board
    await ticket('A6', clientA, 'B3', 'msp', mspAgent);          // out-of-scope board
    await ticket('C1', clientC, 'B1', null, null);               // another client
    await ticket('C2', clientC, 'B2', null, mspAgent);
    Object.assign(f, { tenant, clientA, clientC, tech, actor, mspAgent, boards, arrangementId: arrangement.arrangement_id });
  }, 300_000);

  beforeEach(() => { process.env.FORCE_CAPABILITIES = 'co-managed-seat:on'; authMocks.tenant = f.tenant; as(f.tech); });
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy().catch(() => undefined); });

  const EXPECTED: Record<string, string[]> = {
    client_it: ['A1', 'A3'], msp: ['A2', 'A4'], unassigned: ['A2', 'A3'], all: ['A1', 'A2', 'A3', 'A4'],
  };

  it('offers exactly four views, each returning its rows, and every count equals its rows', async () => {
    const overview = await list();
    expect(overview.views?.map((v) => v.key)).toEqual(['client_it', 'msp', 'unassigned', 'all']);
    for (const [key, expected] of Object.entries(EXPECTED)) {
      const rows = await list({ listView: key });
      expect(rows.names, key).toEqual(expected);
      expect(rows.total, key).toBe(expected.length);
      expect(overview.views!.find((v) => v.key === key)!.count, key).toBe(rows.names.length);
      expect(rows.views!.find((v) => v.key === key)!.count, key).toBe(rows.names.length);
    }
  });

  it('keeps counts equal to rows under other filters and in the individual view', async () => {
    for (const extra of [{ bundleView: 'individual' as const }, { boardIds: [f.boards.B2.id] }, { includeUnassigned: true }]) {
      const overview = await list(extra);
      for (const view of overview.views!) {
        const rows = await list({ ...extra, listView: view.key });
        expect(view.count, `${view.key} ${JSON.stringify(extra)}`).toBe(rows.names.length);
      }
    }
  });

  it('never shows another client or an out-of-scope board, however the filters ask', async () => {
    const widen: Array<Partial<ITicketListFilters>> = [
      { clientId: f.clientC }, { boardIds: [f.boards.B3.id] }, { boardId: f.boards.B3.id },
      { clientId: f.clientC, boardIds: [f.boards.B1.id, f.boards.B2.id, f.boards.B3.id] },
      { excludeBoardIds: [f.boards.B1.id, f.boards.B2.id] },
      { where: { join: 'and', clauses: [{ path: 'client.id', operator: 'in', value: [f.clientC] }] } },
    ];
    for (const key of [undefined, ...Object.keys(EXPECTED)]) {
      for (const filters of widen) {
        const rows = await list({ ...filters, listView: key });
        expect(rows.names.filter((n) => /^(A5|A6|C)/.test(n)), `${key} ${JSON.stringify(filters)}`).toEqual([]);
        for (const view of rows.views ?? []) {
          expect(view.count, `${view.key} ${JSON.stringify(filters)}`).toBe((await list({ ...filters, listView: view.key })).total);
        }
      }
    }
    expect((await list({ clientId: f.clientC, listView: 'all' })).total).toBe(0);
    expect((await list({ boardIds: [f.boards.B3.id], listView: 'all' })).views!.map((v) => v.count)).toEqual([0, 0, 0, 0]);
  });

  it('treats a key it does not offer as no view', async () => {
    expect((await list({ listView: 'bogus' })).names).toEqual(EXPECTED.all);
  });

  it('with the release closed the list is what it was: no views, the kernel scope alone', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    const rows = await list({ listView: 'client_it' });
    expect(rows.views).toBeUndefined();
    expect(rows.names).toEqual(EXPECTED.all);
  });

  it('a revoked technician gets no views and no tickets', async () => {
    await db('co_managed_seat_assignments').where({ tenant: f.tenant, user_id: f.tech }).update({ state: 'revoked', revoked_at: new Date() });
    try {
      const rows = await list();
      expect(rows.views).toBeUndefined();
      expect(rows.names).toEqual([]);
    } finally {
      await db('co_managed_seat_assignments').where({ tenant: f.tenant, user_id: f.tech }).update({ state: 'active', revoked_at: null });
    }
  });

  it('an MSP user sees what they always did and no seat query runs for the list', async () => {
    as(f.mspAgent);
    seen.length = 0;
    const rows = await list({ listView: 'client_it' });
    expect(rows.views).toBeUndefined();
    expect(rows.names).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'C1', 'C2']);
    // The subject's own facts read (the authorization kernel's, shared with every surface) is not the list's.
    // With the seat shape released, MSP staff are offered the responsibility column (S24): one page-scoped read.
    const seatReads = seen.filter((sql) => /co_managed_seat_/.test(sql) && !sql.includes('jsonb_build_object'));
    expect(seatReads).toHaveLength(1);
    expect(rows.seatResponsibilityOffered).toBe(true);
  });

  it('with the seat shape off an MSP user\'s list runs no seat query and offers no responsibility column', async () => {
    as(f.mspAgent);
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    seen.length = 0;
    const rows = await list({});
    expect(rows.seatResponsibilityOffered).toBeUndefined();
    expect(rows.rawTickets.every((ticket: { seat_responsibility?: unknown }) => ticket.seat_responsibility === undefined)).toBe(true);
    const seatReads = seen.filter((sql) => /co_managed_seat_/.test(sql) && !sql.includes('jsonb_build_object'));
    expect(seatReads).toEqual([]);
  });
});
