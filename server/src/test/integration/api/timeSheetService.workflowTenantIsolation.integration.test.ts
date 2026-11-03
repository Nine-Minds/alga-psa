import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

let db: Knex;
const tenantsToCleanup = new Set<string>();
const tenantTable = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () => tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'time_sheet_comments').del();
  await tenantTable(tenantId, 'time_sheets').del();
  await tenantTable(tenantId, 'time_periods').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

describe('time sheet service workflow tenant isolation (real Postgres)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('a foreign-tenant lifecycle request changes no sheet, entries, or comments', async () => {
    const callerTenant = uuidv4();
    const ownerTenant = uuidv4();
    tenantsToCleanup.add(callerTenant);
    tenantsToCleanup.add(ownerTenant);
    await tenantRows().insert([
      { tenant: callerTenant, client_name: `TS Caller ${callerTenant.slice(0, 8)}`, email: `${callerTenant.slice(0, 8)}@example.com` },
      { tenant: ownerTenant, client_name: `TS Owner ${ownerTenant.slice(0, 8)}`, email: `${ownerTenant.slice(0, 8)}@example.com` },
    ]);

    const callerId = uuidv4();
    const ownerId = uuidv4();
    for (const [tenantId, id] of [[callerTenant, callerId], [ownerTenant, ownerId]]) {
      await tenantTable(tenantId, 'users').insert({
        tenant: tenantId, user_id: id, username: `ts-${id.slice(0, 8)}`, hashed_password: 'not-used',
        user_type: 'internal', email: `${id.slice(0, 8)}@example.com`, first_name: 'Time', last_name: 'Tester',
      });
    }

    const periodId = uuidv4();
    const sheetId = uuidv4();
    await tenantTable(ownerTenant, 'time_periods').insert({
      tenant: ownerTenant, period_id: periodId, start_date: '2026-01-05', end_date: '2026-01-12',
    });
    await tenantTable(ownerTenant, 'time_sheets').insert({
      tenant: ownerTenant, id: sheetId, user_id: ownerId, period_id: periodId, approval_status: 'SUBMITTED',
      submitted_at: db.fn.now(), notes: 'unchanged',
    });
    await tenantTable(ownerTenant, 'time_entries').insert({
      tenant: ownerTenant, entry_id: uuidv4(), user_id: ownerId, time_sheet_id: sheetId,
      start_time: new Date('2026-01-06T10:00:00.000Z'), end_time: new Date('2026-01-06T11:00:00.000Z'),
      work_date: '2026-01-06', work_timezone: 'UTC', approval_status: 'SUBMITTED',
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await tenantTable(ownerTenant, 'time_sheet_comments').insert({
      tenant: ownerTenant, comment_id: uuidv4(), time_sheet_id: sheetId, user_id: ownerId,
      comment: 'existing comment', is_approver: false, created_at: db.fn.now(),
    });

    const service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: callerTenant });
    const beforeSheet = await tenantTable(ownerTenant, 'time_sheets').where({ id: sheetId }).first();
    const beforeEntries = await tenantTable(ownerTenant, 'time_entries').where({ time_sheet_id: sheetId }).select('*');
    const beforeComments = await tenantTable(ownerTenant, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*');

    await expect(runWithTenant(callerTenant, () => service.rejectTimeSheet(sheetId, 'foreign mutation', {
      tenant: callerTenant,
      userId: callerId,
      user: { user_id: callerId, tenant: callerTenant, user_type: 'internal' },
    } as any))).rejects.toMatchObject({ statusCode: 404 });

    expect(await tenantTable(ownerTenant, 'time_sheets').where({ id: sheetId }).first()).toEqual(beforeSheet);
    expect(await tenantTable(ownerTenant, 'time_entries').where({ time_sheet_id: sheetId }).select('*')).toEqual(beforeEntries);
    expect(await tenantTable(ownerTenant, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*')).toEqual(beforeComments);
  });
});
