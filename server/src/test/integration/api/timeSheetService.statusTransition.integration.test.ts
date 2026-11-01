import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { ConflictError, ForbiddenError } from '@/lib/api/middleware/apiMiddleware';

/**
 * alga-2026-0003017: time_sheets.approval_status is derived state. PUT /api/v1/time-sheets/:id is a thin wrapper
 * over TimeSheetService.update, so these drive the service against real Postgres. Every status change must run the
 * transition table in services/timeSheetStatus.ts (capability + from-state + side effects).
 */

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// RBAC itself is not under test; the permissions each actor holds are set per test.
const grants = vi.hoisted(() => ({ byUser: new Map<string, Set<string>>() }));
vi.mock('server/src/lib/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grants.byUser.get(user.user_id)?.has(`${resource}:${action}`) ?? false),
}));

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tenantTable = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  await tenantTable(tenantId, 'time_sheet_comments').del();
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'time_sheets').del();
  await tenantTable(tenantId, 'time_periods').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function seedUser(tenantId: string, first: string): Promise<string> {
  const userId = uuidv4();
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `ts-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    user_type: 'internal',
    email: `${userId.slice(0, 8)}@example.com`,
    first_name: first,
    last_name: 'Tester',
  });
  return userId;
}

async function seed() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `TS Status Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  const owner = await seedUser(tenantId, 'Owner');
  const approver = await seedUser(tenantId, 'Approver');
  const other = await seedUser(tenantId, 'Other');
  const periodId = uuidv4();
  await tenantTable(tenantId, 'time_periods').insert({
    period_id: periodId,
    tenant: tenantId,
    start_date: '2026-01-05',
    end_date: '2026-01-12',
  });
  grants.byUser.set(owner, new Set(['time_sheet:update']));
  grants.byUser.set(other, new Set(['time_sheet:update']));
  grants.byUser.set(approver, new Set(['time_sheet:update', 'time_sheet:approve']));
  return { tenantId, owner, approver, other, periodId };
}

async function seedSheet(
  f: { tenantId: string; periodId: string },
  userId: string,
  status: string,
  opts: { entries?: number; notes?: string } = {}
) {
  const id = uuidv4();
  await tenantTable(f.tenantId, 'time_sheets').insert({
    tenant: f.tenantId,
    id,
    user_id: userId,
    period_id: f.periodId,
    approval_status: status,
    notes: opts.notes ?? null,
  });
  const entryIds: string[] = [];
  for (let i = 0; i < (opts.entries ?? 1); i++) {
    const entryId = uuidv4();
    entryIds.push(entryId);
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId,
      entry_id: entryId,
      user_id: userId,
      time_sheet_id: id,
      start_time: '2026-01-05T09:00:00Z',
      end_time: '2026-01-05T10:00:00Z',
      work_date: '2026-01-05',
      work_timezone: 'UTC',
      approval_status: status === 'DRAFT' ? 'DRAFT' : 'SUBMITTED',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }
  return { id, entryIds };
}

const sheetRow = (tenantId: string, id: string) => tenantTable(tenantId, 'time_sheets').where({ id }).first();
const entryRows = (tenantId: string, id: string) =>
  tenantTable(tenantId, 'time_entries').where({ time_sheet_id: id }).orderBy('entry_id').select('*');

