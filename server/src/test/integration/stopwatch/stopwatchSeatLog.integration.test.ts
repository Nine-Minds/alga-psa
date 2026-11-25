/**
 * Stopwatch log for a co-managed seat technician (operational billing mode) against a real database.
 *
 * The seat technician stops the ticket stopwatch and saves from the drawer (saveTimeEntry with
 * stopwatch_session_id, or logStopwatchSession). The entries are client IT effort: actual duration, zero
 * billable minutes, no service / contract line / tax, never visible to billing. An MSP technician on the
 * very same path still records commercial time. RBAC is stubbed to ALLOW EVERYTHING, so every refusal
 * below is the principal rule, not a missing permission.
 *
 * Run: TEST_DB_PORT=<dev stack db port> npx vitest run src/test/integration/stopwatch/stopwatchSeatLog.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any, user: null as any }));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, getAdminConnection: async () => h.db, getConnection: async () => h.db,
    createTenantKnex: async () => ({ knex: h.db, tenant: h.user?.tenant }) };
});
vi.mock('@alga-psa/db/admin', async (importOriginal) => ({ ...(await importOriginal<any>()), getAdminConnection: async () => h.db }));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, hasPermission: vi.fn(async () => true),
    withAuth: (handler: any) => (...args: any[]) => handler(h.user, { tenant: h.user.tenant }, ...args) };
});
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({ ...(await importOriginal<any>()), publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));

import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { commercialTimeEntrySql } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { describeWithDb } from '../../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';
import { pauseSession, resumeSession, startSession, getSession } from '../../../../../packages/scheduling/src/lib/stopwatch/stopwatchCore';
import { createBoard, createTicket, createPeriod, createSheet, seedBucketClient, grantPermissions, type BucketSeed } from './stopwatchTestSeed';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('stopwatch log for a seat technician (operational) vs an MSP technician', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let seatClientId: string;
  let seatTicketId: string;
  let outsideTicketId: string;
  let seatUser: string;
  let seatSheet: string;
  let mspUser: string;
  let mspSheet: string;
  let bucket: BucketSeed;
  let saveTimeEntry: any;
  let logStopwatchSession: any;

  const actAs = async (userId: string) => {
    h.user = { ...(await db('users').where({ tenant, user_id: userId }).first()), tenant, roles: [] };
  };
  const entriesFor = (userId: string) => tenantDb(db, tenant).table('time_entries').where({ user_id: userId });
  const links = (sessionId: string) => tenantDb(db, tenant).table('time_tracking_session_entries').where({ session_id: sessionId });
  const sessionRow = (sessionId: string) => tenantDb(db, tenant).table('time_tracking_sessions').where({ session_id: sessionId }).first();

  /** A paused session with one closed segment per [start, end] pair. */
  async function seedPaused(userId: string, ticketId: string, segments: Array<[string, string]>, serviceId: string | null = null) {
    let sessionId = '';
    for (const [index, [startIso, endIso]] of segments.entries()) {
      if (index === 0) {
        const started = await db.transaction((trx) =>
          startSession(trx, tenant, userId, { workItemType: 'ticket', workItemId: ticketId, serviceId, notes: 'seat stopwatch' }, { now: new Date(startIso) }));
        sessionId = started.session_id;
      } else {
        await db.transaction((trx) => resumeSession(trx, tenant, userId, sessionId, { now: new Date(startIso) }));
      }
      await db.transaction((trx) => pauseSession(trx, tenant, userId, sessionId, { now: new Date(endIso) }));
    }
    return sessionId;
  }

  /** The drawer's entry for one reviewed day. */
  const drawerEntry = (userId: string, sheetId: string, ticketId: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    entry_id: '', work_item_id: ticketId, work_item_type: 'ticket', start_time: start, end_time: end,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), billable_duration: 0,
    notes: 'seat stopwatch', user_id: userId, time_sheet_id: sheetId, approval_status: 'DRAFT', ...extra,
  });

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'stopwatch_seat_log_test' });
    h.db = db;
    tenant = await createTenant(db, `Seat stopwatch ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    seatClientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: seatClientId, operationId: randomUUID(), seats: 2 });
    seatUser = await createUser(db, tenant, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: seatUser }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: seatUser, state: 'active' });
    });
    await db('users').where({ tenant, user_id: seatUser }).update({ seat_reader: true });
    // The arrangement's board scope is what makes a ticket the seat technician's to work on.
    const boardId = await createBoard(db, tenant, undefined);
    await db('co_managed_seat_board_scopes').insert({ tenant, arrangement_id: arrangement.arrangement_id, board_id: boardId, can_create: false });
    seatTicketId = (await createTicket(db, tenant, { boardId, clientId: seatClientId })).ticketId;
    // Another client's ticket: outside the seat technician's scope.
    outsideTicketId = (await createTicket(db, tenant, { boardId })).ticketId;
    const periodId = await createPeriod(db, tenant, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    seatSheet = await createSheet(db, tenant, periodId, seatUser);
    mspUser = await createUser(db, tenant, { user_type: 'internal' });
    mspSheet = await createSheet(db, tenant, periodId, mspUser);
    await grantPermissions(db, tenant, mspUser, [{ resource: 'time_entry', action: 'create' }]);
    bucket = await seedBucketClient(db, tenant);
    ({ saveTimeEntry, logStopwatchSession } = await import('@alga-psa/scheduling/actions/timeEntryActions'));
  }, 600_000);
  afterAll(async () => { await db?.destroy().catch(() => undefined); });
  // One open session per user: discard whatever a previous case left open.
  beforeEach(async () => {
    h.user = null;
    await tenantDb(db, tenant).table('time_tracking_sessions').whereIn('status', ['running', 'paused'])
      .update({ status: 'discarded', closed_at: db.fn.now() });
  });

  it('saveTimeEntry with a stopwatch session logs operational client IT effort and closes the session', async () => {
    const sessionId = await seedPaused(seatUser, seatTicketId, [['2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z']]);
    await actAs(seatUser);
    const saved = await saveTimeEntry(drawerEntry(seatUser, seatSheet, seatTicketId, '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z',
      { billable_duration: 60, stopwatch_session_id: sessionId }));
    expect(saved.entry_id).toBeTruthy();

    const rows = await entriesFor(seatUser);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billing_mode: 'operational', service_id: null, contract_line_id: null, tax_rate_id: null, tax_region: null, invoiced: false });
    expect(Number(rows[0].billable_duration)).toBe(0);
    expect(new Date(rows[0].end_time).getTime() - new Date(rows[0].start_time).getTime()).toBe(3_600_000);
    expect(rows[0].time_sheet_id).toBe(seatSheet);
    expect((await sessionRow(sessionId)).status).toBe('logged');
    expect(await links(sessionId)).toHaveLength(1);

    // Out of billing: the commercial predicate and the unbilled-time review never see it.
    expect(await entriesFor(seatUser).whereRaw(commercialTimeEntrySql())).toHaveLength(0);
    await actAs(mspUser);
    const { getUnresolvedChargeReview } = await import('@alga-psa/billing/actions/unresolvedChargeActions');
    const review: any[] = await getUnresolvedChargeReview({ clientId: seatClientId, windowStart: '2026-11-01', windowEnd: '2026-12-01' }) as any;
    expect(review.map((r) => r.recordId)).not.toContain(rows[0].entry_id);
  });

  it('logStopwatchSession splits a seat session across midnight: one operational entry per day, all zero billable', async () => {
    const sessionId = await seedPaused(seatUser, seatTicketId, [['2026-11-12T22:30:00.000Z', '2026-11-13T01:30:00.000Z']]);
    await actAs(seatUser);
    const result = await logStopwatchSession(sessionId, [
      drawerEntry(seatUser, seatSheet, seatTicketId, '2026-11-12T22:30:00.000Z', '2026-11-12T23:59:00.000Z', { billable_duration: 89 }),
      drawerEntry(seatUser, seatSheet, seatTicketId, '2026-11-13T00:00:00.000Z', '2026-11-13T01:30:00.000Z', { billable_duration: 90 }),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const rows = (await links(sessionId)).map((l: any) => l.entry_id);
    expect(rows).toHaveLength(2);
    const entries = await entriesFor(seatUser).whereIn('entry_id', rows).orderBy('start_time');
    expect(entries.map((e: any) => new Date(e.work_date).toISOString().slice(0, 10))).toEqual(['2026-11-12', '2026-11-13']);
    expect(entries.every((e: any) => e.billing_mode === 'operational' && Number(e.billable_duration) === 0 && e.service_id === null)).toBe(true);
    expect((await sessionRow(sessionId)).status).toBe('logged');
  });

  it('the core itself splits an un-reviewed seat session per day as operational, whatever the span or is_billable says', async () => {
    const { logSession } = await import('../../../../../packages/scheduling/src/lib/stopwatch/stopwatchCore');
    const sessionId = await seedPaused(seatUser, seatTicketId, [['2026-11-16T22:30:00.000Z', '2026-11-17T01:30:00.000Z']], bucket.serviceId);
    const actor = { ...(await db('users').where({ tenant, user_id: seatUser }).first()), tenant };
    const { persisted } = await db.transaction((trx) => logSession(trx, tenant, actor, sessionId, { is_billable: true }, { now: new Date('2026-11-17T02:00:00.000Z') }));
    expect(persisted).toHaveLength(2);
    const rows = await entriesFor(seatUser).whereIn('entry_id', persisted.map((p) => p.entry.entry_id));
    // The draft's service_id (a commercial one) is not applied to the operational entry.
    expect(rows.every((e: any) => e.billing_mode === 'operational' && Number(e.billable_duration) === 0 && e.service_id === null)).toBe(true);
    expect((await sessionRow(sessionId)).service_id).toBeNull();
  });

  it('a failed save rolls back and leaves the session paused; the retry logs one set; a repeat does not duplicate', async () => {
    const sessionId = await seedPaused(seatUser, seatTicketId, [['2026-11-18T09:00:00.000Z', '2026-11-18T10:00:00.000Z']]);
    const before = (await entriesFor(seatUser)).length;
    await actAs(seatUser);

    // A commercial field on a seat save is refused, not dropped.
    await expect(logStopwatchSession(sessionId, [
      drawerEntry(seatUser, seatSheet, seatTicketId, '2026-11-18T09:00:00.000Z', '2026-11-18T10:00:00.000Z', { service_id: bucket.serviceId }),
    ])).rejects.toThrow('OPERATIONAL_TIME_COMMERCIAL_FIELDS');
    expect((await entriesFor(seatUser)).length).toBe(before);
    expect(await links(sessionId)).toHaveLength(0);
    expect((await sessionRow(sessionId)).status).toBe('paused');

    const good = [drawerEntry(seatUser, seatSheet, seatTicketId, '2026-11-18T09:00:00.000Z', '2026-11-18T10:00:00.000Z')];
    const ok = await logStopwatchSession(sessionId, good);
    expect(Array.isArray(ok)).toBe(true);
    expect((await entriesFor(seatUser)).length).toBe(before + 1);
    expect((await sessionRow(sessionId)).status).toBe('logged');

    const again = await logStopwatchSession(sessionId, good);
    expect(Array.isArray(again)).toBe(false);
    expect((await entriesFor(seatUser)).length).toBe(before + 1);
    expect(await links(sessionId)).toHaveLength(1);
  });

  it('a seat session on a ticket outside the technician\'s scope is refused and stays open', async () => {
    const sessionId = await seedPaused(seatUser, outsideTicketId, [['2026-11-19T09:00:00.000Z', '2026-11-19T10:00:00.000Z']]);
    const before = (await entriesFor(seatUser)).length;
    await actAs(seatUser);
    const res = await logStopwatchSession(sessionId, [drawerEntry(seatUser, seatSheet, outsideTicketId, '2026-11-19T09:00:00.000Z', '2026-11-19T10:00:00.000Z')]).then((v: any) => v, (e: any) => e);
    expect(Array.isArray(res)).toBe(false);
    expect((await entriesFor(seatUser)).length).toBe(before);
    expect((await sessionRow(sessionId)).status).toBe('paused');
  });

  it('an MSP technician on the same path still records commercial time and must name a service', async () => {
    const sessionId = await seedPaused(mspUser, bucket.ticketId, [['2026-11-20T09:00:00.000Z', '2026-11-20T10:00:00.000Z']]);
    await actAs(mspUser);

    await expect(logStopwatchSession(sessionId, [drawerEntry(mspUser, mspSheet, bucket.ticketId, '2026-11-20T09:00:00.000Z', '2026-11-20T10:00:00.000Z')]))
      .rejects.toThrow(/service_id is required/);
    expect(await entriesFor(mspUser)).toHaveLength(0);
    expect((await sessionRow(sessionId)).status).toBe('paused');

    const ok = await logStopwatchSession(sessionId, [drawerEntry(mspUser, mspSheet, bucket.ticketId, '2026-11-20T09:00:00.000Z', '2026-11-20T10:00:00.000Z',
      { service_id: bucket.serviceId, billable_duration: 60 })]);
    expect(Array.isArray(ok)).toBe(true);
    const rows = await entriesFor(mspUser);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billing_mode: 'commercial', service_id: bucket.serviceId });
    expect(Number(rows[0].billable_duration)).toBe(60);
    expect((await sessionRow(sessionId)).status).toBe('logged');
    expect((await getSession(db as any, tenant, mspUser, sessionId))?.status).toBe('logged');
  });
});
