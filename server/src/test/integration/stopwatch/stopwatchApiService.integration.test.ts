/**
 * StopwatchApiService and the legacy time-tracking adapters against a real database (plan sections 6, 11).
 * Covers the service layer behind /api/v1/stopwatch (start/pause/resume/update/log/discard, 409 conflict
 * carrying the open session, locked-sheet 409, delegation on GET /active) and the rewritten
 * TimeEntryService startTimeTracking / getActiveSession / stopTimeTracking, which keep their legacy shapes.
 * The HTTP/auth layer (ApiStopwatchController) is covered by the e2e suite.
 * NOTE: plain Postgres only; Citus-specific behaviour is not exercised.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../lib/api/middleware/apiMiddleware';
import { StopwatchApiService } from '../../../lib/api/services/StopwatchApiService';
import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';
import {
  createBoard,
  createPeriod,
  createSheet,
  createStopwatchUser,
  createTicket,
  seedBucketClient,
  type BucketSeed,
} from './stopwatchTestSeed';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(async () => {}),
  })),
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
  },
}));

// The global test setup stubs hasPermission to always allow; use the real RBAC so denials are exercised.
vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const passthrough = (action: any) => async (...args: any[]) => action(null, { tenant: null }, ...args);
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: passthrough,
    withOptionalAuth: passthrough,
    withAuthCheck: (action: any) => async (...args: any[]) => action(null, ...args),
  };
});

let db: Knex;
let tenantId: string;
let periodId: string;
let bucket: BucketSeed;
const stopwatch = new StopwatchApiService();
const timeEntries = new TimeEntryService();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function ctxFor(userId: string): Promise<any> {
  const row = await tenantDb(db, tenantId).table('users').where({ user_id: userId }).first();
  return { userId, tenant: tenantId, user: { ...row, tenant: tenantId } };
}

/** Run inside the tenant context the real route handlers establish. */
const asTenant = <T>(fn: () => Promise<T>) => runWithTenant(tenantId, fn);

async function userWithSheet(label: string, sheetStatus = 'DRAFT') {
  const userId = await createStopwatchUser(db, tenantId, label);
  const sheetId = await createSheet(db, tenantId, periodId, userId, sheetStatus);
  return { userId, sheetId, ctx: await ctxFor(userId) };
}

async function expectError<T extends Error>(promise: Promise<unknown>, type: new (...args: any[]) => T): Promise<T> {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(type);
  return error as T;
}

