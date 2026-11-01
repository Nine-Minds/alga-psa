import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async () => (await import('./helpers/spMocks')).publishersMock());
vi.mock('@alga-psa/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { v4 as uuidv4 } from 'uuid';
import { boot, teardown, harness, createHuman, createPrincipal, contextFor, restErrorOf } from './helpers/spHarness';
import { TimeSheetService } from 'server/src/lib/api/services/TimeSheetService';
import { TimeEntryService } from 'server/src/lib/api/services/TimeEntryService';

/**
 * T020: time-sheet approve and time-entry approve.
 * A bare principal -> ACT_AS_REQUIRED. With act-as, `approved_by` is the human and the
 * via column is stamped: time_sheets.approved_via_principal_id for sheets. time_entries
 * has no approved_by/approved_via column (PRD: created_via + updated_via only), so
 * entry approval is stamped on updated_via_principal_id.
 */
beforeAll(async () => {
  await boot('sp_t020_approve');
}, 600_000);
afterAll(teardown);

function sheets() {
  const svc = new TimeSheetService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  // canApproveTimeSheets is a CE stub that returns false; the guard under test sits after it.
  vi.spyOn(svc as never, 'canApproveTimeSheets' as never).mockResolvedValue(true as never);
  return svc;
}
function entries() {
  const svc = new TimeEntryService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}

async function submittedSheet(owner: string): Promise<{ sheetId: string; entryId: string }> {
  const { db, tenant } = harness();
  const scoped = tenantDb(db, tenant);
  const periodId = uuidv4();
  const start = new Date(Date.UTC(2100, 0, 1) + Math.floor(Math.random() * 20000) * 86400000 * 8);
  await scoped.table('time_periods').insert({
    tenant,
    period_id: periodId,
    start_date: start.toISOString().slice(0, 10),
    end_date: new Date(start.getTime() + 7 * 86400000).toISOString().slice(0, 10),
  });
  const sheetId = uuidv4();
  await scoped.table('time_sheets').insert({ tenant, id: sheetId, user_id: owner, period_id: periodId, approval_status: 'SUBMITTED' });
  const entryId = uuidv4();
  await scoped.table('time_entries').insert({
    tenant,
    entry_id: entryId,
    user_id: owner,
    time_sheet_id: sheetId,
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    work_date: start.toISOString().slice(0, 10),
    work_timezone: 'UTC',
    approval_status: 'SUBMITTED',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return { sheetId, entryId };
}

describe('T020 time-sheet approve', () => {
  it('by a bare principal is ACT_AS_REQUIRED and the sheet stays SUBMITTED', async () => {
    const { db, tenant } = harness();
    const owner = await createHuman();
    const { sheetId } = await submittedSheet(owner);
    const context = await contextFor(await createPrincipal({ allowActAs: true }));

    const error = await sheets().approveTimeSheet(sheetId, {} as never, context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });
    const row = await tenantDb(db, tenant).table('time_sheets').where({ id: sheetId }).first();
    expect(row.approval_status).toBe('SUBMITTED');
    expect(row.approved_by).toBeNull();
  });

  it('with act-as sets approved_by to the human and stamps approved_via_principal_id', async () => {
    const { db, tenant } = harness();
    const owner = await createHuman();
    const approver = await createHuman();
    const { sheetId } = await submittedSheet(owner);
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, approver);

    await sheets().approveTimeSheet(sheetId, {} as never, context as never);
    const row = await tenantDb(db, tenant).table('time_sheets').where({ id: sheetId }).first();
    expect(row.approval_status).toBe('APPROVED');
    expect(row.approved_by).toBe(approver);
    expect(row.approved_via_principal_id).toBe(principal.userId);
  });
});

describe('T020 time-entry approve', () => {
  it('by a bare principal is ACT_AS_REQUIRED and the entry stays SUBMITTED', async () => {
    const { db, tenant } = harness();
    const owner = await createHuman();
    const { entryId } = await submittedSheet(owner);
    const context = await contextFor(await createPrincipal({ allowActAs: true }));

    const error = await entries().approveTimeEntries({ entry_ids: [entryId] } as never, context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });
    const row = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(row.approval_status).toBe('SUBMITTED');
  });

  it('with act-as approves and stamps the via column; the approver is the human', async () => {
    const { db, tenant } = harness();
    const owner = await createHuman();
    const approver = await createHuman();
    const { entryId } = await submittedSheet(owner);
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, approver);
    expect(context.userId).toBe(approver);

    const result = await entries().approveTimeEntries({ entry_ids: [entryId] } as never, context as never);
    expect(JSON.stringify(result)).toContain('true');
    const row = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(row.approval_status).toBe('APPROVED');
    expect(row.updated_via_principal_id).toBe(principal.userId);
  });
});
