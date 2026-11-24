/**
 * T036 (S28, F068 + F070): operational (seat technician) time stays out of billing and approval, and the technician
 * manages their own.
 *
 * One period holds commercial MSP entries and operational seat-technician entries. The operational rows are seeded
 * ADVERSARIALLY: they carry a service, a billable duration and an APPROVED status, exactly what a commercial read
 * would collect, so the only thing that can keep them out is `billing_mode = 'operational'` (the F068 predicate).
 * The unbilled-time list and the approval queue are the real actions; the billing run and invoice preview are covered in
 * billingInvoiceTiming.integration.test.ts (T036 case) because they need that suite's contract fixtures.
 *
 * F070 runs the real server actions as the seat technician with RBAC stubbed to ALLOW EVERYTHING, so every refusal
 * below is the principal rule (the seat surface), not a missing permission.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any, user: null as any }));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, getAdminConnection: async () => h.db, getConnection: async () => h.db,
    createTenantKnex: async () => ({ knex: h.db, tenant: h.user?.tenant }) };
});
// The principal read (`loadProductPrincipal`) goes through the admin subpath.
vi.mock('@alga-psa/db/admin', async (importOriginal) => ({ ...(await importOriginal<any>()), getAdminConnection: async () => h.db }));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, hasPermission: vi.fn(async () => true),
    withAuth: (handler: any) => (...args: any[]) => handler(h.user, { tenant: h.user.tenant }, ...args) };
});
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({ ...(await importOriginal<any>()), publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn() }));

import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { surfaceAllowsRoute } from '../../../../shared/services/productSurfaceKinds';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('operational time stays out of billing and approval; the technician manages their own (T036)', { shuffle: false }, () => {
  let db: Knex;
  let w: Awaited<ReturnType<typeof world>>;

  async function world() {
    const tenant = await createTenant(db, `Operational sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, tenant, `Operational client ${randomUUID().slice(0, 8)}`);
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
    const [techA, techB, msp, approver] = [await tech(), await tech(), await createUser(db, tenant, { user_type: 'internal' }), await createUser(db, tenant, { user_type: 'internal' })];
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `O-${randomUUID().slice(0, 6)}`, title: 'Operational ticket', client_id: clientId, entered_at: db.fn.now(), updated_at: db.fn.now() });
    const serviceTypeId = randomUUID(), serviceId = randomUUID();
    await db('service_types').insert({ tenant, id: serviceTypeId, name: 'Support type' });
    await db('service_catalog').insert({ tenant, service_id: serviceId, service_name: 'Support', billing_method: 'per_unit', custom_service_type_id: serviceTypeId, default_rate: 10000 });
    const periodId = randomUUID();
    await db('time_periods').insert({ tenant, period_id: periodId, start_date: '2026-11-01', end_date: '2026-12-01' });
    const sheet = async (userId: string, status: string) => {
      const id = randomUUID();
      await db('time_sheets').insert({ tenant, id, user_id: userId, period_id: periodId, approval_status: status });
      return id;
    };
    const [sheetA, sheetB, sheetMsp] = [await sheet(techA, 'DRAFT'), await sheet(techB, 'DRAFT'), await sheet(msp, 'SUBMITTED')];
    const entry = async (userId: string, sheetId: string, mode: 'operational' | 'commercial', day: number) => {
      const entryId = randomUUID();
      await db('time_entries').insert({ tenant, entry_id: entryId, user_id: userId, time_sheet_id: sheetId, work_item_type: 'ticket', work_item_id: ticketId,
        service_id: serviceId, // adversarial for operational rows: a real write never sets this
        start_time: new Date(Date.UTC(2026, 10, day, 9)), end_time: new Date(Date.UTC(2026, 10, day, 10)),
        billable_duration: 60, billing_mode: mode, approval_status: 'APPROVED', notes: `${mode} day ${day}`,
        work_date: `2026-11-${String(day).padStart(2, '0')}`, work_timezone: 'UTC', invoiced: false, contract_line_id: null,
        created_at: db.fn.now(), updated_at: db.fn.now() });
      return entryId;
    };
    const entries = {
      commercial1: await entry(msp, sheetMsp, 'commercial', 3), commercial2: await entry(msp, sheetMsp, 'commercial', 4),
      opA1: await entry(techA, sheetA, 'operational', 5), opA2: await entry(techA, sheetA, 'operational', 6),
      opB1: await entry(techB, sheetB, 'operational', 7),
    };
    const actAs = async (userId: string) => { h.user = { ...(await db('users').where({ tenant, user_id: userId }).first()), tenant, roles: [] }; };
    return { tenant, clientId, serviceId, ticketId, techA, techB, msp, approver, sheetA, sheetB, sheetMsp, entries, actAs };
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's28_operational_time_test' });
    h.db = db;
    w = await world();
  }, 600_000);
  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { h.user = null; });

  // ---- F068: commercial surfaces ------------------------------------------------------------------------------

  it('the unbilled-time list holds the commercial entries and none of the operational ones', async () => {
    await w.actAs(w.msp);
    const { getUnresolvedChargeReview } = await import('@alga-psa/billing/actions/unresolvedChargeActions');
    const rows: any[] = await getUnresolvedChargeReview({ clientId: w.clientId, windowStart: '2026-11-01', windowEnd: '2026-12-01' }) as any;
    expect(rows.map((row) => row.recordId).sort()).toEqual([w.entries.commercial1, w.entries.commercial2].sort());
  });

  it('the approval queue lists commercial sheets and never a sheet of only operational entries, even a submitted one', async () => {
    // A stray SUBMITTED sheet of operational entries (the UI and server refuse submission, so this is the adversarial case).
    await db('time_sheets').where({ tenant: w.tenant, id: w.sheetA }).update({ approval_status: 'SUBMITTED' });
    await w.actAs(w.approver);
    const { fetchTimeSheetsForApproval } = await import('@alga-psa/scheduling/actions/timeSheetActions');
    const queue: any[] = await fetchTimeSheetsForApproval(false) as any;
    await db('time_sheets').where({ tenant: w.tenant, id: w.sheetA }).update({ approval_status: 'DRAFT' });
    const ids = queue.map((sheet) => sheet.id);
    expect(ids).toContain(w.sheetMsp);
    expect(ids).not.toContain(w.sheetA); // SUBMITTED, but every entry on it is operational
    expect(ids).not.toContain(w.sheetB);
  });

  it('an approver reading a seat technician\'s sheet sees none of its operational entries', async () => {
    await w.actAs(w.approver);
    const { fetchTimeEntriesForTimeSheet } = await import('@alga-psa/scheduling/actions/timeEntryCrudActions');
    expect(await fetchTimeEntriesForTimeSheet(w.sheetA)).toEqual([]);
    const mine: any[] = await fetchTimeEntriesForTimeSheet(w.sheetMsp) as any;
    expect(mine.map((e) => e.entry_id).sort()).toEqual([w.entries.commercial1, w.entries.commercial2].sort());
  });

  it('approving a sheet approves its commercial entries and leaves an operational entry on it untouched', async () => {
    // A mixed sheet: the MSP user's own sheet with a stray operational entry on it.
    const stray = randomUUID();
    await db('time_entries').insert({ tenant: w.tenant, entry_id: stray, user_id: w.msp, time_sheet_id: w.sheetMsp, work_item_type: 'ticket', work_item_id: w.ticketId,
      start_time: new Date(Date.UTC(2026, 10, 9, 9)), end_time: new Date(Date.UTC(2026, 10, 9, 10)), billable_duration: 0, billing_mode: 'operational',
      approval_status: 'SUBMITTED', work_date: '2026-11-09', work_timezone: 'UTC', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('time_entries').where({ tenant: w.tenant, entry_id: w.entries.commercial1 }).update({ approval_status: 'SUBMITTED' });

    await w.actAs(w.approver);
    const { approveTimeSheet } = await import('@alga-psa/scheduling/actions/timeSheetActions');
    await approveTimeSheet(w.sheetMsp, w.approver);

    const status = async (id: string) => (await db('time_entries').where({ tenant: w.tenant, entry_id: id }).first('approval_status')).approval_status;
    expect(await status(w.entries.commercial1)).toBe('APPROVED');
    expect(await status(stray)).toBe('SUBMITTED');
    expect((await db('time_sheets').where({ tenant: w.tenant, id: w.sheetMsp }).first()).approval_status).toBe('APPROVED');
    // Per-entry review refuses an operational entry outright.
    const { updateTimeEntryApprovalStatus } = await import('@alga-psa/scheduling/actions/timeEntryCrudActions');
    const refused: any = await updateTimeEntryApprovalStatus({ entryId: stray, approvalStatus: 'APPROVED' });
    expect(refused?.permissionError ?? refused?.error ?? refused).toBeTruthy();
    expect(await status(stray)).toBe('SUBMITTED');
  });

  it('the seat surface has no approval or period views, so those routes do not exist for a technician', () => {
    expect(surfaceAllowsRoute('co_managed_seat', '/msp/time-sheet-approvals')).toBe(false);
    expect(surfaceAllowsRoute('co_managed_seat', '/msp/time-entry')).toBe(true);
  });

  // ---- F070: the technician manages their own operational entries ---------------------------------------------

  it('lists only their own operational entries', async () => {
    await w.actAs(w.techA);
    const { fetchOwnOperationalTimeEntries } = await import('@alga-psa/scheduling/actions/operationalTimeEntryActions');
    const own: any[] = await fetchOwnOperationalTimeEntries({}) as any;
    expect(own.map((e) => e.entry_id).sort()).toEqual([w.entries.opA1, w.entries.opA2].sort());
    expect(own.every((e) => e.minutes === 60)).toBe(true);
    expect(own[0].ticket_number).toMatch(/^O-/);
    // Narrowing by ticket never widens it.
    expect(((await fetchOwnOperationalTimeEntries({ ticketId: w.ticketId })) as any[]).length).toBe(2);
    // MSP staff have no operational list.
    await w.actAs(w.msp);
    expect(await fetchOwnOperationalTimeEntries({})).toMatchObject({ permissionError: expect.any(String) });
  });

  it('reads their own entry and refuses someone else\'s operational entry and any commercial entry', async () => {
    await w.actAs(w.techA);
    const { getTimeEntryById } = await import('@alga-psa/scheduling/actions/timeEntryCrudActions');
    expect(((await getTimeEntryById(w.entries.opA1)) as any)?.entry_id).toBe(w.entries.opA1);
    expect(await getTimeEntryById(w.entries.opB1)).toMatchObject({ permissionError: expect.any(String) });
    expect(await getTimeEntryById(w.entries.commercial1)).toMatchObject({ permissionError: expect.any(String) });
  });

  it('edits their own entry, and is refused another user\'s entry and any commercial entry', async () => {
    await w.actAs(w.techA);
    const { saveTimeEntry } = await import('@alga-psa/scheduling/actions/timeEntryCrudActions');
    const edit = (entryId: string, userId: string, notes: string) => (saveTimeEntry as any)({
      entry_id: entryId, work_item_id: w.ticketId, work_item_type: 'ticket', notes, user_id: userId, time_sheet_id: w.sheetA,
      start_time: '2026-11-05T09:00:00.000Z', end_time: '2026-11-05T10:30:00.000Z', created_at: '2026-11-05T09:00:00.000Z', updated_at: '2026-11-05T09:00:00.000Z',
      billable_duration: 0, approval_status: 'DRAFT',
    });
    const saved: any = await edit(w.entries.opA1, w.techA, 'edited by the technician');
    expect(saved?.permissionError, JSON.stringify(saved)).toBeUndefined();
    const row = await db('time_entries').where({ tenant: w.tenant, entry_id: w.entries.opA1 }).first();
    expect(row.notes).toBe('edited by the technician');
    expect(row.billing_mode).toBe('operational');
    expect(Number(row.billable_duration)).toBe(0);
    expect(row.service_id).toBeNull();

    expect(await edit(w.entries.opB1, w.techB, 'not mine')).toMatchObject({ permissionError: expect.any(String) });
    expect(await edit(w.entries.commercial2, w.msp, 'not operational')).toMatchObject({ permissionError: expect.any(String) });
    expect((await db('time_entries').where({ tenant: w.tenant, entry_id: w.entries.opB1 }).first()).notes).toBe('operational day 7');
    expect((await db('time_entries').where({ tenant: w.tenant, entry_id: w.entries.commercial2 }).first()).notes).toBe('commercial day 4');
  });

  it('deletes their own entry, and is refused another user\'s entry and any commercial entry', async () => {
    await w.actAs(w.techA);
    const { deleteTimeEntry } = await import('@alga-psa/scheduling/actions/timeEntryCrudActions');
    expect(await deleteTimeEntry(w.entries.opB1)).toMatchObject({ permissionError: expect.any(String) });
    expect(await deleteTimeEntry(w.entries.commercial2)).toMatchObject({ permissionError: expect.any(String) });
    expect(await db('time_entries').where({ tenant: w.tenant }).whereIn('entry_id', [w.entries.opB1, w.entries.commercial2])).toHaveLength(2);

    expect(await deleteTimeEntry(w.entries.opA2)).toBeUndefined();
    expect(await db('time_entries').where({ tenant: w.tenant, entry_id: w.entries.opA2 })).toHaveLength(0);
  });

  it('cannot submit a time sheet: submission is refused by principal, whatever RBAC says', async () => {
    await w.actAs(w.techA);
    const { submitTimeSheet } = await import('@alga-psa/scheduling/actions/timeSheetOperations');
    expect(await submitTimeSheet(w.sheetB)).toMatchObject({ permissionError: expect.any(String) });
    expect((await db('time_sheets').where({ tenant: w.tenant, id: w.sheetB }).first()).approval_status).toBe('DRAFT');
  });
});
