import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { knex as knexFactory, type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TimeSheetService } from '@/lib/api/services/TimeSheetService';
import { ConflictError, ForbiddenError } from '@/lib/api/middleware/apiMiddleware';
import { publishUnregisteredEventType } from 'server/src/lib/eventBus/publishers';

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
vi.mock('server/src/lib/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grants.byUser.get(user.user_id)?.has(`${resource}:${action}`) ?? false),
}));
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
    vi.mocked(publishUnregisteredEventType).mockClear();
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

    const updated = await service.update(created.id, { notes: 'updated notes' }, ctx);

    expect(updated).toMatchObject({ id: created.id, notes: 'updated notes', approval_status: 'DRAFT' });
    const [row] = await sheetsFor(f.tenantId, f.actor);
    expect(row.notes).toBe('updated notes');
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