function serviceFor(tenantId: string): TimeSheetService {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

const contextFor = (tenantId: string, userId: string) =>
  ({ tenant: tenantId, userId, user: { user_id: userId, tenant: tenantId, user_type: 'internal' } }) as any;

describe('TimeSheetService.update approval_status is a requested transition (real Postgres)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterEach(async () => {
    grants.byUser.clear();
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('1. an owner without time_sheet:approve cannot approve their own DRAFT sheet via update (403, nothing touched)', async () => {
    const f = await seed();
    const sheet = await seedSheet(f, f.owner, 'DRAFT');
    const before = { sheet: await sheetRow(f.tenantId, sheet.id), entries: await entryRows(f.tenantId, sheet.id) };

    await expect(
      serviceFor(f.tenantId).update(sheet.id, { approval_status: 'APPROVED' }, contextFor(f.tenantId, f.owner))
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await sheetRow(f.tenantId, sheet.id)).toEqual(before.sheet);
    expect(await entryRows(f.tenantId, sheet.id)).toEqual(before.entries);
  });

  it('2. an approver updating a SUBMITTED sheet to APPROVED yields exactly the state the approve verb produces', async () => {
    const f = await seed();
    const viaUpdate = await seedSheet(f, f.owner, 'SUBMITTED', { entries: 2 });
    const viaVerb = await seedSheet(f, f.owner, 'SUBMITTED', { entries: 2 });
    const svc = serviceFor(f.tenantId);
    const ctx = contextFor(f.tenantId, f.approver);

    await svc.update(viaUpdate.id, { approval_status: 'APPROVED' }, ctx);
    await svc.approveTimeSheet(viaVerb.id, {} as any, ctx);

    const normSheet = (r: any, id: string) => {
      const { id: _id, approved_at, ...rest } = r;
      expect(approved_at).toBeInstanceOf(Date);
      expect(r.id).toBe(id);
      return rest;
    };
    const normEntries = (rows: any[]) =>
      rows.map(({ entry_id, time_sheet_id, updated_at, created_at, ...rest }) => rest);

    const a = await sheetRow(f.tenantId, viaUpdate.id);
    const b = await sheetRow(f.tenantId, viaVerb.id);
    expect(a.approval_status).toBe('APPROVED');
    expect(a.approved_by).toBe(f.approver);
    expect(normSheet(a, viaUpdate.id)).toEqual(normSheet(b, viaVerb.id));
    const ea = await entryRows(f.tenantId, viaUpdate.id);
    expect(ea.every((e) => e.approval_status === 'APPROVED')).toBe(true);
    expect(normEntries(ea)).toEqual(normEntries(await entryRows(f.tenantId, viaVerb.id)));
  });

  it('3. an owner submits their own DRAFT sheet with entries (submitted_at set); the same request on another user\'s sheet is 403', async () => {
    const f = await seed();
    const mine = await seedSheet(f, f.owner, 'DRAFT');
    const theirs = await seedSheet(f, f.other, 'DRAFT');
    const svc = serviceFor(f.tenantId);

    const updated = await svc.update(mine.id, { approval_status: 'SUBMITTED' }, contextFor(f.tenantId, f.owner));
    expect(updated.approval_status).toBe('SUBMITTED');
    expect((await sheetRow(f.tenantId, mine.id)).submitted_at).toBeInstanceOf(Date);

    // owner holds time_sheet:update only; another user's sheet is outside the submit-own capability.
    grants.byUser.get(f.owner)!.add('time_sheet:approve');
    await expect(
      svc.update(theirs.id, { approval_status: 'SUBMITTED' }, contextFor(f.tenantId, f.owner))
    ).rejects.toBeInstanceOf(ForbiddenError);
    const row = await sheetRow(f.tenantId, theirs.id);
    expect(row.approval_status).toBe('DRAFT');
    expect(row.submitted_at).toBeNull();
  });

  it('4. supplying the current status is a no-op', async () => {
    const f = await seed();
    const sheet = await seedSheet(f, f.owner, 'DRAFT');
    const before = await sheetRow(f.tenantId, sheet.id);

    const updated = await serviceFor(f.tenantId).update(
      sheet.id,
      { approval_status: 'DRAFT' },
      contextFor(f.tenantId, f.owner)
    );

    expect(updated.approval_status).toBe('DRAFT');
    expect(await sheetRow(f.tenantId, sheet.id)).toEqual(before);
  });

  it('5. a refused transition rolls back the other fields written in the same request', async () => {
    const f = await seed();
    const sheet = await seedSheet(f, f.owner, 'DRAFT', { notes: 'original' });

    await expect(
      serviceFor(f.tenantId).update(
        sheet.id,
        { notes: 'changed', approval_status: 'APPROVED' },
        contextFor(f.tenantId, f.owner)
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await sheetRow(f.tenantId, sheet.id);
    expect(row.notes).toBe('original');
    expect(row.approval_status).toBe('DRAFT');
  });

  it('6. APPROVED from CHANGES_REQUESTED is 409, and so is re-opening to DRAFT', async () => {
    const f = await seed();
    const sheet = await seedSheet(f, f.owner, 'CHANGES_REQUESTED');
    const svc = serviceFor(f.tenantId);

    await expect(
      svc.update(sheet.id, { approval_status: 'APPROVED' }, contextFor(f.tenantId, f.approver))
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      svc.update(sheet.id, { approval_status: 'DRAFT' }, contextFor(f.tenantId, f.approver))
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await sheetRow(f.tenantId, sheet.id)).approval_status).toBe('CHANGES_REQUESTED');
  });
});
