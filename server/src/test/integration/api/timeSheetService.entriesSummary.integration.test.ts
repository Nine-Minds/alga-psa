import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { timeSheetSearchSchema, timeSheetSearchRowSchema, timeSheetEntryRowSchema, timeSheetSummaryResponseSchema } from '@/lib/api/schemas/timeSheet';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tenantTable = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'time_sheets').del();
  await tenantTable(tenantId, 'time_periods').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function seedUser(tenantId: string, first: string, last: string): Promise<string> {
  const userId = uuidv4();
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `ts-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    user_type: 'internal',
    email: `${userId.slice(0, 8)}@example.com`,
    first_name: first,
    last_name: last,
  });
  return userId;
}

async function seed() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `TS Entries Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  const userId = await seedUser(tenantId, 'Erin', 'Entries');
  const periodId = uuidv4();
  await tenantTable(tenantId, 'time_periods').insert({
    period_id: periodId, tenant: tenantId, start_date: '2026-10-12', end_date: '2026-10-19',
  });
  const sheetId = uuidv4();
  await tenantTable(tenantId, 'time_sheets').insert({
    tenant: tenantId, id: sheetId, user_id: userId, period_id: periodId, approval_status: 'DRAFT',
  });
  const entry = (type: string, workDate: string, start: string | null, end: string, billable: number, notes: string | null) =>
    tenantTable(tenantId, 'time_entries').insert({
      tenant: tenantId,
      entry_id: uuidv4(),
      user_id: userId,
      time_sheet_id: sheetId,
      work_item_type: type,
      work_date: workDate,
      work_timezone: 'America/New_York',
      start_time: start,
      end_time: end,
      billable_duration: billable,
      approval_status: 'DRAFT',
      notes,
    });
  // 60 min ad_hoc, not billable (Mon)
  await entry('ad_hoc', '2026-10-12', '2026-10-12T13:00:00Z', '2026-10-12T14:00:00Z', 0, null);
  // 120 min interaction, fully billable (Mon)
  await entry('interaction', '2026-10-12', '2026-10-12T15:00:00Z', '2026-10-12T17:00:00Z', 120, 'client call');
  // 105 min ad_hoc, partially billable 45 (Tue)
  await entry('ad_hoc', '2026-10-13', '2026-10-13T13:00:00Z', '2026-10-13T14:45:00Z', 45, 'mixed');
  // NULL start_time with a billable_duration: worked time is 0, so the summary clamps its
  // billable minutes to 0 (billable must never exceed worked)
  await entry('ad_hoc', '2026-10-13', null, '2026-10-13T16:00:00Z', 30, 'no start');
  return { tenantId, userId, sheetId };
}

function serviceFor(tenantId: string): TimeSheetService {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

describe('TimeSheetService entries + summary (real Postgres)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('getTimeSheetEntries rows strict-parse against timeSheetEntryRowSchema after JSON round-trip', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.userId } as any;
    const rows = JSON.parse(JSON.stringify(await serviceFor(f.tenantId).getTimeSheetEntries(f.sheetId, ctx)));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(() => timeSheetEntryRowSchema.strict().parse(row)).not.toThrow();
    }
    expect(rows.map((r: any) => r.work_date)).toEqual(['2026-10-12', '2026-10-12', '2026-10-13', '2026-10-13']);
  });

  it('search include_entries=true returns time_entries rows that strict-parse', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.userId } as any;
    const rows = JSON.parse(JSON.stringify(
      await serviceFor(f.tenantId).search(timeSheetSearchSchema.parse({ query: 'erin', include_entries: 'true' }), ctx),
    ));
    expect(rows).toHaveLength(1);
    expect(() => timeSheetSearchRowSchema.strict().parse(rows[0])).not.toThrow();
    expect(rows[0].time_entries).toHaveLength(4);
    for (const entry of rows[0].time_entries) {
      expect(() => timeSheetEntryRowSchema.strict().parse(entry)).not.toThrow();
    }
  });

  it('getTimeSheetSummary reports worked vs billable hours with computed breakdowns', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.userId } as any;
    const summary = await serviceFor(f.tenantId).getTimeSheetSummary(f.sheetId, ctx);
    expect(() => timeSheetSummaryResponseSchema.strict().parse(summary)).not.toThrow();
    // worked 60 + 120 + 105 + 0 (NULL start) = 285 min; billable 0 + 120 + 45 + LEAST(30, 0) = 165 min
    expect(summary.total_hours).toBeCloseTo(4.75, 6);
    expect(summary.billable_hours).toBeCloseTo(2.75, 6);
    expect(summary.non_billable_hours).toBeCloseTo(2.0, 6);
    expect(summary.non_billable_hours).toBeGreaterThan(0);
    expect(summary.billable_hours).toBeLessThanOrEqual(summary.total_hours);
    expect(Object.keys(summary.entries_by_type).sort()).toEqual(['ad_hoc', 'interaction']);
    expect(summary.entries_by_type.ad_hoc).toBeCloseTo(2.75, 6);
    expect(summary.entries_by_type.interaction).toBeCloseTo(2, 6);
    expect(Object.keys(summary.entries_by_day).sort()).toEqual(['2026-10-12', '2026-10-13']);
    expect(summary.entries_by_day['2026-10-12']).toBeCloseTo(3, 6);
    expect(summary.entries_by_day['2026-10-13']).toBeCloseTo(1.75, 6);
    expect(summary.approval_ready).toBe(true);
  });
});
