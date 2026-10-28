import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { ForbiddenError } from '@/lib/api/middleware/apiMiddleware';

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
const grants = vi.hoisted(() => ({ byUser: new Map<string, Set<string>>() }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
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

describe('TimeSheetService.create / update (real Postgres)', () => {
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

  it('PUT updates the sheet', async () => {
    const f = await seed();
    const service = serviceFor(f.tenantId);
    const ctx = contextFor(f.tenantId, f.actor);
    const created = await service.create({ period_id: f.periodId }, ctx);

    const updated = await service.update(created.id, { approval_status: 'SUBMITTED' }, ctx);

    expect(updated).toMatchObject({ id: created.id, approval_status: 'SUBMITTED' });
    const [row] = await sheetsFor(f.tenantId, f.actor);
    expect(row.approval_status).toBe('SUBMITTED');
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
});
