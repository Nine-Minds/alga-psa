import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex as knexFactory, type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { runWithTenant, tenantDb } from '@alga-psa/db';
import * as bundleService from '@alga-psa/authorization/bundles/service';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { ConflictError, ForbiddenError } from '@/lib/api/middleware/apiMiddleware';
import { publishUnregisteredEventType } from 'server/src/lib/eventBus/publishers';
import { updateTimeSheetSchema } from '@/lib/api/schemas/timeSheet';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import * as usersActions from '@alga-psa/users/actions';
import { runWithApiKeyUser } from '@alga-psa/auth';
import * as algaDb from '@alga-psa/db';
import * as apiDb from '@/lib/db/db';
import { ApiBaseController } from '@/lib/api/controllers/ApiBaseController';
import { POST as reverseApprovalRoute } from '@/app/api/v1/time-sheets/[id]/reverse-approval/route';
import { POST as bulkApprovalRoute } from '@/app/api/v1/time-sheets/bulk/route';
import { POST as rejectTimeSheetRoute } from '@/app/api/v1/time-sheets/[id]/reject/route';
import { reverseTimeSheetApproval } from '@alga-psa/scheduling/actions/timeSheetActions';

/**
 * REST `POST /api/v1/time-sheets` and `PUT /api/v1/time-sheets/:id` are thin wrappers over
 * TimeSheetService.create/update, so this drives the service against real Postgres (the same
 * pattern as timeSheetService.search). time_sheets has no created_at / updated_at columns, so
 * writing them used to fail every create and update.
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
const grants = vi.hoisted(() => ({
  byUser: new Map<string, Set<string>>(),
  has: async (user: { user_id: string }, resource: string, action: string) =>
    grants.byUser.get(user.user_id)?.has(`${resource}:${action}`) ?? false,
}));
const approvalBundleRules = vi.hoisted(() => ({ rules: [] as Array<Record<string, unknown>> }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grants.has(user, resource, action)),
}));
vi.mock('@/lib/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grants.has(user, resource, action)),
}));
// The shared self-approval policy resolves RBAC through @alga-psa/authorization's own
// copy, so point it at the same fixture.
vi.mock('@alga-psa/authorization/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grants.has(user, resource, action)),
}));
let db: Knex;
const tenantsToCleanup = new Set<string>();
let routeTenantId = '';

const tenantTable = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  await tenantTable(tenantId, 'invoice_time_entries').del();
  await tenantTable(tenantId, 'invoices').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'time_entries').del();
  await tenantTable(tenantId, 'time_sheet_comments').del();
  await tenantTable(tenantId, 'time_sheets').del();
  await tenantTable(tenantId, 'time_periods').del();
  await tenantTable(tenantId, 'team_members').del();
  await tenantTable(tenantId, 'teams').del();
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
    client_name: `TS Create Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  const actor = await seedUser(tenantId, 'Actor');
  const subject = await seedUser(tenantId, 'Subject');
  const periodId = uuidv4();
  await tenantTable(tenantId, 'time_periods').insert({
    period_id: periodId,
    tenant: tenantId,
    start_date: '2026-01-05',
    end_date: '2026-01-12',
  });
  return { tenantId, actor, subject, periodId };
}

function serviceFor(tenantId: string): TimeSheetService {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

const contextFor = (tenantId: string, userId: string) =>
  ({ tenant: tenantId, userId, user: { user_id: userId, tenant: tenantId, user_type: 'internal' } }) as any;

const sheetsFor = (tenantId: string, userId: string) =>
  tenantTable(tenantId, 'time_sheets').where({ user_id: userId }).select('*');

function configureRouteBoundary(tenantId: string, actorId: string) {
  routeTenantId = tenantId;
  vi.spyOn(ApiKeyServiceForApi, 'validateApiKeyForTenant').mockResolvedValue({
    api_key_id: 'route-test-key', user_id: actorId, tenant: tenantId,
  } as any);
  vi.spyOn(usersActions, 'findUserByIdForApi').mockResolvedValue({
    user_id: actorId, tenant: tenantId, user_type: 'internal',
  } as any);
  vi.spyOn(apiDb, 'getConnection').mockResolvedValue(db as any);
  vi.spyOn(TimeSheetService.prototype as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  vi.spyOn(ApiBaseController.prototype as any, 'assertProductApiAccess').mockResolvedValue(undefined);
}

async function postRoute(route: (request: Request, ...args: any[]) => Promise<Response>, path: string, body: unknown) {
  return route(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'route-test-api-key', 'x-tenant-id': routeTenantId },
    body: JSON.stringify(body),
  }), ...(path.includes('/reverse-approval') || path.includes('/reject') ? [{ params: Promise.resolve({ id: path.split('/').at(-2)! }) }] : []));
}

async function postRawRoute(route: (request: Request, ...args: any[]) => Promise<Response>, path: string, body: string) {
  return route(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'route-test-api-key', 'x-tenant-id': routeTenantId },
    body,
  }), [{ params: Promise.resolve({ id: path.split('/').at(-2)! }) }]);
}

describe('TimeSheetService.create / update (real Postgres)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  beforeEach(() => {
    // Keep the actual delegation helper and authorization kernel, while making the
    // policy fixture deterministic instead of depending on seeded bundle assignments.
    vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation')
      .mockImplementation(async () => approvalBundleRules.rules as any);
  });

  afterEach(async () => {
    vi.mocked(publishUnregisteredEventType).mockClear();
    grants.byUser.clear();
    approvalBundleRules.rules = [];
    vi.restoreAllMocks();
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('POST creates and persists a sheet for the caller; no timestamp columns are written', async () => {
    const f = await seed();
    const created = await serviceFor(f.tenantId).create({ period_id: f.periodId }, contextFor(f.tenantId, f.actor));

    expect(created).toMatchObject({ user_id: f.actor, period_id: f.periodId, approval_status: 'DRAFT' });
    expect(created).not.toHaveProperty('created_at');
    expect(created).not.toHaveProperty('updated_at');
    const rows = await sheetsFor(f.tenantId, f.actor);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
  });

  it('generic PUT only updates notes and rejects lifecycle fields', async () => {
    const f = await seed();
    const service = serviceFor(f.tenantId);
    const ctx = contextFor(f.tenantId, f.actor);
    const created = await service.create({ period_id: f.periodId }, ctx);

    const updated = await service.update(created.id, { notes: 'updated' }, ctx);

    expect(updated).toMatchObject({ id: created.id, approval_status: 'DRAFT', notes: 'updated' });
    expect(() => updateTimeSheetSchema.parse({ approval_status: 'APPROVED' })).toThrow();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: created.id,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'DRAFT', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await tenantTable(f.tenantId, 'time_sheet_comments').insert({
      tenant: f.tenantId, comment_id: uuidv4(), time_sheet_id: created.id, user_id: f.actor,
      comment: 'existing', is_approver: false, created_at: db.fn.now(),
    });
    const beforeSheet = await tenantTable(f.tenantId, 'time_sheets').where({ id: created.id }).first();
    const beforeEntries = await tenantTable(f.tenantId, 'time_entries').where({ time_sheet_id: created.id }).select('*');
    const beforeComments = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: created.id }).select('*');

    await expect(service.update(created.id, { approval_status: 'APPROVED' } as any, ctx))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: created.id }).first()).toEqual(beforeSheet);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ time_sheet_id: created.id }).select('*')).toEqual(beforeEntries);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: created.id }).select('*')).toEqual(beforeComments);
  });

  it('scopes reads before list retrieval and by-id lookup; read_all widens only within the tenant', async () => {
    const f = await seed();
    const otherTenant = await seed();
    const service = serviceFor(f.tenantId);
    const own = await service.create({ period_id: f.periodId }, contextFor(f.tenantId, f.actor));
    const other = await service.create({ period_id: f.periodId, user_id: f.subject }, contextFor(f.tenantId, f.subject));
    const ctx = contextFor(f.tenantId, f.actor);
    const foreignSheet = await serviceFor(otherTenant.tenantId).create(
      { period_id: otherTenant.periodId }, contextFor(otherTenant.tenantId, otherTenant.actor)
    );
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.subject, time_sheet_id: other.id,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'DRAFT', created_at: db.fn.now(), updated_at: db.fn.now(),
    });

    expect(await service.getById(other.id, ctx)).toBeNull();
    expect(await service.getById(foreignSheet.id, ctx)).toBeNull();
    expect((await service.list({ page: 1, limit: 25 } as any, ctx)).data.map((sheet: any) => sheet.id)).toEqual([own.id]);
    expect((await service.list({ page: 1, limit: 25, filters: { user_id: f.subject } } as any, ctx)).data).toEqual([]);
    expect(await service.search({ query: 'Subject', user_ids: [f.subject] } as any, ctx)).toEqual([]);
    expect(await service.getWithDetails(other.id, ctx)).toBeNull();
    expect(await service.getTimeSheetEntries(other.id, ctx)).toEqual([]);
    expect(await service.getTimeSheetSummary(other.id, ctx)).toBeNull();
    expect(await service.getTimeSheetComments(other.id, ctx)).toEqual([]);

    await tenantTable(f.tenantId, 'users').where({ user_id: f.subject }).update({ reports_to: f.actor });
    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    expect((await service.list({ page: 1, limit: 25 } as any, ctx)).data.map((sheet: any) => sheet.id).sort()).toEqual([own.id, other.id].sort());

    grants.byUser.set(f.actor, new Set(['time_sheet:read_all']));
    expect((await service.list({ page: 1, limit: 25 } as any, ctx)).data.map((sheet: any) => sheet.id).sort()).toEqual([own.id, other.id].sort());
    expect(await service.getById(other.id, ctx)).toMatchObject({ id: other.id, user_id: f.subject });
    expect(await service.getById(foreignSheet.id, ctx)).toBeNull();
  });

  it('lifecycle transitions require their own permission and atomically synchronize entries', async () => {
    const f = await seed();
    const service = serviceFor(f.tenantId);
    const ctx = contextFor(f.tenantId, f.actor);
    const sheet = await service.create({ period_id: f.periodId }, ctx);
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: sheet.id,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'DRAFT', created_at: db.fn.now(), updated_at: db.fn.now(),
    });

    grants.byUser.set(f.actor, new Set(['time_sheet:update']));
    await expect(runWithTenant(f.tenantId, () => service.approveTimeSheet(sheet.id, {}, ctx))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await tenantTable(f.tenantId, 'time_sheets').where({ id: sheet.id }).first()).approval_status).toBe('DRAFT');
    expect((await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).approval_status).toBe('DRAFT');

    grants.byUser.set(f.actor, new Set(['time_sheet:submit']));
    await service.submitTimeSheet(sheet.id, {}, ctx);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheet.id }).first()).toMatchObject({ approval_status: 'SUBMITTED' });
    expect((await tenantTable(f.tenantId, 'time_sheets').where({ id: sheet.id }).first()).submitted_at).not.toBeNull();
    expect((await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).approval_status).toBe('SUBMITTED');

    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    const submittedSheetBeforeApproval = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheet.id }).first();
    const submittedEntryBeforeApproval = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first();
    const submittedCommentsBeforeApproval = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheet.id }).select('*');
    await expect(runWithTenant(f.tenantId, () => service.approveTimeSheet(sheet.id, { approval_notes: 'cannot self approve' }, ctx)))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheet.id }).first()).toEqual(submittedSheetBeforeApproval);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toEqual(submittedEntryBeforeApproval);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheet.id }).select('*')).toEqual(submittedCommentsBeforeApproval);
  });

  it('enforces approval bundle rules through REST single and bulk approval without partial writes', async () => {
    const f = await seed();
    const coApprover = await seedUser(f.tenantId, 'SecondApprover');
    const service = serviceFor(f.tenantId);
    const ctx = contextFor(f.tenantId, f.actor);
    const makeSubmittedSheet = async () => {
      const periodId = uuidv4();
      await tenantTable(f.tenantId, 'time_periods').insert({
        period_id: periodId, tenant: f.tenantId, start_date: '2026-02-02', end_date: '2026-02-09',
      });
      const sheet = await service.create({ period_id: periodId }, ctx);
      const entryId = uuidv4();
      await tenantTable(f.tenantId, 'time_entries').insert({
        tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: sheet.id,
        start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
        work_timezone: 'UTC', approval_status: 'DRAFT', created_at: db.fn.now(), updated_at: db.fn.now(),
      });
      grants.byUser.set(f.actor, new Set(['time_sheet:submit']));
      await service.submitTimeSheet(sheet.id, { submission_notes: 'Submitted for review' } as any, ctx);
      return { sheetId: sheet.id, entryId };
    };

    const single = await makeSubmittedSheet();
    const bulk = await makeSubmittedSheet();
    const permittedSingle = await makeSubmittedSheet();
    const permittedBulk = await makeSubmittedSheet();
    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    const selfApprovalIds = [single.sheetId, bulk.sheetId, permittedSingle.sheetId, permittedBulk.sheetId];
    const commentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments')
      .whereIn('time_sheet_id', selfApprovalIds).orderBy('comment_id').select('*');
    const metadataBefore = await tenantTable(f.tenantId, 'time_sheets')
      .whereIn('id', selfApprovalIds).orderBy('id').select('*');
    const entriesBefore = await tenantTable(f.tenantId, 'time_entries')
      .whereIn('time_sheet_id', selfApprovalIds).orderBy('entry_id').select('*');

    const permittedCommentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments')
      .whereIn('time_sheet_id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('comment_id').select('*');
    const permittedMetadataBefore = await tenantTable(f.tenantId, 'time_sheets')
      .whereIn('id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('id').select('*');
    const permittedEntriesBefore = await tenantTable(f.tenantId, 'time_entries')
      .whereIn('time_sheet_id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('entry_id').select('*');

    approvalBundleRules.rules = [{
      resource: 'time_entry', action: 'approve', constraintKey: 'not_self_approver',
    }];
    await expect(runWithTenant(f.tenantId, () => service.approveTimeSheet(single.sheetId, { approval_notes: 'should not persist' }, ctx)))
      .rejects.toBeInstanceOf(ForbiddenError);
    const bulkResult = await runWithTenant(f.tenantId, () => service.bulkApprove({ time_sheet_ids: [bulk.sheetId], approval_notes: 'should not persist' } as any, ctx));
    expect(bulkResult).toHaveLength(1);
    expect(bulkResult[0]).toMatchObject({ success: false, time_sheet_id: bulk.sheetId });

    expect(await tenantTable(f.tenantId, 'time_sheets').whereIn('id', selfApprovalIds).orderBy('id').select('*'))
      .toEqual(metadataBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').whereIn('time_sheet_id', selfApprovalIds).orderBy('entry_id').select('*'))
      .toEqual(entriesBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').whereIn('time_sheet_id', selfApprovalIds).orderBy('comment_id').select('*'))
      .toEqual(commentsBefore);

    // Self approval remains denied with or without bundle or sole-approver restrictions.
    approvalBundleRules.rules = [];
    grants.byUser.set(coApprover, new Set(['time_sheet:approve']));
    await expect(runWithTenant(f.tenantId, () => service.approveTimeSheet(permittedSingle.sheetId, { approval_notes: 'should not persist' }, ctx)))
      .rejects.toBeInstanceOf(ForbiddenError);
    const deniedBulkResult = await runWithTenant(f.tenantId, () => service.bulkApprove(
      { time_sheet_ids: [permittedBulk.sheetId], approval_notes: 'should not persist' } as any, ctx
    ));
    expect(deniedBulkResult).toHaveLength(1);
    expect(deniedBulkResult[0]).toMatchObject({
      success: false,
      time_sheet_id: permittedBulk.sheetId,
      error: 'Permission denied: Cannot act on this time sheet',
    });

    expect(await tenantTable(f.tenantId, 'time_sheets').whereIn('id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('id').select('*'))
      .toEqual(permittedMetadataBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').whereIn('time_sheet_id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('entry_id').select('*'))
      .toEqual(permittedEntriesBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').whereIn('time_sheet_id', [permittedSingle.sheetId, permittedBulk.sheetId]).orderBy('comment_id').select('*'))
      .toEqual(permittedCommentsBefore);

    // Removing co-approver grants does not create a sole-approver self-approval exception.
    grants.byUser.delete(coApprover);
    await expect(runWithTenant(f.tenantId, () => service.approveTimeSheet(permittedSingle.sheetId, { approval_notes: 'approved' }, ctx)))
      .rejects.toBeInstanceOf(ForbiddenError);
    const permittedBulkResult = await runWithTenant(f.tenantId, () => service.bulkApprove(
      { time_sheet_ids: [permittedBulk.sheetId], approval_notes: 'bulk approved' } as any, ctx
    ));
    expect(permittedBulkResult[0]).toMatchObject({ success: false, time_sheet_id: permittedBulk.sheetId });
    for (const { sheetId } of [permittedSingle, permittedBulk]) {
      expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toMatchObject({ approval_status: 'SUBMITTED', approved_by: null, approved_at: null });
      expect(await tenantTable(f.tenantId, 'time_entries').where({ time_sheet_id: sheetId }).first()).toMatchObject({ approval_status: 'SUBMITTED' });
      expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId })).toHaveLength(1);
    }
    expect(await tenantTable(f.tenantId, 'time_sheets').whereIn('id', selfApprovalIds).orderBy('id').select('*')).toEqual(metadataBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').whereIn('time_sheet_id', selfApprovalIds).orderBy('entry_id').select('*')).toEqual(entriesBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').whereIn('time_sheet_id', selfApprovalIds).orderBy('comment_id').select('*')).toEqual(commentsBefore);
  });

  it('creating a sheet for yourself by explicit user_id needs no delegation rights', async () => {
    const f = await seed();
    const created = await serviceFor(f.tenantId).create(
      { period_id: f.periodId, user_id: f.actor },
      contextFor(f.tenantId, f.actor)
    );
    expect(created.user_id).toBe(f.actor);
  });

  it('rejects creating a sheet for another user without act-on-behalf rights', async () => {
    const f = await seed();
    // Holds read_all but not approve: not enough to act on someone else's time.
    grants.byUser.set(f.actor, new Set(['time_sheet:read_all']));

    await expect(
      serviceFor(f.tenantId).create({ period_id: f.periodId, user_id: f.subject }, contextFor(f.tenantId, f.actor))
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await sheetsFor(f.tenantId, f.subject)).toHaveLength(0);
  });

  it('creates a sheet for another user when the caller can act on their behalf', async () => {
    const f = await seed();
    grants.byUser.set(f.actor, new Set(['time_sheet:approve', 'time_sheet:read_all']));

    const created = await serviceFor(f.tenantId).create(
      { period_id: f.periodId, user_id: f.subject },
      contextFor(f.tenantId, f.actor)
    );

    expect(created.user_id).toBe(f.subject);
    expect(await sheetsFor(f.tenantId, f.subject)).toHaveLength(1);
  });

  describe('duplicate prevention per (tenant, user, period)', () => {
    const DUPLICATE_MESSAGE = 'A time sheet already exists for this user and period';
    const createdEvents = () =>
      vi.mocked(publishUnregisteredEventType).mock.calls.filter(([arg]) => (arg as any).eventType === 'TIME_SHEET_CREATED');

    it('a second create for the same user and period is a ConflictError that changes nothing', async () => {
      const f = await seed();
      const service = serviceFor(f.tenantId);
      const ctx = contextFor(f.tenantId, f.actor);
      const first = await service.create({ period_id: f.periodId }, ctx);
      vi.mocked(publishUnregisteredEventType).mockClear();

      await expect(service.create({ period_id: f.periodId, user_id: f.actor }, ctx)).rejects.toThrow(DUPLICATE_MESSAGE);
      await expect(service.create({ period_id: f.periodId }, ctx)).rejects.toBeInstanceOf(ConflictError);

      const rows = await sheetsFor(f.tenantId, f.actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.id, approval_status: 'DRAFT' });
      expect(createdEvents()).toHaveLength(0);
    });

    it.each(['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'])('an existing %s sheet still conflicts and keeps its state', async (status) => {
      const f = await seed();
      const existingId = uuidv4();
      await tenantTable(f.tenantId, 'time_sheets').insert({
        tenant: f.tenantId, id: existingId, user_id: f.actor, period_id: f.periodId, approval_status: status,
      });

      await expect(
        serviceFor(f.tenantId).create({ period_id: f.periodId }, contextFor(f.tenantId, f.actor))
      ).rejects.toBeInstanceOf(ConflictError);

      const rows = await sheetsFor(f.tenantId, f.actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: existingId, approval_status: status });
    });

    it('a delegated create conflicts on the target owner\'s sheet, not the caller\'s', async () => {
      const f = await seed();
      grants.byUser.set(f.actor, new Set(['time_sheet:approve', 'time_sheet:read_all']));
      const service = serviceFor(f.tenantId);
      const ctx = contextFor(f.tenantId, f.actor);

      // The caller's own sheet does not block creating the subject's...
      await service.create({ period_id: f.periodId }, ctx);
      const forSubject = await service.create({ period_id: f.periodId, user_id: f.subject }, ctx);
      expect(forSubject.user_id).toBe(f.subject);
      // ...but a second delegated create for the subject does.
      await expect(service.create({ period_id: f.periodId, user_id: f.subject }, ctx)).rejects.toBeInstanceOf(ConflictError);
      expect(await sheetsFor(f.tenantId, f.subject)).toHaveLength(1);
      expect(await sheetsFor(f.tenantId, f.actor)).toHaveLength(1);
    });

    it('a caller without delegation gets 403 before duplicate detection', async () => {
      const f = await seed();
      await tenantTable(f.tenantId, 'time_sheets').insert({
        tenant: f.tenantId, user_id: f.subject, period_id: f.periodId, approval_status: 'DRAFT',
      });
      grants.byUser.set(f.actor, new Set(['time_sheet:read_all']));

      const attempt = serviceFor(f.tenantId).create({ period_id: f.periodId, user_id: f.subject }, contextFor(f.tenantId, f.actor));
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      await expect(attempt).rejects.not.toBeInstanceOf(ConflictError);
    });

    it('other users, other periods and other tenants are independent', async () => {
      const f = await seed();
      const otherPeriod = uuidv4();
      await tenantTable(f.tenantId, 'time_periods').insert({
        period_id: otherPeriod, tenant: f.tenantId, start_date: '2026-01-12', end_date: '2026-01-19',
      });
      const service = serviceFor(f.tenantId);
      await service.create({ period_id: f.periodId }, contextFor(f.tenantId, f.actor));
      await service.create({ period_id: f.periodId }, contextFor(f.tenantId, f.subject)); // other user, same period
      await service.create({ period_id: otherPeriod }, contextFor(f.tenantId, f.actor)); // same user, other period

      // Identical user and period UUIDs in a different tenant.
      const otherTenant = uuidv4();
      tenantsToCleanup.add(otherTenant);
      await tenantRows().insert({
        tenant: otherTenant, client_name: `TS Other ${otherTenant.slice(0, 8)}`, email: `o-${otherTenant.slice(0, 8)}@example.com`,
      });
      await tenantTable(otherTenant, 'users').insert({
        tenant: otherTenant, user_id: f.actor, username: `ts-o-${f.actor.slice(0, 8)}`, hashed_password: 'x',
        user_type: 'internal', email: `o-${f.actor.slice(0, 8)}@example.com`, first_name: 'Same', last_name: 'Id',
      });
      await tenantTable(otherTenant, 'time_periods').insert({
        period_id: f.periodId, tenant: otherTenant, start_date: '2026-01-05', end_date: '2026-01-12',
      });
      const crossTenant = await serviceFor(otherTenant).create({ period_id: f.periodId }, contextFor(otherTenant, f.actor));
      expect(crossTenant.tenant).toBe(otherTenant);

      expect(await sheetsFor(f.tenantId, f.actor)).toHaveLength(2);
      expect(await sheetsFor(f.tenantId, f.subject)).toHaveLength(1);
    });

    it('the database rejects a direct duplicate insert with 23505', async () => {
      const f = await seed();
      const row = { tenant: f.tenantId, user_id: f.actor, period_id: f.periodId, approval_status: 'DRAFT' };
      await tenantTable(f.tenantId, 'time_sheets').insert(row);
      await expect(tenantTable(f.tenantId, 'time_sheets').insert(row)).rejects.toMatchObject({ code: '23505' });
      expect(await sheetsFor(f.tenantId, f.actor)).toHaveLength(1);
    });

    it('concurrent creates on independent connections leave one row, one event, and a 409 for the loser', async () => {
      const f = await seed();
      const adminDb = adminConnection();
      const triggerName = `ts_gate_${f.tenantId.slice(0, 8)}`;
      const gateKey = f.tenantId;
      // Synchronization point at the insert boundary: a BEFORE INSERT trigger blocks every insert
      // for this tenant on a shared advisory lock until the test releases an exclusive one. Both
      // creators therefore finish their lookup (no row yet), then park at the insert; we release
      // only once pg_locks shows two waiters. The loser then hits the ON CONFLICT path for real.
      await adminDb.raw(`
        CREATE OR REPLACE FUNCTION ts_insert_gate() RETURNS trigger AS $$
        BEGIN
          IF NEW.tenant::text = TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock_shared(hashtext(TG_ARGV[0])); END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await adminDb.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON time_sheets FOR EACH ROW EXECUTE FUNCTION ts_insert_gate('${gateKey}')`);
      const gate = await adminDb.transaction();
      try {
        await gate.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [gateKey]);
        const ctx = contextFor(f.tenantId, f.actor);
        const attempts = [0, 1].map(() => serviceFor(f.tenantId).create({ period_id: f.periodId }, ctx).then(
          (value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error })));

        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await adminDb.raw(
            "SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
          if (rows[0].waiting === 2) break;
          if (Date.now() > deadline) throw new Error('creators never both reached the insert boundary');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await gate.commit();

        const results = await Promise.all(attempts);
        const winners = results.filter((r) => r.ok);
        const losers = results.filter((r) => !r.ok) as Array<{ ok: false; error: any }>;
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0].error).toBeInstanceOf(ConflictError);
        expect(losers[0].error.message).toBe(DUPLICATE_MESSAGE);
        expect(await sheetsFor(f.tenantId, f.actor)).toHaveLength(1);
        expect(createdEvents()).toHaveLength(1);
      } finally {
        if (!gate.isCompleted()) await gate.rollback();
        await adminDb.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON time_sheets`);
        await adminDb.destroy();
      }
    });
  });

  it('reverse-approval route permits a manager with reverse permission and synchronizes the managed sheet', async () => {
    const f = await seed();
    const teamId = uuidv4();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'teams').insert({ tenant: f.tenantId, team_id: teamId, team_name: 'Managed team', manager_id: f.actor });
    await tenantTable(f.tenantId, 'team_members').insert({ tenant: f.tenantId, team_id: teamId, user_id: f.subject });
    await tenantTable(f.tenantId, 'time_sheets').insert({
      tenant: f.tenantId, id: sheetId, user_id: f.subject, period_id: f.periodId,
      approval_status: 'APPROVED', approved_by: f.actor, approved_at: new Date(),
    });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.subject, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    configureRouteBoundary(f.tenantId, f.actor);
    const beforeMissingManage = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first();
    const entryBeforeMissingManage = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first();
    const commentsBeforeMissingManage = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*');
    grants.byUser.set(f.actor, new Set(['time_sheet:approve', 'time_sheet:reverse']));
    const noManage = await postRoute(reverseApprovalRoute as any, `/api/v1/time-sheets/${sheetId}/reverse-approval`, { reversal_reason: 'Correction' });
    expect(noManage.status).toBe(403);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toEqual(beforeMissingManage);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toEqual(entryBeforeMissingManage);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*')).toEqual(commentsBeforeMissingManage);
    grants.byUser.set(f.actor, new Set(['time_sheet:approve', 'time_sheet:reverse', 'time_sheet:manage']));
    const response = await postRoute(reverseApprovalRoute as any, `/api/v1/time-sheets/${sheetId}/reverse-approval`, { reversal_reason: 'Correction' });
    expect(response.status).toBe(200);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first())
      .toMatchObject({ approval_status: 'CHANGES_REQUESTED', approved_at: null, approved_by: null, reversal_reason: 'Correction', reversed_by: f.actor });
    expect((await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).reversed_at).toBeInstanceOf(Date);
    expect((await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).approval_status).toBe('CHANGES_REQUESTED');
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('comment')).toEqual([{ comment: 'Approval reversed: Correction' }]);
  });

  it('refuses to reverse an invoiced time entry without changing any lifecycle records', async () => {
    const f = await seed();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id: sheetId, user_id: f.actor, period_id: f.periodId, approval_status: 'APPROVED', approved_by: f.subject, approved_at: new Date() });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: true, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const sheetBefore = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first();
    const entryBefore = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first();
    const commentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*');
    grants.byUser.set(f.actor, new Set(['time_sheet:reverse', 'time_sheet:manage']));
    await expect(runWithTenant(f.tenantId, () => serviceFor(f.tenantId).reverseApproval(sheetId, { reversal_reason: 'already invoiced' }, contextFor(f.tenantId, f.actor))))
      .rejects.toBeInstanceOf(ConflictError);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toEqual(sheetBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*')).toEqual(commentsBefore);
  });

  it('refuses to reverse when an invoice link exists even if the entry flag is false', async () => {
    const f = await seed();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    await tenantTable(f.tenantId, 'clients').insert({ tenant: f.tenantId, client_id: clientId, client_name: 'Reversal invoice fixture', billing_cycle: 'monthly' });
    await tenantTable(f.tenantId, 'invoices').insert({
      tenant: f.tenantId, invoice_id: invoiceId, client_id: clientId,
      invoice_number: `REV-${invoiceId.slice(0, 8)}`, invoice_date: new Date(), due_date: new Date(),
      total_amount: 0, status: 'draft',
    });
    await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id: sheetId, user_id: f.actor, period_id: f.periodId, approval_status: 'APPROVED', approved_by: f.subject, approved_at: new Date() });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await tenantTable(f.tenantId, 'invoice_time_entries').insert({
      invoice_time_entry_id: uuidv4(), tenant: f.tenantId, invoice_id: invoiceId, entry_id: entryId,
    });
    const sheetBefore = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first();
    const entryBefore = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first();
    const commentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*');
    grants.byUser.set(f.actor, new Set(['time_sheet:reverse', 'time_sheet:manage']));
    await expect(runWithTenant(f.tenantId, () => serviceFor(f.tenantId).reverseApproval(sheetId, { reversal_reason: 'linked invoice' }, contextFor(f.tenantId, f.actor))))
      .rejects.toBeInstanceOf(ConflictError);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toEqual(sheetBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*')).toEqual(commentsBefore);
  });

  it('server action denies linked invoiced entries unchanged and replaces stale audit fields on a valid reversal', async () => {
    const f = await seed();
    const invoiceSheetId = uuidv4();
    const invoiceEntryId = uuidv4();
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    await tenantTable(f.tenantId, 'clients').insert({ tenant: f.tenantId, client_id: clientId, client_name: 'UI reversal invoice fixture', billing_cycle: 'monthly' });
    await tenantTable(f.tenantId, 'invoices').insert({
      tenant: f.tenantId, invoice_id: invoiceId, client_id: clientId,
      invoice_number: `UI-REV-${invoiceId.slice(0, 8)}`, invoice_date: new Date(), due_date: new Date(),
      total_amount: 0, status: 'draft',
    });
    await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id: invoiceSheetId, user_id: f.actor, period_id: f.periodId, approval_status: 'APPROVED', approved_by: f.subject, approved_at: new Date() });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: invoiceEntryId, user_id: f.actor, time_sheet_id: invoiceSheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await tenantTable(f.tenantId, 'invoice_time_entries').insert({ invoice_time_entry_id: uuidv4(), tenant: f.tenantId, invoice_id: invoiceId, entry_id: invoiceEntryId });
    await tenantTable(f.tenantId, 'time_sheet_comments').insert({
      tenant: f.tenantId, comment_id: uuidv4(), time_sheet_id: invoiceSheetId, user_id: f.subject,
      comment: 'prior history', is_approver: true, created_at: db.fn.now(),
    });

    const validSheetId = uuidv4();
    const validEntryId = uuidv4();
    const secondPeriodId = uuidv4();
    await tenantTable(f.tenantId, 'time_periods').insert({ period_id: secondPeriodId, tenant: f.tenantId, start_date: '2026-01-12', end_date: '2026-01-19' });
    const staleReversedAt = new Date('2025-01-01T00:00:00Z');
    await tenantTable(f.tenantId, 'time_sheets').insert({
      tenant: f.tenantId, id: validSheetId, user_id: f.actor, period_id: secondPeriodId,
      approval_status: 'APPROVED', approved_by: f.subject, approved_at: new Date(),
      reversal_reason: 'stale reason', reversed_at: staleReversedAt, reversed_by: f.subject,
    });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: validEntryId, user_id: f.actor, time_sheet_id: validSheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: false, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await tenantTable(f.tenantId, 'time_sheet_comments').insert({
      tenant: f.tenantId, comment_id: uuidv4(), time_sheet_id: validSheetId, user_id: f.subject,
      comment: 'retained history', is_approver: true, created_at: db.fn.now(),
    });
    // The server action historically requires reverse permission; REST separately requires manage.
    grants.byUser.set(f.actor, new Set(['time_sheet:reverse']));
    vi.spyOn(algaDb, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: f.tenantId } as any);
    const actionUser = { user_id: f.actor, tenant: f.tenantId, user_type: 'internal' } as any;
    const beforeSheet = await tenantTable(f.tenantId, 'time_sheets').where({ id: invoiceSheetId }).first();
    const beforeEntry = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: invoiceEntryId }).first();
    const beforeComments = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: invoiceSheetId }).select('*');
    const denied = await runWithApiKeyUser(actionUser, () => reverseTimeSheetApproval(invoiceSheetId, f.actor, 'linked invoice'));
    expect(denied).toMatchObject({ actionError: expect.stringContaining('cannot be reopened') });
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: invoiceSheetId }).first()).toEqual(beforeSheet);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: invoiceEntryId }).first()).toEqual(beforeEntry);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: invoiceSheetId }).select('*')).toEqual(beforeComments);

    const flaggedSheetId = uuidv4();
    const flaggedEntryId = uuidv4();
    const flaggedPeriodId = uuidv4();
    const flaggedReversedAt = new Date('2025-01-01T00:00:00Z');
    await tenantTable(f.tenantId, 'time_periods').insert({ period_id: flaggedPeriodId, tenant: f.tenantId, start_date: '2026-01-19', end_date: '2026-01-26' });
    await tenantTable(f.tenantId, 'time_sheets').insert({
      tenant: f.tenantId, id: flaggedSheetId, user_id: f.actor, period_id: flaggedPeriodId,
      approval_status: 'APPROVED', reversal_reason: 'preserve me', reversed_by: f.subject,
      reversed_at: flaggedReversedAt,
    });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: flaggedEntryId, user_id: f.actor, time_sheet_id: flaggedSheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-20',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: true, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const flaggedSheetBefore = await tenantTable(f.tenantId, 'time_sheets').where({ id: flaggedSheetId }).first();
    const flaggedEntryBefore = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: flaggedEntryId }).first();
    const flaggedCommentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: flaggedSheetId }).select('*');
    const flaggedDenied = await runWithApiKeyUser(actionUser, () => reverseTimeSheetApproval(flaggedSheetId, f.actor, 'must stay unchanged'));
    expect(flaggedDenied).toMatchObject({ actionError: expect.stringContaining('cannot be reopened') });
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: flaggedSheetId }).first()).toEqual(flaggedSheetBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: flaggedEntryId }).first()).toEqual(flaggedEntryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: flaggedSheetId }).select('*')).toEqual(flaggedCommentsBefore);

    const reversalStartedAt = Date.now();
    const actionResult = await runWithApiKeyUser(actionUser, () => reverseTimeSheetApproval(validSheetId, f.actor, 'current reason'));
    const reversalFinishedAt = Date.now();
    expect(actionResult).toBeUndefined();
    const reversed = await tenantTable(f.tenantId, 'time_sheets').where({ id: validSheetId }).first();
    expect(reversed).toMatchObject({
      approval_status: 'CHANGES_REQUESTED', approved_at: null, approved_by: null,
      reversal_reason: 'current reason', reversed_by: f.actor,
    });
    expect(reversed.reversed_at).toBeInstanceOf(Date);
    expect(reversed.reversed_at.getTime()).toBeGreaterThanOrEqual(reversalStartedAt);
    expect(reversed.reversed_at.getTime()).toBeLessThanOrEqual(reversalFinishedAt);
    expect(reversed.reversed_at.getTime()).not.toBe(staleReversedAt.getTime());
    expect((await tenantTable(f.tenantId, 'time_entries').where({ entry_id: validEntryId }).first()).approval_status).toBe('CHANGES_REQUESTED');
    expect((await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: validSheetId }).orderBy('created_at').select('comment')))
      .toEqual([{ comment: 'retained history' }, { comment: 'Approval reversed: current reason' }]);

    // Reapprove the same sheet and reverse it again: structured audit fields describe
    // the latest reversal while the comment stream retains both events.
    const secondStaleAt = new Date('2024-01-01T00:00:00Z');
    await tenantTable(f.tenantId, 'time_sheets').where({ id: validSheetId }).update({
      approval_status: 'APPROVED', approved_at: secondStaleAt, approved_by: f.subject,
      reversal_reason: 'prior reversal', reversed_at: secondStaleAt, reversed_by: f.subject,
    });
    await tenantTable(f.tenantId, 'time_entries').where({ entry_id: validEntryId }).update({ approval_status: 'APPROVED' });
    const secondActionResult = await runWithApiKeyUser(actionUser, () => reverseTimeSheetApproval(validSheetId, f.actor, 'latest reason'));
    expect(secondActionResult).toBeUndefined();
    const reversedAgain = await tenantTable(f.tenantId, 'time_sheets').where({ id: validSheetId }).first();
    expect(reversedAgain).toMatchObject({ reversal_reason: 'latest reason', reversed_by: f.actor, approval_status: 'CHANGES_REQUESTED' });
    expect(reversedAgain.reversed_at).toBeInstanceOf(Date);
    expect(reversedAgain.reversed_at.getTime()).not.toBe(secondStaleAt.getTime());
    expect((await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: validSheetId }).orderBy('created_at').select('comment')))
      .toEqual([
        { comment: 'retained history' },
        { comment: 'Approval reversed: current reason' },
        { comment: 'Approval reversed: latest reason' },
      ]);
  });

  it('server action records the first reversal audit with the entry timestamp and history actor', async () => {
    const f = await seed();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'users').where({ user_id: f.subject }).update({ reports_to: f.actor });
    await tenantTable(f.tenantId, 'time_sheets').insert({
      tenant: f.tenantId, id: sheetId, user_id: f.subject, period_id: f.periodId,
      approval_status: 'APPROVED', approved_by: f.actor, approved_at: new Date(),
      reversal_reason: null, reversed_at: null, reversed_by: null,
    });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.subject, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'APPROVED', invoiced: false,
      created_at: db.fn.now(), updated_at: new Date('2025-01-01T00:00:00Z'),
    });
    grants.byUser.set(f.actor, new Set(['time_sheet:reverse', 'time_sheet:approve']));
    vi.spyOn(algaDb, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: f.tenantId } as any);
    const actionUser = { user_id: f.actor, tenant: f.tenantId, user_type: 'internal' } as any;
    const startedAt = Date.now();
    await expect(runWithApiKeyUser(actionUser, () => reverseTimeSheetApproval(sheetId, f.actor, 'Correct the hours')))
      .resolves.toBeUndefined();
    const finishedAt = Date.now();

    const sheet = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first();
    expect(sheet).toMatchObject({
      approval_status: 'CHANGES_REQUESTED', approved_at: null, approved_by: null,
      reversal_reason: 'Correct the hours', reversed_by: f.actor,
    });
    expect(sheet.reversed_at).toBeInstanceOf(Date);
    expect(sheet.reversed_at.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(sheet.reversed_at.getTime()).toBeLessThanOrEqual(finishedAt);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first())
      .toMatchObject({ approval_status: 'CHANGES_REQUESTED', updated_at: sheet.reversed_at });
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('user_id', 'comment', 'is_approver'))
      .toEqual([{ user_id: f.actor, comment: 'Approval reversed: Correct the hours', is_approver: true }]);
  });

  it('bulk route performs approvals and persists approval metadata, entry state, and comment', async () => {
    const f = await seed();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'users').where({ user_id: f.subject }).update({ reports_to: f.actor });
    await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id: sheetId, user_id: f.subject, period_id: f.periodId, approval_status: 'SUBMITTED', submitted_at: new Date() });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.subject, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'SUBMITTED', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    configureRouteBoundary(f.tenantId, f.actor);
    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    const response = await postRoute(bulkApprovalRoute as any, '/api/v1/time-sheets/bulk', { time_sheet_ids: [sheetId], approval_notes: 'smoke' });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.results).toMatchObject([{ success: true, time_sheet_id: sheetId }]);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toMatchObject({ approval_status: 'APPROVED', approved_by: f.actor });
    expect((await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).approval_status).toBe('APPROVED');
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('comment')).toEqual([{ comment: 'smoke' }]);
  });

  it('bulk route denies not_self_approver without changing sheet, entries, or comments', async () => {
    const f = await seed();
    const sheetId = uuidv4();
    const entryId = uuidv4();
    await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id: sheetId, user_id: f.actor, period_id: f.periodId, approval_status: 'SUBMITTED', submitted_at: new Date() });
    await tenantTable(f.tenantId, 'time_entries').insert({
      tenant: f.tenantId, entry_id: entryId, user_id: f.actor, time_sheet_id: sheetId,
      start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
      work_timezone: 'UTC', approval_status: 'SUBMITTED', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    configureRouteBoundary(f.tenantId, f.actor);
    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    approvalBundleRules.rules = [{ resource: 'time_entry', action: 'approve', constraintKey: 'not_self_approver' }];
    const sheetBefore = await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first();
    const entryBefore = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first();
    const commentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*');
    const response = await postRoute(bulkApprovalRoute as any, '/api/v1/time-sheets/bulk', { time_sheet_ids: [sheetId], approval_notes: 'must not persist' });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.results).toMatchObject([{ success: false, time_sheet_id: sheetId }]);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: sheetId }).first()).toEqual(sheetBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: entryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: sheetId }).select('*')).toEqual(commentsBefore);
  });

  it('reject route validates notes and performs an authorized atomic lifecycle transition', async () => {
    const f = await seed();
    await tenantTable(f.tenantId, 'users').where({ user_id: f.subject }).update({ reports_to: f.actor });
    const submittedId = uuidv4();
    const draftId = uuidv4();
    const draftPeriodId = uuidv4();
    await tenantTable(f.tenantId, 'time_periods').insert({ tenant: f.tenantId, period_id: draftPeriodId, start_date: '2026-02-02', end_date: '2026-02-09' });
    const submittedEntryId = uuidv4();
    const draftEntryId = uuidv4();
    for (const [id, status, entryId] of [[submittedId, 'SUBMITTED', submittedEntryId], [draftId, 'DRAFT', draftEntryId]] as const) {
      await tenantTable(f.tenantId, 'time_sheets').insert({ tenant: f.tenantId, id, user_id: f.subject, period_id: status === 'SUBMITTED' ? f.periodId : draftPeriodId, approval_status: status, submitted_at: status === 'SUBMITTED' ? new Date() : null });
      await tenantTable(f.tenantId, 'time_entries').insert({
        tenant: f.tenantId, entry_id: entryId, user_id: f.subject, time_sheet_id: id,
        start_time: new Date().toISOString(), end_time: new Date().toISOString(), work_date: '2026-01-06',
        work_timezone: 'UTC', approval_status: status, created_at: db.fn.now(), updated_at: db.fn.now(),
      });
    }
    configureRouteBoundary(f.tenantId, f.actor);
    const submittedBefore = await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first();
    const entryBefore = await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first();
    const commentsBefore = await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('*');

    vi.mocked(usersActions.findUserByIdForApi).mockResolvedValueOnce(null as any);
    const missingPrincipal = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, { notes: 'No principal' });
    expect(missingPrincipal.status).toBe(401);
    vi.mocked(usersActions.findUserByIdForApi).mockResolvedValueOnce({
      user_id: f.actor, tenant: f.tenantId, user_type: 'client',
    } as any);
    const invalidPrincipal = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, { notes: 'Client principal' });
    expect(invalidPrincipal.status).toBe(401);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first()).toEqual(submittedBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('*')).toEqual(commentsBefore);

    grants.byUser.set(f.actor, new Set());
    const unauthorized = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, { notes: 'No permission' });
    expect(unauthorized.status).toBe(403);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first()).toEqual(submittedBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('*')).toEqual(commentsBefore);

    grants.byUser.set(f.actor, new Set(['time_sheet:approve']));
    const invalidPayload = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, { approval_status: 'CHANGES_REQUESTED' });
    expect(invalidPayload.status).toBe(400);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first()).toEqual(submittedBefore);
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first()).toEqual(entryBefore);
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('*')).toEqual(commentsBefore);
    for (const malformedBody of ['{', '']) {
      const malformed = await postRawRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, malformedBody);
      expect(malformed.status).toBe(400);
      expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first()).toEqual(submittedBefore);
      expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first()).toEqual(entryBefore);
      expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('*')).toEqual(commentsBefore);
    }
    const invalidState = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${draftId}/reject`, { notes: 'No draft rejection' });
    expect(invalidState.status).toBe(409);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: draftId }).first()).toMatchObject({ approval_status: 'DRAFT' });
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: draftEntryId }).first()).toMatchObject({ approval_status: 'DRAFT' });
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: draftId }).select('*')).toEqual([]);
    const success = await postRoute(rejectTimeSheetRoute as any, `/api/v1/time-sheets/${submittedId}/reject`, { notes: 'Please correct the hours' });
    expect(success.status).toBe(200);
    expect(await tenantTable(f.tenantId, 'time_sheets').where({ id: submittedId }).first()).toMatchObject({ approval_status: 'CHANGES_REQUESTED' });
    expect(await tenantTable(f.tenantId, 'time_entries').where({ entry_id: submittedEntryId }).first()).toMatchObject({ approval_status: 'CHANGES_REQUESTED' });
    expect(await tenantTable(f.tenantId, 'time_sheet_comments').where({ time_sheet_id: submittedId }).select('comment')).toEqual([{ comment: 'Rejected: Please correct the hours' }]);
  });
});

function adminPassword(): string {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), '..', 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

function adminConnection(): Knex {
  const client = db.client.config.connection as Record<string, unknown>;
  return knexFactory({
    client: 'pg',
    connection: {
      host: client.host as string, port: client.port as number, database: client.database as string,
      user: process.env.DB_USER_ADMIN || 'postgres', password: adminPassword(),
    },
    pool: { min: 1, max: 3 },
  });
}
