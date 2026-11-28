/**
 * Record-level update authorization of a co-managed seat handoff (PSA alga-2026-0003470) on real Postgres.
 *
 * The handoff actions check coarse `ticket:update` RBAC and record-level READ; the write itself is authorized in the
 * handoff transaction, under the ticket lock and before any write, by `authorizeTicketRecordAccess(update)`. A user
 * whose authorization bundle narrows `ticket:update` to exclude a ticket they can read cannot hand it off, in either
 * direction, single or bulk, and the refused ticket is left exactly as it was.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
// Registers the seat providers the way the server does (instrumentation imports ./capability).
import '@alga-psa/co-managed/capability';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { handCoManagedSeatTicketToClientIt } from '@alga-psa/co-managed';
import { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } from '@alga-psa/authorization/bundles/service';
import { tenantDb } from '@alga-psa/db';
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



describeDb('co-managed seat handoff record-level update authorization', { shuffle: false }, () => {
  let db: Knex;
  let handoff: typeof import('@alga-psa/tickets/actions/ticketResponsibilityActions');
  const f: Record<string, any> = {};
  const bundles: string[] = [];
  const as = (userId: string) => { authMocks.user = { user_id: userId, user_type: 'internal', tenant: f.tenant }; };
  const KEY = (suffix: string) => `features/tickets:errors.seatHandoff.${suffix}`;

  /** Everything a refused handoff must leave untouched: assignee, responsibility/revision, receipts and the SLA clock. */
  const snapshot = async (ticketId: string) => {
    const ticket = await db('tickets').where({ tenant: f.tenant, ticket_id: ticketId }).first('assigned_to', 'sla_paused_at', 'updated_at');
    const work = await db('co_managed_seat_ticket_work').where({ tenant: f.tenant, ticket_id: ticketId }).first('responsibility', 'revision');
    const receipts = await db('co_managed_seat_ticket_handoffs').where({ tenant: f.tenant, ticket_id: ticketId }).count<{ count: string }[]>('* as count');
    const audit = await db('sla_audit_log').where({ tenant: f.tenant, ticket_id: ticketId }).count<{ count: string }[]>('* as count');
    return { assignedTo: ticket.assigned_to, slaPausedAt: ticket.sla_paused_at, updatedAt: ticket.updated_at,
      work: work ? { responsibility: work.responsibility, revision: Number(work.revision) } : null,
      receipts: Number(receipts[0].count), slaAudit: Number(audit[0].count) };
  };

  const ticket = async (options: { responsibility?: 'client_it' | 'msp'; revision?: number; assignedTo?: string | null } = {}) => {
    const id = randomUUID(); f.seq += 1;
    await db('tickets').insert({ tenant: f.tenant, ticket_id: id, ticket_number: `RU-${f.seq}`, title: `Update auth ${f.seq}`, client_id: f.clientA,
      board_id: f.board.id, status_id: f.board.status, priority_id: f.priority, entered_by: f.staff,
      assigned_to: options.assignedTo ?? null, entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, f.seq)) });
    if (options.responsibility) {
      await db('co_managed_seat_ticket_work').insert({ tenant: f.tenant, ticket_id: id, arrangement_id: f.arrangementId,
        responsibility: options.responsibility, revision: options.revision ?? 1, last_transition_at: new Date() });
    }
    return id;
  };

  /** A published bundle that narrows `ticket:update` (only update: read stays open) to a board this ticket is not on. */
  const narrowUpdateFor = async (userId: string) => {
    const created = await createAuthorizationBundle(db, { tenant: f.tenant, name: `Handoff update narrowing ${randomUUID()}`, actorUserId: f.staff });
    bundles.push(created.bundleId);
    await upsertBundleRule(db, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, resourceType: 'ticket', action: 'update',
      templateKey: 'selected_boards', config: { selectedBoardIds: [randomUUID()] }, actorUserId: f.staff });
    await publishBundleRevision(db as any, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId: f.staff });
    await createBundleAssignment(db, { tenant: f.tenant, bundleId: created.bundleId, targetType: 'user', targetId: userId, actorUserId: f.staff });
    return created.bundleId;
  };
  const dropBundle = async (bundleId: string) => {
    const t = (table: string) => tenantDb(db, f.tenant).table(table);
    await t('authorization_bundle_assignments').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundle_rules').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundles').where({ bundle_id: bundleId }).update({ published_revision_id: null });
    await t('authorization_bundle_revisions').where({ bundle_id: bundleId }).delete();
    await t('authorization_bundles').where({ bundle_id: bundleId }).delete();
  };

  const single = (ticketId: string, revision = 0) => ({ ticketId, expectedRevision: revision, note: NOTE, operationId: randomUUID() });
  const bulk = (ids: string[], revision = 0) => ({ tickets: ids.map((ticketId) => ({ ticketId, expectedRevision: revision })), note: NOTE, submissionId: randomUUID() });

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ runSeeds: false });
    handoff = await import('@alga-psa/tickets/actions/ticketResponsibilityActions');

    const tenant = await createTenant(db, `Seat update auth ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientA = await createClient(db, tenant, 'Client A');
    const staff = await createUser(db, tenant, { user_type: 'internal' });
    const narrowedStaff = await createUser(db, tenant, { user_type: 'internal' });
    const tech = await createUser(db, tenant, { user_type: 'internal' });
    const priority = randomUUID();
    await db('priorities').insert({ tenant, priority_id: priority, priority_name: 'High', created_by: staff, order_number: 1 });
    const id = randomUUID(); const status = randomUUID();
    await db('boards').insert({ tenant, board_id: id, board_name: 'B1', is_default: false, is_inactive: false });
    await db('statuses').insert({ tenant, status_id: status, board_id: id, name: 'Open', status_type: 'ticket',
      is_closed: false, is_default: true, created_by: staff, order_number: 1 });
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: clientA, operationId: randomUUID(), seats: 2 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId: id, canCreate: true }] });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: tech }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: tech, state: 'active' });
    });
    Object.assign(f, { tenant, clientA, staff, narrowedStaff, tech, priority, board: { id, status }, arrangementId: arrangement.arrangement_id, seq: 0 });
  }, 300_000);

  beforeEach(() => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    authMocks.tenant = f.tenant;
    authMocks.denied.clear();
  });
  afterAll(async () => {
    delete process.env.FORCE_CAPABILITIES;
    for (const bundleId of bundles) await dropBundle(bundleId).catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  });

  // case 1
  it('refuses a hand to client IT the actor can read but whose update a bundle narrows away, and writes nothing', async () => {
    const bundleId = await narrowUpdateFor(f.narrowedStaff);
    const ticketId = await ticket({ assignedTo: f.staff });
    const before = await snapshot(ticketId);
    as(f.narrowedStaff);

    const result: any = await (handoff.handTicketToClientIt as any)({ ...single(ticketId), technicianUserId: f.tech });
    expect(result).toMatchObject({ actionError: 'You cannot hand this ticket to client IT.' });
    expect(JSON.stringify(result)).not.toMatch(/permission denied/i);
    expect(await snapshot(ticketId)).toEqual(before);
    expect(before).toMatchObject({ work: null, receipts: 0 });
    await dropBundle(bundleId); bundles.splice(bundles.indexOf(bundleId), 1);
  }, 120_000);

  // case 4
  it('positive control: an allowed MSP user still hands off, and so does the same user before narrowing', async () => {
    const ticketId = await ticket({});
    as(f.staff);
    const result: any = await (handoff.handTicketToClientIt as any)({ ...single(ticketId), technicianUserId: f.tech });
    expect(result).toMatchObject({ state: { responsibility: 'client_it', revision: 1 } });
    expect(await snapshot(ticketId)).toMatchObject({ assignedTo: f.tech, work: { responsibility: 'client_it', revision: 1 }, receipts: 1 });
  }, 120_000);

  // case 2
  it('bulk hand to client IT refuses the narrowed ticket and still hands over the others', async () => {
    const bundleId = await narrowUpdateFor(f.narrowedStaff);
    const [a, b] = [await ticket({}), await ticket({})];
    const before = await snapshot(b);
    as(f.narrowedStaff);
    // The narrowing covers every ticket of the board, so this user's whole batch is refused.
    const refused: any = await (handoff.bulkHandTicketsToClientIt as any)(bulk([a, b]));
    for (const r of refused.results) expect(r).toMatchObject({ ok: false, messageKey: KEY('actorNotAllowed') });
    expect(await snapshot(b)).toEqual(before);
    expect(await snapshot(a)).toMatchObject({ work: null, receipts: 0 });
    await dropBundle(bundleId); bundles.splice(bundles.indexOf(bundleId), 1);
  }, 120_000);

  it('bulk: a batch mixing allowed and denied tickets hands over only the allowed ones', async () => {
    // A bundle that excludes one board only: the narrowed user keeps update on board B1 tickets and loses it on B2.
    const second = randomUUID(); const status = randomUUID();
    await db('boards').insert({ tenant: f.tenant, board_id: second, board_name: 'B2', is_default: false, is_inactive: false });
    await db('statuses').insert({ tenant: f.tenant, status_id: status, board_id: second, name: 'Open', status_type: 'ticket',
      is_closed: false, is_default: true, created_by: f.staff, order_number: 1 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: f.tenant, arrangementId: f.arrangementId,
      boards: [{ boardId: f.board.id, canCreate: true }, { boardId: second, canCreate: true }] });
    const created = await createAuthorizationBundle(db, { tenant: f.tenant, name: `Handoff B1-only update ${randomUUID()}`, actorUserId: f.staff });
    bundles.push(created.bundleId);
    await upsertBundleRule(db, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, resourceType: 'ticket', action: 'update',
      templateKey: 'selected_boards', config: { selectedBoardIds: [f.board.id] }, actorUserId: f.staff });
    await publishBundleRevision(db as any, { tenant: f.tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId: f.staff });
    const user = await createUser(db, f.tenant, { user_type: 'internal' });
    await createBundleAssignment(db, { tenant: f.tenant, bundleId: created.bundleId, targetType: 'user', targetId: user, actorUserId: f.staff });

    const allowed = await ticket({});
    const denied = randomUUID(); f.seq += 1;
    await db('tickets').insert({ tenant: f.tenant, ticket_id: denied, ticket_number: `RU-${f.seq}`, title: 'Denied board', client_id: f.clientA,
      board_id: second, status_id: status, priority_id: f.priority, entered_by: f.staff, entered_at: new Date() });
    const before = await snapshot(denied);
    as(user);
    const result: any = await (handoff.bulkHandTicketsToClientIt as any)(bulk([allowed, denied]));
    const byId = Object.fromEntries(result.results.map((r: any) => [r.ticketId, r]));
    expect(byId[allowed]).toMatchObject({ ok: true, state: { responsibility: 'client_it', revision: 1 } });
    expect(byId[denied]).toMatchObject({ ok: false, messageKey: KEY('actorNotAllowed') });
    expect(await snapshot(denied)).toEqual(before);
    expect(await snapshot(allowed)).toMatchObject({ work: { responsibility: 'client_it', revision: 1 }, receipts: 1 });
  }, 120_000);

  // case 3 (there is no single-ticket Hand to MSP action; the ticket list's bulk action is the user-facing door)
  it('refuses a seat technician\'s hand to MSP when a bundle narrows their update, and writes nothing', async () => {
    const ticketId = await ticket({ responsibility: 'client_it', revision: 1, assignedTo: f.tech });
    const before = await snapshot(ticketId);
    as(f.tech);
    const bundleId = await narrowUpdateFor(f.tech);
    const refused: any = await (handoff.bulkHandTicketsToMsp as any)(bulk([ticketId], 1));
    expect(refused.results[0]).toMatchObject({ ok: false, messageKey: KEY('actorNotAllowedMsp'), message: 'You cannot hand this ticket to the MSP.' });
    expect(await snapshot(ticketId)).toEqual(before);
    // Control: once the narrowing is gone, the technician's own built-in rule admits update and the handoff goes through.
    await dropBundle(bundleId); bundles.splice(bundles.indexOf(bundleId), 1);
    const allowed: any = await (handoff.bulkHandTicketsToMsp as any)(bulk([ticketId], 1));
    expect(allowed.results[0]).toMatchObject({ ok: true, state: { responsibility: 'msp', revision: 2 } });
  }, 120_000);

  // case 6
  it('runs the admission under the ticket lock and before any write: a throwing admission leaves no partial write, a passing one sees the locked row', async () => {
    const ticketId = await ticket({ assignedTo: f.staff });
    const before = await snapshot(ticketId);
    const request = { sponsorTenant: f.tenant, ticketId, actorUserId: f.staff, operationId: randomUUID(), expectedRevision: 0, note: NOTE, technicianUserId: f.tech };
    let sawWriteBeforeAdmission: unknown = 'unset';
    await expect(handCoManagedSeatTicketToClientIt(db, request, async (trx, { ticketId: id }) => {
      sawWriteBeforeAdmission = await snapshotIn(trx, id);
      throw new Error('denied');
    })).rejects.toMatchObject({ code: 'ACTOR_NOT_ALLOWED' });
    // At admission time nothing had been written in the transaction.
    expect(sawWriteBeforeAdmission).toMatchObject({ assignedTo: f.staff, work: null, receipts: 0 });
    expect(await snapshot(ticketId)).toEqual(before);

    // Lock: while the admission runs, a second transaction cannot take the ticket row.
    let lockedWhileAdmitting = false;
    await handCoManagedSeatTicketToClientIt(db, { ...request, operationId: randomUUID() }, async () => {
      lockedWhileAdmitting = await db.transaction(async (other) => {
        await other.raw("set local lock_timeout = '300ms'");
        try { await other('tickets').where({ tenant: f.tenant, ticket_id: ticketId }).forNoKeyUpdate().first('ticket_id'); return false; } catch { return true; }
      });
    });
    expect(lockedWhileAdmitting).toBe(true);
  }, 120_000);

  const snapshotIn = async (trx: Knex.Transaction, ticketId: string) => {
    const ticketRow = await trx('tickets').where({ tenant: f.tenant, ticket_id: ticketId }).first('assigned_to');
    const work = await trx('co_managed_seat_ticket_work').where({ tenant: f.tenant, ticket_id: ticketId }).first('responsibility');
    const receipts = await trx('co_managed_seat_ticket_handoffs').where({ tenant: f.tenant, ticket_id: ticketId }).count<{ count: string }[]>('* as count');
    return { assignedTo: ticketRow.assigned_to, work: work ?? null, receipts: Number(receipts[0].count) };
  };
});
