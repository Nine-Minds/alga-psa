import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { timeSheetSearchSchema, timeSheetSearchRowSchema } from '@/lib/api/schemas/timeSheet';

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

async function seedSheet(tenantId: string, userId: string, periodId: string, status: string): Promise<string> {
  const id = uuidv4();
  await tenantTable(tenantId, 'time_sheets').insert({
    tenant: tenantId,
    id,
    user_id: userId,
    period_id: periodId,
    approval_status: status,
  });
  return id;
}

async function seed() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `TS Search Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  const alice = await seedUser(tenantId, 'Alice', 'Zebra');
  const bob = await seedUser(tenantId, 'Bob', 'Quokka');
  const periodId = uuidv4();
  await tenantTable(tenantId, 'time_periods').insert({
    period_id: periodId,
    tenant: tenantId,
    start_date: '2026-01-05',
    end_date: '2026-01-11',
  });
  const aliceDraft = await seedSheet(tenantId, alice, periodId, 'DRAFT');
  const aliceApproved = await seedSheet(tenantId, alice, periodId, 'APPROVED');
  const bobDraft = await seedSheet(tenantId, bob, periodId, 'DRAFT');
  return { tenantId, alice, bob, aliceDraft, aliceApproved, bobDraft };
}

function serviceFor(tenantId: string): TimeSheetService {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

const parse = (input: Record<string, string>) => timeSheetSearchSchema.parse(input);

describe('TimeSheetService.search (real Postgres)', () => {
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

  it('defaults to user_name: does not throw and returns only sheets whose user name matches', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.alice } as any;
    const rows = await serviceFor(f.tenantId).search(parse({ query: 'zebra' }), ctx);
    expect(rows.map((r) => r.id).sort()).toEqual([f.aliceDraft, f.aliceApproved].sort());
    expect(rows.every((r) => r.user_name === 'Alice Zebra')).toBe(true);

    const full = await serviceFor(f.tenantId).search(parse({ query: 'bob quo', fields: 'user_name' }), ctx);
    expect(full.map((r) => r.id)).toEqual([f.bobDraft]);
  });

  it('returns [] when nothing matches', async () => {
    const f = await seed();
    const rows = await serviceFor(f.tenantId).search(parse({ query: 'no-such-person' }), { tenant: f.tenantId, userId: f.alice } as any);
    expect(rows).toEqual([]);
  });

  it('narrows by approval_statuses and user_ids', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.alice } as any;
    const service = serviceFor(f.tenantId);

    const approved = await service.search(parse({ query: ' ', approval_statuses: 'APPROVED' }), ctx);
    expect(approved.map((r) => r.id)).toEqual([f.aliceApproved]);

    const drafts = await service.search(parse({ query: ' ', approval_statuses: 'DRAFT' }), ctx);
    expect(drafts.map((r) => r.id).sort()).toEqual([f.aliceDraft, f.bobDraft].sort());

    const byUser = await service.search(parse({ query: ' ', user_ids: f.bob }), ctx);
    expect(byUser.map((r) => r.id)).toEqual([f.bobDraft]);

    const withDates = await service.search(parse({ query: 'zebra', date_from: '2026-01-01', date_to: '2026-01-31' }), ctx);
    expect(withDates).toHaveLength(2);
    expect(await service.search(parse({ query: 'zebra', date_from: '2026-02-01' }), ctx)).toEqual([]);
    expect(await service.search(parse({ query: 'zebra', date_to: '2026-01-10' }), ctx)).toEqual([]);
  });

  it('every real result row matches the documented response row schema (no drift)', async () => {
    const f = await seed();
    const ctx = { tenant: f.tenantId, userId: f.alice } as any;
    const service = serviceFor(f.tenantId);
    // approve one sheet so nullable timestamp/uuid columns are exercised both ways
    await tenantTable(f.tenantId, 'time_sheets').where({ id: f.aliceApproved }).update({
      submitted_at: db.fn.now(), approved_at: db.fn.now(), approved_by: f.bob,
    });

    for (const include_entries of ['false', 'true']) {
      const rows = await service.search(parse({ query: ' ', include_entries }), ctx);
      expect(rows).toHaveLength(3);
      for (const row of JSON.parse(JSON.stringify(rows))) {
        // strict(): an undocumented extra column in the payload fails, as does a missing documented one
        expect(() => timeSheetSearchRowSchema.strict().parse(row)).not.toThrow();
        expect(Object.keys(row).sort()).toEqual(
          ['tenant', 'id', 'user_id', 'period_id', 'approval_status', 'submitted_at', 'approved_at', 'approved_by', 'notes', 'user_name',
            ...(include_entries === 'true' ? ['time_entries'] : [])].sort(),
        );
      }
    }
  });

  it('does not search other tenants', async () => {
    const f = await seed();
    const other = await seed();
    const rows = await serviceFor(f.tenantId).search(parse({ query: 'zebra' }), { tenant: f.tenantId, userId: f.alice } as any);
    expect(rows.map((r) => r.id)).not.toContain(other.aliceDraft);
  });

  it('rejects non-existent columns in fields at validation', () => {
    expect(timeSheetSearchSchema.safeParse({ query: 'x', fields: 'notes' }).success).toBe(false);
    expect(timeSheetSearchSchema.safeParse({ query: 'x', fields: 'approval_notes' }).success).toBe(false);
  });
});
