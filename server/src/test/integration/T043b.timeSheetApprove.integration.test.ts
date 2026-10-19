import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createServiceUser } from '../../../test-utils/serviceUserFixtures';
import { HumanWorkOwnerRequiredError } from '../../../../shared/lib/humanWork/HumanWorkOwnerRequiredError';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// T043 (F056): TimeSheetService.approveTimeSheet end to end against the real schema.
describe('T043 TimeSheetService.approveTimeSheet (F056)', () => {
  let db: Knex;
  let tenant: string;
  let internalId: string;
  let serviceUserId: string;
  const created: { sheets: string[]; entries: string[]; periods: string[] } = { sheets: [], entries: [], periods: [] };

  function approverService(userId: string) {
    const svc = new TimeSheetService();
    vi.spyOn(svc as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    // canApproveTimeSheets is a stub that always returns false in CE ("Simplified for now");
    // stub it so the update path under test is reachable.
    vi.spyOn(svc as any, 'canApproveTimeSheets').mockResolvedValue(true);
    return { svc, context: { tenant, userId } as any };
  }

  async function submittedSheet(): Promise<{ sheetId: string; entryId: string }> {
    const periodId = uuidv4();
    const day = Math.floor(Math.random() * 20000);
    const start = new Date(Date.UTC(2100, 0, 1) + day * 86400000 * 8);
    const end = new Date(start.getTime() + 7 * 86400000);
    await tenantDb(db, tenant).table('time_periods').insert({
      tenant,
      period_id: periodId,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    });
    created.periods.push(periodId);
    const sheetId = uuidv4();
    await tenantDb(db, tenant).table('time_sheets').insert({
      tenant,
      id: sheetId,
      user_id: internalId,
      period_id: periodId,
      approval_status: 'SUBMITTED',
    });
    created.sheets.push(sheetId);
    const entryId = uuidv4();
    await tenantDb(db, tenant).table('time_entries').insert({
      tenant,
      entry_id: entryId,
      user_id: internalId,
      time_sheet_id: sheetId,
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      work_date: start.toISOString().slice(0, 10),
      work_timezone: 'UTC',
      approval_status: 'SUBMITTED',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    created.entries.push(entryId);
    return { sheetId, entryId };
  }

  beforeAll(async () => {
    db = await createTestDbConnection();
    const discovery = tenantDb(db, '__test_discovery__');
    const q = discovery.unscoped('users as u', 'T043b discovery of seeded internal user');
    const row = await q.where('u.user_type', 'internal').select('u.tenant', 'u.user_id').first();
    tenant = row.tenant;
    internalId = row.user_id;
    serviceUserId = (await createServiceUser(db, tenant)).userId;
  });

  afterAll(async () => {
    const t = tenantDb(db, tenant);
    if (created.entries.length) await t.table('time_entries').whereIn('entry_id', created.entries).delete();
    if (created.sheets.length) {
      await t.table('time_sheet_comments').whereIn('time_sheet_id', created.sheets).delete();
      await t.table('time_sheets').whereIn('id', created.sheets).delete();
    }
    if (created.periods.length) await t.table('time_periods').whereIn('period_id', created.periods).delete();
    await t.table('users').where({ user_id: serviceUserId }).delete();
    await db.destroy();
  });

  it('time_entries has no approved_at/approved_by columns; time_sheets has them', async () => {
    const cols = await db
      .raw("select table_name, column_name from information_schema.columns where table_name in ('time_entries','time_sheets') and column_name in ('approved_at','approved_by')");
    const have = new Set(cols.rows.map((r: any) => `${r.table_name}.${r.column_name}`));
    expect(have.has('time_sheets.approved_at')).toBe(true);
    expect(have.has('time_sheets.approved_by')).toBe(true);
    expect(have.has('time_entries.approved_at')).toBe(false);
    expect(have.has('time_entries.approved_by')).toBe(false);
  });

  it('an internal approver approves the sheet and its entries', async () => {
    const { sheetId, entryId } = await submittedSheet();
    const { svc, context } = approverService(internalId);
    await svc.approveTimeSheet(sheetId, { approval_notes: 'ok' } as any, context);

    const sheet = await tenantDb(db, tenant).table('time_sheets').where({ id: sheetId }).first();
    expect(sheet.approval_status).toBe('APPROVED');
    expect(sheet.approved_by).toBe(internalId);
    const entry = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(entry.approval_status).toBe('APPROVED');
    const comment = await tenantDb(db, tenant).table('time_sheet_comments').where({ time_sheet_id: sheetId }).first();
    expect(comment.comment).toBe('ok');
    expect(comment.is_approver).toBe(true);
  });

  it('a service-user approver is refused (HumanWorkOwnerRequiredError approved_by) and nothing changes', async () => {
    const { sheetId, entryId } = await submittedSheet();
    const { svc, context } = approverService(serviceUserId);
    await expect(svc.approveTimeSheet(sheetId, {} as any, context)).rejects.toBeInstanceOf(HumanWorkOwnerRequiredError);
    const sheet = await tenantDb(db, tenant).table('time_sheets').where({ id: sheetId }).first();
    expect(sheet.approval_status).toBe('SUBMITTED');
    const entry = await tenantDb(db, tenant).table('time_entries').where({ entry_id: entryId }).first();
    expect(entry.approval_status).toBe('SUBMITTED');
  });
});
