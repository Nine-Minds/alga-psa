/**
 * T037 (S28, F069): effort on a ticket by organization, projected to the viewer on the SERVER.
 *
 * Seeds one seat arrangement with two seat technicians and one MSP user working one ticket, then reads the same payload the
 * ticket load builds (`resolveTicketSeatContext` + `resolveSeatEffortSummary`):
 *  - a seat technician gets client IT's total (summed across the client's technicians) and their own entries, and NO
 *    MSP total by default: the key is absent from the object, so it can never be serialized to the browser;
 *  - flipping the arrangement setting (`co_managed_seat_arrangements.settings.mspEffortVisibleToTechnicians`) shows it on
 *    the technician's very next load, and flipping it back hides it again;
 *  - MSP staff get both totals and their sum.
 * The assertions are on the returned payload object (what the server hands to the screen), not on rendered output.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ on: true }));
const conn = vi.hoisted(() => ({ db: null as any }));
// Capability resolvers read through the admin connection: point it at this suite's database.
vi.mock('@alga-psa/db', async (importOriginal) => ({ ...(await importOriginal<any>()), getAdminConnection: async () => conn.db }));

import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { resolveTicketSeatContext } from '@alga-psa/shared/lib/humanWork/ticketSeatContext';
import { resolveSeatAssigneeAudience } from '@alga-psa/shared/lib/humanWork/seatAssigneeAudience';
import { resolveSeatEffortSummary, SEAT_MSP_EFFORT_VISIBLE_SETTING } from '@alga-psa/shared/lib/humanWork/seatEffortSummary';
import '@alga-psa/co-managed/seatCapability';
import { registerFeatureFlagChecker } from '../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('seat effort summary is projected to the viewer on the server (T037)', { shuffle: false }, () => {
  let db: Knex;
  const t = (hour: number, minutes: number) => ({
    start_time: new Date(Date.UTC(2026, 10, 2, hour, 0)), end_time: new Date(Date.UTC(2026, 10, 2, hour, minutes)),
  });

  async function world() {
    const tenant = await createTenant(db, `Effort sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, tenant, `Effort client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 2 });
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
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `E-${randomUUID().slice(0, 6)}`, title: 'Effort ticket', client_id: clientId, entered_at: db.fn.now(), updated_at: db.fn.now() });
    const entry = (userId: string, mode: 'operational' | 'commercial', hour: number, minutes: number) => db('time_entries').insert({
      tenant, entry_id: randomUUID(), user_id: userId, work_item_type: 'ticket', work_item_id: ticketId, ...t(hour, minutes),
      billable_duration: mode === 'commercial' ? minutes : 0, billing_mode: mode, approval_status: 'DRAFT', notes: `${mode} ${minutes}`,
      work_date: '2026-11-02', work_timezone: 'UTC', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    // Client IT: A 30 + 15, B 45 (= 90). MSP: 60 + 20 (= 80). A's own: 45.
    await entry(techA, 'operational', 8, 30); await entry(techA, 'operational', 9, 15); await entry(techB, 'operational', 10, 45);
    await entry(msp, 'commercial', 11, 60); await entry(msp, 'commercial', 13, 20);
    return { tenant, clientId, arrangementId: arrangement.arrangement_id, ticketId, techA, techB, msp };
  }

  /** What the ticket load does: seat context for the reader, then the effort projection built from it. */
  async function load(w: Awaited<ReturnType<typeof world>>, userId: string) {
    // The ticket load reads the tenant's internal users (with their seat marker) for its pickers and hands them over.
    const loadedUsers = await db('users').where({ tenant: w.tenant, user_type: 'internal' }).select('user_id', 'user_type', 'seat_reader');
    const readerRow = loadedUsers.find((u: any) => u.user_id === userId);
    const seatAudience = await resolveSeatAssigneeAudience(db, w.tenant, readerRow);
    const seatTicket = await resolveTicketSeatContext(db, w.tenant, readerRow, w.clientId, seatAudience, loadedUsers);
    return resolveSeatEffortSummary(db, w.tenant, { seatTicket, userId, ticketId: w.ticketId, clientId: w.clientId });
  }
  const setSetting = (w: { tenant: string; arrangementId: string }, settings: object) =>
    db('co_managed_seat_arrangements').where({ tenant: w.tenant, arrangement_id: w.arrangementId }).update({ settings: JSON.stringify(settings) });

  beforeAll(async () => {
    process.env.CAPABILITY_CACHE_TTL_MS = '0';
    // The release flag provider is the stand-in; the capability gate and the seat resolvers are real.
    registerFeatureFlagChecker(async () => flag.on);
    flag.on = true;
    db = await createTestDbConnection({ databaseName: 's28_operational_time_test' });
    conn.db = db;
  }, 600_000);
  afterEach(() => clearCapabilityCache());
  afterAll(async () => { await db?.destroy(); });

  it('a seat technician sees client IT total and their own entries, and no MSP total by default', async () => {
    const w = await world();
    const summary = await load(w, w.techA);

    expect(summary).toMatchObject({ viewer: 'client_it', clientItMinutes: 90, ownMinutes: 45 });
    expect(summary!.ownEntries!.map((e) => e.minutes).sort()).toEqual([15, 30]);
    // The server payload itself carries no MSP figure: not zero, not hidden - absent, and nothing derived from it.
    expect(summary).not.toHaveProperty('mspMinutes');
    expect(summary).not.toHaveProperty('combinedMinutes');
    expect(JSON.stringify(summary)).not.toMatch(/msp|80|140/i);
    // Another technician's entries are in the client IT total only, never listed.
    expect(summary!.ownEntries!.every((e) => e.notes?.startsWith('operational'))).toBe(true);
  });

  it('the arrangement setting shows the MSP total on the next load and hides it again when turned off', async () => {
    const w = await world();
    await setSetting(w, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: true });
    expect(await load(w, w.techB)).toMatchObject({ viewer: 'client_it', clientItMinutes: 90, mspMinutes: 80, ownMinutes: 45 });

    await setSetting(w, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: false });
    expect(await load(w, w.techB)).not.toHaveProperty('mspMinutes');
    // Only the boolean `true` opens it; a truthy string does not.
    await setSetting(w, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: 'true' });
    expect(await load(w, w.techB)).not.toHaveProperty('mspMinutes');
    await setSetting(w, {});
    expect(await load(w, w.techB)).not.toHaveProperty('mspMinutes');
  });

  it('MSP staff see both totals and their sum whatever the setting says', async () => {
    const w = await world();
    for (const settings of [{}, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: false }, { [SEAT_MSP_EFFORT_VISIBLE_SETTING]: true }]) {
      await setSetting(w, settings);
      expect(await load(w, w.msp)).toEqual({ viewer: 'msp', clientItMinutes: 90, mspMinutes: 80, combinedMinutes: 170 });
    }
  });

  it('has no summary without an arrangement or while the release flag is off', async () => {
    const w = await world();
    const otherClient = await createClient(db, w.tenant, `No seats ${randomUUID().slice(0, 8)}`);
    const loadedUsers = await db('users').where({ tenant: w.tenant, user_type: 'internal' }).select('user_id', 'user_type', 'seat_reader');
    const readerRow = loadedUsers.find((u: any) => u.user_id === w.msp);
    const noArrangement = await resolveTicketSeatContext(db, w.tenant, readerRow, otherClient, null, loadedUsers);
    expect(await resolveSeatEffortSummary(db, w.tenant, { seatTicket: noArrangement, userId: w.msp, ticketId: w.ticketId, clientId: otherClient })).toBeNull();

    flag.on = false;
    clearCapabilityCache();
    try {
      // Release flag off: the tenant still participates (history survives), but nothing user-visible is projected to anyone.
      expect(await load(w, w.msp)).toBeNull();
      expect(await load(w, w.techA)).toBeNull();
    } finally { flag.on = true; clearCapabilityCache(); }
  });
});