describe('StopwatchApiService and legacy tracking adapters (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Stopwatch API tenant');
    // The services use the real clock, so the period must cover "now".
    const now = Date.now();
    periodId = await createPeriod(
      db,
      tenantId,
      new Date(now - 40 * 86_400_000).toISOString(),
      new Date(now + 40 * 86_400_000).toISOString(),
    );
    bucket = await seedBucketClient(db, tenantId);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  describe('StopwatchApiService', () => {
    it('start returns the session view; a second start is a 409 carrying the open session', async () => {
      const { ctx } = await userWithSheet('api-start');
      const session = await asTenant(() => stopwatch.start({
        work_item_type: 'ticket',
        work_item_id: bucket.ticketId,
        service_id: bucket.serviceId,
        notes: 'api notes',
      }, ctx));
      expect(session).toMatchObject({
        user_id: ctx.userId,
        work_item_type: 'ticket',
        work_item_id: bucket.ticketId,
        service_id: bucket.serviceId,
        notes: 'api notes',
        status: 'running',
        time_entry_id: null,
        closed_at: null,
      });
      expect(session.segments).toHaveLength(1);
      expect(session.segments[0].ended_at).toBeNull();
      expect(typeof session.active_ms).toBe('number');
      expect(new Date(session.server_now).getTime()).toBeGreaterThan(0);

      const conflict = await expectError(asTenant(() => stopwatch.start({
        work_item_type: 'ticket',
        work_item_id: bucket.ticketId,
        service_id: bucket.serviceId,
      }, ctx)), ConflictError);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.details.reason).toBe('open_session_exists');
      expect(conflict.details.open_session.session_id).toBe(session.session_id);
    });

    it('pause / resume are idempotent and getActive follows the state', async () => {
      const { ctx } = await userWithSheet('api-pause');
      const started = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId, service_id: bucket.serviceId }, ctx));
      const paused = await asTenant(() => stopwatch.pause(started.session_id, ctx));
      expect(paused.status).toBe('paused');
      expect(paused.segments.every((s) => s.ended_at !== null)).toBe(true);
      expect((await asTenant(() => stopwatch.pause(started.session_id, ctx))).status).toBe('paused');
      expect((await asTenant(() => stopwatch.getActive(ctx)))?.status).toBe('paused');

      const resumed = await asTenant(() => stopwatch.resume(started.session_id, ctx));
      expect(resumed.status).toBe('running');
      expect(resumed.segments).toHaveLength(2);
      expect((await asTenant(() => stopwatch.resume(started.session_id, ctx))).segments).toHaveLength(2);

      const updated = await asTenant(() => stopwatch.updateDraft(started.session_id, { notes: 'edited', service_id: null }, ctx));
      expect(updated.notes).toBe('edited');
      expect(updated.service_id).toBeNull();

      await asTenant(() => stopwatch.discard(started.session_id, ctx));
      expect(await asTenant(() => stopwatch.getActive(ctx))).toBeNull();
      // A closed session is a 409, an unknown id a 404.
      await expectError(asTenant(() => stopwatch.pause(started.session_id, ctx)), ConflictError);
      await expectError(asTenant(() => stopwatch.pause(UNKNOWN_ID, ctx)), NotFoundError);
    });

    it("another user's session is invisible to mutations (404); GET /active?user_id= needs delegation (403)", async () => {
      const owner = await userWithSheet('api-owner');
      const other = await userWithSheet('api-other');
      const session = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId, service_id: bucket.serviceId }, owner.ctx));

      await expectError(asTenant(() => stopwatch.pause(session.session_id, other.ctx)), NotFoundError);
      await expectError(asTenant(() => stopwatch.discard(session.session_id, other.ctx)), NotFoundError);
      await expectError(asTenant(() => stopwatch.log(session.session_id, {}, other.ctx)), NotFoundError);
      await expectError(asTenant(() => stopwatch.getActive(other.ctx, owner.userId)), ForbiddenError);
      expect((await asTenant(() => stopwatch.getActive(owner.ctx, owner.userId)))?.session_id).toBe(session.session_id);
      await asTenant(() => stopwatch.discard(session.session_id, owner.ctx));
    });

    it('a board with the stopwatch off is a 409; an unknown ticket is a 404', async () => {
      const { ctx } = await userWithSheet('api-board');
      const boardId = await createBoard(db, tenantId, false);
      const ticket = await createTicket(db, tenantId, { boardId });
      const error = await expectError(asTenant(() => stopwatch.start({
        work_item_type: 'ticket', work_item_id: ticket.ticketId, service_id: bucket.serviceId,
      }, ctx)), ConflictError);
      expect(error.details.reason).toContain('boardDisabled');
      await expectError(asTenant(() => stopwatch.start({
        work_item_type: 'ticket', work_item_id: UNKNOWN_ID, service_id: bucket.serviceId,
      }, ctx)), NotFoundError);
    });

    it('log writes one entry on the resolved sheet and returns { session, time_entry }', async () => {
      const { ctx, sheetId } = await userWithSheet('api-log');
      const started = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId, service_id: bucket.serviceId, notes: 'to log' }, ctx));
      const { session, time_entry } = await asTenant(() => stopwatch.log(started.session_id, {}, ctx));
      expect(session.status).toBe('logged');
      expect(session.time_entry_id).toBe(time_entry.entry_id);
      expect(time_entry).toMatchObject({
        user_id: ctx.userId,
        time_sheet_id: sheetId,
        work_item_id: bucket.ticketId,
        work_item_type: 'ticket',
        service_id: bucket.serviceId,
        notes: 'to log',
      });
      expect(Number(time_entry.billable_duration)).toBeGreaterThanOrEqual(1);
      expect(await tenantDb(db, tenantId).table('time_entries').where({ user_id: ctx.userId })).toHaveLength(1);
      await expectError(asTenant(() => stopwatch.log(started.session_id, {}, ctx)), ConflictError);
      expect(await asTenant(() => stopwatch.getActive(ctx))).toBeNull();
    });

    it('log honours caller overrides; a missing service is a 400', async () => {
      const { ctx } = await userWithSheet('api-log-override');
      const started = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId }, ctx));
      await asTenant(() => stopwatch.pause(started.session_id, ctx));
      await expectError(asTenant(() => stopwatch.log(started.session_id, {}, ctx)), ValidationError);
      const start = new Date(Date.now() - 2 * 3_600_000);
      const end = new Date(start.getTime() + 90 * 60_000);
      const { time_entry } = await asTenant(() => stopwatch.log(started.session_id, {
        service_id: bucket.serviceId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        notes: 'override',
      }, ctx));
      expect(Number(time_entry.billable_duration)).toBe(90);
      expect(time_entry.notes).toBe('override');
    });

    it('log on a locked sheet is a 409 and the session stays open and loggable', async () => {
      const { ctx, userId, sheetId } = await userWithSheet('api-locked', 'SUBMITTED');
      const started = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId, service_id: bucket.serviceId }, ctx));
      await asTenant(() => stopwatch.pause(started.session_id, ctx));
      const error = await expectError(asTenant(() => stopwatch.log(started.session_id, {}, ctx)), ConflictError);
      expect(error.statusCode).toBe(409);
      expect(error.details.reason).toContain('sheetLocked');
      expect(await tenantDb(db, tenantId).table('time_entries').where({ user_id: userId })).toHaveLength(0);
      expect((await asTenant(() => stopwatch.getActive(ctx)))?.status).toBe('paused');

      await tenantDb(db, tenantId).table('time_sheets').where({ id: sheetId }).update({ approval_status: 'CHANGES_REQUESTED' });
      const { session } = await asTenant(() => stopwatch.log(started.session_id, {}, ctx));
      expect(session.status).toBe('logged');
    });
  });

  describe('legacy time-tracking adapters keep their response shape', () => {
    const LEGACY_KEYS = [
      'session_id', 'entry_id', 'tenant', 'work_item_id', 'work_item_type', 'service_id', 'user_id',
      'start_time', 'end_time', 'work_date', 'work_timezone', 'notes', 'billable_duration', 'approval_status',
      'created_at', 'updated_at', 'status', 'elapsed_minutes', 'work_item_title', 'service_name',
    ];

    it('start-tracking returns the old active-session shape', async () => {
      const { ctx } = await userWithSheet('legacy-start');
      const result = await asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId,
        work_item_type: 'ticket',
        service_id: bucket.serviceId,
        notes: 'Starting work',
      } as any, ctx));
      expect(Object.keys(result).sort()).toEqual([...LEGACY_KEYS].sort());
      expect(result).toMatchObject({
        work_item_id: bucket.ticketId,
        work_item_type: 'ticket',
        service_id: bucket.serviceId,
        user_id: ctx.userId,
        tenant: tenantId,
        notes: 'Starting work',
        end_time: null,
        billable_duration: 0,
        approval_status: 'DRAFT',
        status: 'active',
        elapsed_minutes: 0,
      });
      expect(typeof result.work_item_title).toBe('string');
      expect(typeof result.service_name).toBe('string');
      expect(new Date(result.start_time).toISOString()).toBe(result.start_time);
      const session = await tenantDb(db, tenantId).table('time_tracking_sessions').where({ session_id: result.session_id }).first();
      expect(session.status).toBe('running');
      // No open time_entries row is written any more.
      expect(await tenantDb(db, tenantId).table('time_entries').where({ user_id: ctx.userId })).toHaveLength(0);

      const conflict = await expectError(asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId, work_item_type: 'ticket', service_id: bucket.serviceId,
      } as any, ctx)), ConflictError);
      expect(conflict.message).toContain('Active time tracking session already exists');
    });

    it('active-session returns the legacy shape (start_time = first segment start) or null', async () => {
      const { ctx } = await userWithSheet('legacy-active');
      expect(await asTenant(() => timeEntries.getActiveSession(ctx.userId, ctx))).toBeNull();
      const started = await asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId, work_item_type: 'ticket', service_id: bucket.serviceId,
      } as any, ctx));
      const active = await asTenant(() => timeEntries.getActiveSession(ctx.userId, ctx));
      expect(Object.keys(active).sort()).toEqual([...LEGACY_KEYS].sort());
      expect(active.session_id).toBe(started.session_id);
      expect(active.start_time).toBe(started.start_time);
      expect(active.status).toBe('active');
      expect(typeof active.elapsed_minutes).toBe('number');

      await asTenant(() => stopwatch.pause(started.session_id, ctx));
      expect((await asTenant(() => timeEntries.getActiveSession(ctx.userId, ctx))).status).toBe('paused');
    });

    it('active-session needs time_entry:read (403 without it)', async () => {
      const bare = await createUser(db, tenantId, {
        email: `bare-${Date.now()}@example.com`,
        first_name: 'Bare',
        last_name: 'User',
        user_type: 'internal',
      });
      const ctx = await ctxFor(bare);
      await expectError(asTenant(() => timeEntries.getActiveSession(bare, ctx)), ForbiddenError);
    });

    it('stop-tracking logs the session through the write core and returns the time entry', async () => {
      const { ctx, sheetId } = await userWithSheet('legacy-stop');
      const started = await asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId, work_item_type: 'ticket', service_id: bucket.serviceId, notes: 'Starting work',
      } as any, ctx));
      const entry = await asTenant(() => timeEntries.stopTimeTracking(started.session_id, { notes: 'Completed work' } as any, ctx));
      expect(entry).toMatchObject({
        user_id: ctx.userId,
        work_item_id: bucket.ticketId,
        work_item_type: 'ticket',
        service_id: bucket.serviceId,
        notes: 'Completed work',
        time_sheet_id: sheetId,
      });
      expect(entry.entry_id).toBeTruthy();
      expect(Number(entry.billable_duration)).toBeGreaterThanOrEqual(1);
      const session = await tenantDb(db, tenantId).table('time_tracking_sessions').where({ session_id: started.session_id }).first();
      expect(session.status).toBe('logged');
      expect(session.time_entry_id).toBe(entry.entry_id);
      expect(await asTenant(() => timeEntries.getActiveSession(ctx.userId, ctx))).toBeNull();
      await expectError(asTenant(() => timeEntries.stopTimeTracking(started.session_id, {} as any, ctx)), NotFoundError);
    });

    it('stop-tracking on a paused session logs it; is_billable:false stores zero billable minutes', async () => {
      const { ctx } = await userWithSheet('legacy-stop-paused');
      const started = await asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId, work_item_type: 'ticket', service_id: bucket.serviceId,
      } as any, ctx));
      await asTenant(() => stopwatch.pause(started.session_id, ctx));
      const entry = await asTenant(() => timeEntries.stopTimeTracking(started.session_id, { is_billable: false } as any, ctx));
      expect(Number(entry.billable_duration)).toBe(0);
    });

    it("stop-tracking: unknown session 404, another user's session 404, no service 400", async () => {
      const a = await userWithSheet('legacy-stop-a');
      const b = await userWithSheet('legacy-stop-b');
      await expectError(asTenant(() => timeEntries.stopTimeTracking(UNKNOWN_ID, {} as any, a.ctx)), NotFoundError);
      const started = await asTenant(() => stopwatch.start({ work_item_type: 'ticket', work_item_id: bucket.ticketId }, a.ctx));
      await expectError(asTenant(() => timeEntries.stopTimeTracking(started.session_id, { service_id: bucket.serviceId } as any, b.ctx)), NotFoundError);
      await expectError(asTenant(() => timeEntries.stopTimeTracking(started.session_id, {} as any, a.ctx)), ValidationError);
      expect((await asTenant(() => stopwatch.getActive(a.ctx)))?.session_id).toBe(started.session_id);
    });

    it('stop-tracking on a locked sheet fails and the session stays open', async () => {
      const { ctx } = await userWithSheet('legacy-locked', 'APPROVED');
      const started = await asTenant(() => timeEntries.startTimeTracking({
        work_item_id: bucket.ticketId, work_item_type: 'ticket', service_id: bucket.serviceId,
      } as any, ctx));
      await expectError(asTenant(() => timeEntries.stopTimeTracking(started.session_id, {} as any, ctx)), ConflictError);
      expect((await asTenant(() => timeEntries.getActiveSession(ctx.userId, ctx)))?.session_id).toBe(started.session_id);
    });
  });
});
