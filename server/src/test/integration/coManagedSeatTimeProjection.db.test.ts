/**
 * F069 repair (S28): MSP commercial time never reaches a seat technician's Time logged tile or Timeline.
 *
 * Seeds one arrangement client with two seat technicians (operational entries) and an MSP user (commercial entries with
 * distinctive notes) on one ticket, then calls the REAL actions (`fetchTimeEntriesForTicket`, `getTicketTimelineEntries`)
 * as each reader, with the arrangement setting `mspEffortVisibleToTechnicians` off and on. Only the session and the coarse
 * RBAC check are stubbed. Assertions are on keys and values of the serialized payload, never on substrings of rendered text.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ on: true }));
const conn = vi.hoisted(() => ({ db: null as any, user: null as any }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getAdminConnection: async () => conn.db,
  createTenantKnex: async () => ({ knex: conn.db, tenant: conn.user?.tenant }),
}));
vi.mock('@alga-psa/db/admin', async (importOriginal) => ({ ...(await importOriginal<any>()), getAdminConnection: async () => conn.db }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(conn.user, { tenant: conn.user.tenant }, ...args),
  getCurrentUser: vi.fn(async () => conn.user),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

import { runWithTenant } from '@alga-psa/db';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { SEAT_MSP_EFFORT_VISIBLE_SETTING } from '@alga-psa/shared/lib/humanWork/seatEffortSummary';
import '@alga-psa/co-managed/seatCapability';
import { registerFeatureFlagChecker } from '../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();
const MSP_NOTE_1 = 'MSP-SECRET replaced failing PoE switch';
const MSP_NOTE_2 = 'MSP-SECRET rebuilt VLAN trunk';

describeDb('a seat technician sees operational time only on the tile and the timeline (F069)', { shuffle: false }, () => {
  let db: Knex;

  async function world() {
    const tenant = await createTenant(db, `Time sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, tenant, `Time client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 2 });
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: false }] });
    const tech = async () => {
      const userId = await createUser(db, tenant, { user_type: 'internal' });
      await db.transaction(async (trx) => {
        await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
        await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: userId, state: 'active' });
      });
      await db('users').where({ tenant, user_id: userId }).update({ seat_reader: true });
      return userId;
    };
    const [techA, techB, msp] = [await tech(), await tech(), await createUser(db, tenant, { user_type: 'internal' })];
    await db('users').where({ tenant, user_id: msp }).update({ seat_reader: false });
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${randomUUID().slice(0, 6)}`, title: 'Time projection ticket', client_id: clientId, board_id: boardId, assigned_to: techA, entered_at: db.fn.now(), updated_at: db.fn.now() });
    const entry = async (userId: string, mode: 'operational' | 'commercial', hour: number, minutes: number, notes: string, billable = mode === 'commercial' ? minutes : 0) => {
      const entryId = randomUUID();
      await db('time_entries').insert({
        tenant, entry_id: entryId, user_id: userId, work_item_type: 'ticket', work_item_id: ticketId,
        start_time: new Date(Date.UTC(2026, 10, 2, hour, 0)), end_time: new Date(Date.UTC(2026, 10, 2, hour, minutes)),
        billable_duration: billable, billing_mode: mode, approval_status: 'DRAFT', notes,
        work_date: '2026-11-02', work_timezone: 'UTC', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now(),
      });
      return entryId;
    };
    // Client IT: A 30 + 15, B 45 (= 90). MSP: 60 + 20 (= 80, distinctive notes).
    // B's entry is adversarial: operational but stored with 45 billable minutes, which the product never writes;
    // it must still read as non-billable (billing_mode decides, not the stored minutes).
    const operational = [await entry(techA, 'operational', 8, 30, 'OP-A one'), await entry(techA, 'operational', 9, 15, 'OP-A two'), await entry(techB, 'operational', 10, 45, 'OP-B one', 45)];
    const commercial = [await entry(msp, 'commercial', 11, 60, MSP_NOTE_1), await entry(msp, 'commercial', 13, 20, MSP_NOTE_2)];
    return { tenant, clientId, arrangementId: arrangement.arrangement_id, ticketId, techA, techB, msp, operational, commercial };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const asUser = async (w: World, userId: string) => {
    const row = await db('users').where({ tenant: w.tenant, user_id: userId }).first();
    conn.user = { ...row, tenant: w.tenant, user_type: 'internal', roles: [] };
  };
  const setSetting = (w: World, on: boolean) =>
    db('co_managed_seat_arrangements').where({ tenant: w.tenant, arrangement_id: w.arrangementId }).update({ settings: JSON.stringify({ [SEAT_MSP_EFFORT_VISIBLE_SETTING]: on }) });

  const tile = async (w: World, userId: string) => {
    const { fetchTimeEntriesForTicket } = await import('@alga-psa/scheduling/actions/timeEntryTicketActions');
    await asUser(w, userId);
    return JSON.parse(JSON.stringify(await runWithTenant(w.tenant, () => (fetchTimeEntriesForTicket as any)(w.ticketId))));
  };
  const timeline = async (w: World, userId: string) => {
    const { getTicketTimelineEntries } = await import('@alga-psa/tickets/actions/ticketActivityActions');
    await asUser(w, userId);
    const result = JSON.parse(JSON.stringify(await runWithTenant(w.tenant, () => (getTicketTimelineEntries as any)(w.ticketId, { order: 'asc', includeTimeEntries: true }))));
    if (!Array.isArray(result)) throw new Error(`timeline refused: ${JSON.stringify(result)}`);
    return result;
  };
  const entryIds = (payload: any[]) => payload.map((e) => e.entry_id ?? e.timeEntry?.entry_id).filter(Boolean);

  beforeAll(async () => {
    process.env.CAPABILITY_CACHE_TTL_MS = '0';
    registerFeatureFlagChecker(async () => flag.on);
    flag.on = true;
    db = await createTestDbConnection({ databaseName: 's28_time_projection_test' });
    conn.db = db;
  }, 600_000);
  afterEach(() => clearCapabilityCache());
  afterAll(async () => { await db?.destroy(); });

  for (const setting of [false, true]) {
    it(`Time logged tile: seat technician gets operational entries, totals and counts only (setting ${setting ? 'on' : 'off'})`, async () => {
      const w = await world();
      await setSetting(w, setting);
      const summary = await tile(w, w.techA);

      // A: 45 own minutes in 2 entries; B: 45 minutes in 1 entry; no MSP minute anywhere.
      expect(summary).toMatchObject({
        ownTotalMinutes: 45, ownEntryCount: 2, othersTotalMinutes: 45, othersEntryCount: 1, totalMinutes: 90,
      });
      expect(summary.othersVisibleMinutes + summary.othersHiddenMinutes).toBe(45);
      expect(summary.othersVisibleCount + summary.othersHiddenCount).toBe(1);
      const ids: string[] = entryIds(summary.entries);
      expect(ids.every((id) => w.operational.includes(id))).toBe(true);
      expect(ids.some((id) => w.commercial.includes(id))).toBe(false);
      expect(summary.entries.every((e: any) => e.billable_duration === 0)).toBe(true);
      expect(summary.entries.every((e: any) => e.notes === null || /^OP-/.test(e.notes))).toBe(true);
      expect(JSON.stringify(summary)).not.toContain('MSP-SECRET');
    });

    it(`Timeline: seat technician gets no time events for commercial entries (setting ${setting ? 'on' : 'off'})`, async () => {
      const w = await world();
      await setSetting(w, setting);
      const payload = await timeline(w, w.techA);

      const timeEvents = payload.filter((e: any) => e.type === 'time_entry');
      expect(entryIds(timeEvents).sort()).toEqual([...w.operational].sort());
      expect(timeEvents.every((e: any) => e.timeEntry.billable_duration === 0)).toBe(true);
      expect(entryIds(payload).some((id: string) => w.commercial.includes(id))).toBe(false);
      expect(JSON.stringify(payload)).not.toContain('MSP-SECRET');
    });
  }

  it('MSP staff still get the commercial entries on both payloads', async () => {
    const w = await world();
    for (const on of [false, true]) {
      await setSetting(w, on);
      const summary = await tile(w, w.msp);
      // Others' entries are counted and totalled; the MSP user's own commercial entries are listed (the kernel redacts other people's).
      expect(summary).toMatchObject({ totalMinutes: 170, ownTotalMinutes: 80, ownEntryCount: 2, othersTotalMinutes: 90, othersEntryCount: 3 });
      expect(entryIds(summary.entries).sort()).toEqual([...w.commercial].sort());
      expect(summary.entries.some((e: any) => e.notes === MSP_NOTE_1)).toBe(true);

      const events = (await timeline(w, w.msp)).filter((e: any) => e.type === 'time_entry');
      expect(entryIds(events).sort()).toEqual([...w.operational, ...w.commercial].sort());
      expect(events.filter((e: any) => w.commercial.includes(e.timeEntry.entry_id)).every((e: any) => e.timeEntry.billable_duration > 0)).toBe(true);
      expect(events.some((e: any) => e.timeEntry.notes === MSP_NOTE_2)).toBe(true);
      // An operational entry is non-billable for MSP staff too, whatever its stored minutes.
      expect(events.filter((e: any) => w.operational.includes(e.timeEntry.entry_id)).every((e: any) => e.timeEntry.billable_duration === 0)).toBe(true);
    }
  });
});
