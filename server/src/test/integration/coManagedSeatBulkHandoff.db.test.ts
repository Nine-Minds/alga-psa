/**
 * Co-managed seat slice S26 (F064 / F065 / T034, with F062) on real Postgres: bulk handoff and seat technician tagging.
 *
 * A bulk handoff is a set of single handoffs: each selected ticket is checked on its own, only the tickets that qualify
 * are handed over, every other ticket is reported with its own reason and left exactly as it was. A seat technician
 * applies existing tags and cannot create one, on every path that can create a tag definition.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
// Registers the seat providers the way the server does (instrumentation imports ./capability).
import '@alga-psa/co-managed/capability';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const authMocks = vi.hoisted(() => ({ user: null as any, tenant: null as string | null, denied: new Set<string>() }));

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
  withOptionalAuth: (action: any) => (...args: any[]) => action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: async (_user: unknown, resource: string, action: string) => !authMocks.denied.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string, action: string) => !authMocks.denied.has(`${resource}:${action}`),
}));
// Role permissions grant everything here, as the seat role does for tags (`tag:create`, `tag:update`): what refuses a
// seat technician is the seat authority, not the role.
vi.mock('../../../../packages/tags/src/lib/authHelpers', () => ({
  hasPermissionAsync: async () => true,
  throwPermissionErrorAsync: async (action: string) => { throw new Error(`Permission denied: ${action}`); },
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const DAY = 86_400_000;
const NOTE = 'Handing these over together.';
const describeDb = await describeWithDb();

describeDb('co-managed seat bulk handoff and seat technician tagging (F064 / F065 / T034)', { shuffle: false }, () => {
  let db: Knex;
  let handoff: typeof import('@alga-psa/tickets/actions/ticketResponsibilityActions');
  let optimized: typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
  let tags: typeof import('@alga-psa/tags/actions/tagActions');
  const f: Record<string, any> = {};
  const name = new Map<string, string>();
  const keyOf = (ticketId: string) => name.get(ticketId) ?? ticketId;

  const as = (userId: string) => { authMocks.user = { user_id: userId, user_type: 'internal', tenant: f.tenant }; };

  /** One ticket's state: everything a refused handoff must leave untouched. */
  const snapshot = async (ticketId: string) => {
    const ticket = await db('tickets').where({ tenant: f.tenant, ticket_id: ticketId }).first('assigned_to', 'board_id');
    const work = await db('co_managed_seat_ticket_work').where({ tenant: f.tenant, ticket_id: ticketId }).first('responsibility', 'revision');
    const receipts = await db('co_managed_seat_ticket_handoffs').where({ tenant: f.tenant, ticket_id: ticketId }).count<{ count: string }[]>('* as count');
    return { assignedTo: ticket.assigned_to, boardId: ticket.board_id, work: work ? { responsibility: work.responsibility, revision: Number(work.revision) } : null, receipts: Number(receipts[0].count) };
  };

  const ticket = async (key: string, options: { client?: string; board?: string; responsibility?: 'client_it' | 'msp'; revision?: number; assignedTo?: string | null }) => {
    const client = options.client ?? f.clientA;
    const board = options.board ?? 'B1';
    const id = randomUUID(); name.set(id, key); f.seq += 1;
    await db('tickets').insert({ tenant: f.tenant, ticket_id: id, ticket_number: `BH-${f.seq}`, title: key, client_id: client,
      board_id: f.boards[board].id, status_id: f.boards[board].status, priority_id: f.priority, entered_by: f.staff,
      assigned_to: options.assignedTo ?? null, entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, f.seq)) });
    if (options.responsibility && client === f.clientA) {
      await db('co_managed_seat_ticket_work').insert({ tenant: f.tenant, ticket_id: id, arrangement_id: f.arrangementId,
        responsibility: options.responsibility, revision: options.revision ?? 1, last_transition_at: new Date() });
    }
    return id;
  };

  const submit = (action: 'client_it' | 'msp', picks: Array<{ id: string; revision?: number }>, extra: Record<string, unknown> = {}) =>
    ((action === 'client_it' ? handoff.bulkHandTicketsToClientIt : handoff.bulkHandTicketsToMsp) as any)({
      tickets: picks.map((pick) => ({ ticketId: pick.id, expectedRevision: pick.revision ?? 0 })),
      note: NOTE, submissionId: extra.submissionId ?? f.submissionId, ...extra,
    }) as Promise<{ results: Array<any> } | { actionError?: string; permissionError?: string; messageKey?: string }>;
  const resultsOf = (result: any): Record<string, any> => {
    if (!result.results) throw new Error(`Expected results, got ${JSON.stringify(result)}`);
    return Object.fromEntries(result.results.map((r: any) => [keyOf(r.ticketId), r]));
  };
  const KEY = (suffix: string) => `features/tickets:errors.seatHandoff.${suffix}`;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ runSeeds: false });
    handoff = await import('@alga-psa/tickets/actions/ticketResponsibilityActions');
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    tags = await import('@alga-psa/tags/actions/tagActions');

    const tenant = await createTenant(db, `Seat bulk ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientA = await createClient(db, tenant, 'Client A');
    const clientC = await createClient(db, tenant, 'Client C (no arrangement)');
    const staff = await createUser(db, tenant, { user_type: 'internal' });
    const tech = await createUser(db, tenant, { user_type: 'internal' });
    const otherTech = await createUser(db, tenant, { user_type: 'internal' });
    const priority = randomUUID();
    await db('priorities').insert({ tenant, priority_id: priority, priority_name: 'High', created_by: staff, order_number: 1 });
    const boards: Record<string, { id: string; status: string }> = {};
    for (const key of ['B1', 'B2']) {
      const id = randomUUID(); const status = randomUUID();
      await db('boards').insert({ tenant, board_id: id, board_name: key, is_default: false, is_inactive: false });
      await db('statuses').insert({ tenant, status_id: status, board_id: id, name: 'Open', status_type: 'ticket',
        is_closed: false, is_default: true, created_by: staff, order_number: 1 });
      boards[key] = { id, status };
    }
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: clientA, operationId: randomUUID(), seats: 2 });
    // B1 is shared with the arrangement; B2 is not.
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId: boards.B1.id, canCreate: true }] });
    for (const userId of [tech, otherTech]) {
      await db.transaction(async (trx) => {
        await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
        await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: userId, state: 'active' });
      });
    }
    Object.assign(f, { tenant, clientA, clientC, staff, tech, otherTech, priority, boards, arrangementId: arrangement.arrangement_id, seq: 0 });
  }, 300_000);

  beforeEach(() => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    authMocks.tenant = f.tenant;
    f.submissionId = randomUUID();
    authMocks.denied.clear();
    as(f.staff);
  });
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy().catch(() => undefined); });

  // T034 / F064: MSP staff to client IT
  it('bulk hand to client IT acts on the tickets that qualify and reports each failure with its own reason, leaving those tickets as they were', async () => {
    const qualifies = await ticket('qualifies', { assignedTo: f.staff });
    const alsoQualifies = await ticket('also-qualifies', {});
    const outOfScope = await ticket('out-of-scope-board', { board: 'B2', assignedTo: f.staff });
    const stale = await ticket('stale-revision', { responsibility: 'msp', revision: 3 });
    const noArrangement = await ticket('no-arrangement', { client: f.clientC, assignedTo: f.staff });
    const already = await ticket('already-handed-off', { responsibility: 'client_it', revision: 1 });
    const failing = [outOfScope, stale, noArrangement, already];
    const before = Object.fromEntries(await Promise.all([qualifies, alsoQualifies, ...failing].map(async (id) => [id, await snapshot(id)])));

    const result = await submit('client_it', [
      { id: qualifies }, { id: alsoQualifies }, { id: outOfScope }, { id: stale, revision: 0 }, { id: noArrangement },
      { id: already, revision: 1 }, { id: randomUUID() }, { id: 'not-a-ticket' }, { id: qualifies },
    ], { technicianUserId: f.tech });
    const byKey = resultsOf(result);

    // Qualifying tickets were handed over, with the named technician.
    for (const [key, id] of [['qualifies', qualifies], ['also-qualifies', alsoQualifies]] as const) {
      expect(byKey[key], key).toMatchObject({ ok: true, state: { responsibility: 'client_it', revision: 1 } });
      expect(await snapshot(id), key).toMatchObject({ work: { responsibility: 'client_it', revision: 1 }, assignedTo: f.tech, receipts: 1 });
    }
    // Every other ticket carries its own reason.
    expect(byKey['out-of-scope-board']).toMatchObject({ ok: false, messageKey: KEY('boardOutOfScope') });
    expect(byKey['stale-revision']).toMatchObject({ ok: false, messageKey: KEY('changed') });
    expect(byKey['no-arrangement']).toMatchObject({ ok: false, messageKey: KEY('noArrangement') });
    expect(byKey['already-handed-off']).toMatchObject({ ok: false, messageKey: KEY('alreadyResponsible') });
    expect(Object.values(byKey).filter((r: any) => r.messageKey === KEY('ticketNotFound'))).toHaveLength(2);
    for (const r of Object.values(byKey) as any[]) if (!r.ok) expect(r.message, r.ticketId).toEqual(expect.any(String));
    // A ticket named twice is handed over once.
    expect((result as any).results).toHaveLength(8);
    // Failed tickets are exactly as they were: responsibility, assignee, revision, and no receipt written.
    for (const id of failing) expect(await snapshot(id), keyOf(id)).toEqual(before[id]);
    expect(await snapshot(noArrangement)).toMatchObject({ work: null, receipts: 0 });

    // Retrying the whole submission replays each receipt instead of handing a ticket over twice.
    const retry = resultsOf(await submit('client_it', [
      { id: qualifies }, { id: alsoQualifies }, { id: outOfScope }, { id: stale }, { id: noArrangement }, { id: already, revision: 1 },
    ], { technicianUserId: f.tech }));
    expect(retry['qualifies']).toMatchObject({ ok: true, state: { responsibility: 'client_it', revision: 1 } });
    expect(retry['also-qualifies']).toMatchObject({ ok: true });
    expect(retry['out-of-scope-board'].ok).toBe(false);
    expect(await snapshot(qualifies)).toMatchObject({ work: { responsibility: 'client_it', revision: 1 }, receipts: 1 });
    expect(await snapshot(alsoQualifies)).toMatchObject({ receipts: 1 });
    for (const id of failing) expect(await snapshot(id), keyOf(id)).toEqual(before[id]);
    f.handedOffByStaff = [qualifies, alsoQualifies];
    f.alreadyHanded = already;
  });

  // T034 / F062: the filter after the bulk run
  it('the responsibility filter and the row revisions reflect the bulk run', async () => {
    const list = async (where?: unknown) => {
      const result: any = await optimized.getTicketsForList({ boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false,
        ...(where ? { where } : {}) } as ITicketListFilters, 1, 100);
      if (!result.tickets) throw new Error(JSON.stringify(result));
      return result;
    };
    const filter = (value: 'client_it' | 'msp') => ({ join: 'and', clauses: [{ path: 'seat_responsibility', operator: 'equals', value }] });

    const clientIt = await list(filter('client_it'));
    expect(clientIt.tickets.map((t: any) => keyOf(t.ticket_id)).sort()).toEqual(['already-handed-off', 'also-qualifies', 'qualifies']);
    expect(clientIt.seatResponsibilityOffered).toBe(true);
    expect(clientIt.seatHandoffDirection).toBe('client_it');
    const msp = await list(filter('msp'));
    expect(msp.tickets.map((t: any) => keyOf(t.ticket_id)).sort()).toEqual(['out-of-scope-board', 'stale-revision']);
    // Each row carries the revision its handoff must name.
    const all = await list();
    const row = (key: string) => all.tickets.find((t: any) => keyOf(t.ticket_id) === key);
    expect(row('qualifies')).toMatchObject({ seat_responsibility: 'client_it', seat_responsibility_revision: 1 });
    expect(row('stale-revision')).toMatchObject({ seat_responsibility: 'msp', seat_responsibility_revision: 3 });
    expect(row('out-of-scope-board')).toMatchObject({ seat_responsibility: 'msp', seat_responsibility_revision: 0 });
    expect(row('no-arrangement').seat_responsibility_revision).toBeUndefined();
  });

  // T034 / F064: a seat technician to the MSP
  it('bulk hand to MSP as a seat technician acts on the tickets that qualify, and reports the rest without revealing what they are', async () => {
    const qualifies = await ticket('tech-qualifies', { responsibility: 'client_it', revision: 1, assignedTo: f.tech });
    const alsoQualifies = await ticket('tech-also-qualifies', { responsibility: 'client_it', revision: 4, assignedTo: f.otherTech });
    const stale = await ticket('tech-stale', { responsibility: 'client_it', revision: 2 });
    const already = await ticket('tech-already-with-msp', {});
    const outOfScope = await ticket('tech-out-of-scope-board', { board: 'B2', responsibility: 'client_it', revision: 1 });
    const noArrangement = await ticket('tech-no-arrangement', { client: f.clientC });
    const failing = [stale, already, outOfScope, noArrangement];
    const before = Object.fromEntries(await Promise.all(failing.map(async (id) => [id, await snapshot(id)])));
    as(f.tech);

    const result = await submit('msp', [
      { id: qualifies, revision: 1 }, { id: alsoQualifies, revision: 4 }, { id: stale, revision: 1 }, { id: already, revision: 0 },
      { id: outOfScope, revision: 1 }, { id: noArrangement },
    ], { technicianUserId: f.otherTech });
    const byKey = resultsOf(result);

    for (const [key, id, revision] of [['tech-qualifies', qualifies, 2], ['tech-also-qualifies', alsoQualifies, 5]] as const) {
      expect(byKey[key], key).toMatchObject({ ok: true, state: { responsibility: 'msp', revision } });
      // A technician assignee does not follow the ticket to the MSP; naming a technician is not part of this direction.
      expect(await snapshot(id), key).toMatchObject({ work: { responsibility: 'msp', revision }, assignedTo: null, receipts: 1 });
    }
    expect(byKey['tech-stale']).toMatchObject({ ok: false, messageKey: KEY('changed') });
    expect(byKey['tech-already-with-msp']).toMatchObject({ ok: false, messageKey: KEY('alreadyResponsibleMsp') });
    // A board outside the technician's scope, and a client that is not theirs, are tickets they cannot read:
    // "not available", the same as one that does not exist.
    for (const key of ['tech-out-of-scope-board', 'tech-no-arrangement']) {
      expect(byKey[key], key).toMatchObject({ ok: false, messageKey: KEY('ticketNotFound') });
      expect(byKey[key].message).not.toMatch(/permission|denied/i);
    }
    for (const id of failing) expect(await snapshot(id), keyOf(id)).toEqual(before[id]);
    expect(await snapshot(noArrangement)).toMatchObject({ work: null, receipts: 0 });
    f.handedToMsp = [qualifies, alsoQualifies];
  });

  // T034 / F062 for the technician: the list offers Hand to MSP
  it('a seat technician\'s list offers hand to MSP and an MSP user\'s offers hand to client IT', async () => {
    const direction = async (userId: string) => {
      as(userId);
      const result: any = await optimized.getTicketsForList({ boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false } as ITicketListFilters, 1, 100);
      return { direction: result.seatHandoffDirection, offered: result.seatResponsibilityOffered, tickets: result.tickets };
    };
    expect((await direction(f.tech)).direction).toBe('msp');
    expect((await direction(f.tech)).offered).toBeUndefined();
    expect((await direction(f.staff)).direction).toBe('client_it');
    const tech = await direction(f.tech);
    const handedBack = tech.tickets.find((t: any) => keyOf(t.ticket_id) === 'tech-qualifies');
    expect(handedBack).toMatchObject({ seat_responsibility: 'msp', seat_responsibility_revision: 2 });

    // The offer is made on the bulk actions' own terms: a reader who may not update tickets is offered neither direction.
    authMocks.denied.add('ticket:update');
    expect((await direction(f.tech)).direction).toBeUndefined();
    expect((await direction(f.staff)).direction).toBeUndefined();
    expect((await direction(f.staff)).offered).toBe(true);
  });

  // T034 / F064: each direction belongs to one kind of caller
  it('refuses a caller who is not offered the direction, and acts on nothing', async () => {
    const mine = await ticket('direction-guard', {});
    const before = await snapshot(mine);
    // MSP staff are not offered Hand to MSP; a seat technician is not offered Hand to client IT.
    as(f.staff);
    expect(await submit('msp', [{ id: mine }])).toMatchObject({ messageKey: KEY('unavailableMsp') });
    as(f.tech);
    expect(await submit('client_it', [{ id: mine }])).toMatchObject({ messageKey: KEY('unavailable') });
    expect(await snapshot(mine)).toEqual(before);
  });

  // The release posture
  it('with the seat shape not released, both bulk actions are not available and nothing changes', async () => {
    const mine = await ticket('flag-off', {});
    const before = await snapshot(mine);
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    as(f.staff);
    expect(await submit('client_it', [{ id: mine }])).toMatchObject({ messageKey: KEY('unavailable') });
    as(f.tech);
    expect(await submit('msp', [{ id: mine }])).toMatchObject({ messageKey: KEY('unavailableMsp') });
    expect(await snapshot(mine)).toEqual(before);
    as(f.staff);
    const result: any = await optimized.getTicketsForList({ boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false } as ITicketListFilters, 1, 100);
    expect(result.seatHandoffDirection).toBeUndefined();
    expect(result.seatResponsibilityOffered).toBeUndefined();
    expect(result.tickets.some((t: any) => t.seat_responsibility_revision !== undefined)).toBe(false);
  });

  // T034 / F065
  it('a seat technician is refused on every path that creates a tag, and applies an existing tag', async () => {
    const target = await ticket('tag-target', {});
    const other = await ticket('tag-target-2', {});
    const definitions = async (text: string) => Number((await db('tag_definitions').where({ tenant: f.tenant, tag_text: text, tagged_type: 'ticket' }).count<{ count: string }[]>('* as count'))[0].count);
    const mappings = async (ticketId: string) => Number((await db('tag_mappings').where({ tenant: f.tenant, tagged_id: ticketId }).count<{ count: string }[]>('* as count'))[0].count);
    const trxCall = (fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn);

    // MSP staff can still create tags, and that creates the definition the technician then applies.
    as(f.staff);
    expect(await (tags.checkTagPermissions as any)('ticket')).toMatchObject({ canAddExisting: true, canCreateNew: true });
    const created: any = await (tags.createTag as any)({ tag_text: 'shared-existing', tagged_id: target, tagged_type: 'ticket' });
    expect(created.tag_text).toBe('shared-existing');
    expect(await definitions('shared-existing')).toBe(1);
    await trxCall((trx) => (tags.createTagsForEntityWithTransaction as any)(trx, f.tenant, target, 'ticket', [{ tag_text: 'staff-created-2' }]));
    expect(await definitions('staff-created-2')).toBe(1);
    const bulkStaff: any = await trxCall((trx) => (tags.bulkApplyTagsToEntities as any)(trx, f.tenant, 'ticket', [{ entityId: target, newTexts: ['staff-created-3'], existingTexts: [] }]));
    expect(bulkStaff.appliedByEntity[target]).toEqual(['staff-created-3']);

    as(f.tech);
    // The picker: apply is offered, create is not.
    expect(await (tags.checkTagPermissions as any)('ticket')).toMatchObject({ canAddExisting: true, canCreateNew: false });

    // createTag, with a new text.
    const refused: any = await (tags.createTag as any)({ tag_text: 'tech-new-1', tagged_id: other, tagged_type: 'ticket' });
    expect(refused).toMatchObject({ actionError: expect.any(String), messageKey: 'common:errors.tags.creationRestricted' });
    // createTagsForEntity (the quick-add path) is createTag's wrapper: nothing is created.
    expect(await tags.createTagsForEntity(other, 'ticket', [{ tag_text: 'tech-new-2' } as any])).toEqual([]);
    // createTagsForEntityWithTransaction (imports, transactional callers) refuses.
    await expect(trxCall((trx) => (tags.createTagsForEntityWithTransaction as any)(trx, f.tenant, other, 'ticket', [{ tag_text: 'tech-new-3' }])))
      .rejects.toThrow(/Permission denied/);
    // bulkApplyTagsToEntities drops a text that would mint a definition.
    const bulk: any = await trxCall((trx) => (tags.bulkApplyTagsToEntities as any)(trx, f.tenant, 'ticket', [{ entityId: other, newTexts: ['tech-new-4'], existingTexts: [] }]));
    expect(bulk.appliedByEntity).toEqual({});
    for (const text of ['tech-new-1', 'tech-new-2', 'tech-new-3', 'tech-new-4']) expect(await definitions(text), text).toBe(0);
    expect(await mappings(other)).toBe(0);

    // Applying existing tags still works, on every path that can apply one.
    const applied: any = await (tags.createTag as any)({ tag_text: 'shared-existing', tagged_id: other, tagged_type: 'ticket' });
    expect(applied.tag_text).toBe('shared-existing');
    const viaTransaction = (await trxCall((trx) => (tags.createTagsForEntityWithTransaction as any)(trx, f.tenant, other, 'ticket', [{ tag_text: 'staff-created-2' }]))) as any[];
    expect(viaTransaction.map((t) => t.tag_text)).toEqual(['staff-created-2']);
    const viaBulk: any = await trxCall((trx) => (tags.bulkApplyTagsToEntities as any)(trx, f.tenant, 'ticket', [{ entityId: other, newTexts: ['staff-created-3'], existingTexts: [] }]));
    expect(viaBulk.appliedByEntity[other]).toEqual(['staff-created-3']);
    expect(await mappings(other)).toBe(3);
    // ...and it created no definition.
    expect(await definitions('shared-existing')).toBe(1);
  });
});
