/**
 * Stopwatch log against a real database (plan section 11): one session becomes exactly one time
 * entry through the shared write core, atomically with closing the session.
 * NOTE: plain Postgres only; Citus-specific behaviour is not exercised.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant } from '../../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import {
  StopwatchError,
  discardSession,
  logSession,
  pauseSession,
  resumeSession,
  startSession,
  getSession,
} from '../../../../../packages/scheduling/src/lib/stopwatch/stopwatchCore';
import { TimeSheetResolutionError } from '../../../../../packages/scheduling/src/actions/timeSheetActionErrors';
import {
  createPeriod,
  createSheet,
  createStopwatchUser,
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

let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const requireMockUser = () => {
    if (!mockCurrentUser) {
      throw new Error('User not authenticated');
    }
    return mockCurrentUser;
  };
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      if (!user) return action(null, null, ...args);
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withAuthCheck: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      return action(user, ...args);
    },
  };
});

vi.mock('@alga-psa/users/actions', async () => ({
  getCurrentUser: vi.fn(async () => mockCurrentUser),
}));

vi.mock('@alga-psa/user-composition/actions', async () => ({
  getCurrentUser: vi.fn(async () => mockCurrentUser),
}));

let db: Knex;
let tenantId: string;
let periodId: string;
let bucket: BucketSeed;
let saveTimeEntry: any;
let actor: any;

const T0 = new Date('2026-10-05T09:00:20.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const inTrx = <T>(fn: (trx: Knex.Transaction) => Promise<T>) => db.transaction(fn);

async function entriesFor(user: string) {
  return tenantDb(db, tenantId).table('time_entries').where({ user_id: user });
}

async function bucketMinutes(): Promise<number> {
  const row = await tenantDb(db, tenantId).table('bucket_usage')
    .where({ client_id: bucket.clientId, bucket_id: bucket.bucketId })
    .sum<{ total: string | null }>('minutes_used as total')
    .first();
  return Number(row?.total ?? 0);
}

/** Start at T0, work 30m, pause 60m, work 30m, end paused at T0+120m => 60 active minutes. */
async function seedPausedSession(user: string, ticketId = bucket.ticketId, serviceId: string | null = bucket.serviceId) {
  const started = await inTrx((trx) =>
    startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticketId, serviceId, notes: 'from the stopwatch' }, { now: at(0) }));
  await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id, { now: at(30) }));
  await inTrx((trx) => resumeSession(trx, tenantId, user, started.session_id, { now: at(90) }));
  await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id, { now: at(120) }));
  return started.session_id;
}

async function freshUser(label: string) {
  const user = await createStopwatchUser(db, tenantId, label);
  const sheet = await createSheet(db, tenantId, periodId, user);
  return { user, sheet, actor: { ...actor, user_id: user } };
}

describe('stopwatch log (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Stopwatch log tenant');
    periodId = await createPeriod(db, tenantId, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    bucket = await seedBucketClient(db, tenantId);
    actor = { tenant: tenantId, user_type: 'internal' };
    ({ saveTimeEntry } = await import('@alga-psa/scheduling/actions/timeEntryActions'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('logs a paused session as one entry anchored on the first start, with sheet and bucket draw', async () => {
    const fx = await freshUser('sw-log-main');
    const userId = fx.user;
    const sheetId = fx.sheet;
    const sessionId = await seedPausedSession(userId);
    const bucketBefore = await bucketMinutes();

    const { session, persisted } = await inTrx((trx) =>
      logSession(trx, tenantId, fx.actor, sessionId, {}, { now: at(121) }));

    const rows = await entriesFor(userId);
    expect(rows).toHaveLength(1);
    const entry = rows[0];
    expect(new Date(entry.start_time).toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect(new Date(entry.end_time).toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(Number(entry.billable_duration)).toBe(60);
    expect(entry.time_sheet_id).toBe(sheetId);
    expect(entry.service_id).toBe(bucket.serviceId);
    expect(entry.notes).toBe('from the stopwatch');
    expect(entry.work_item_id).toBe(bucket.ticketId);
    expect((await bucketMinutes()) - bucketBefore).toBe(60);

    expect(persisted.entry.entry_id).toBe(entry.entry_id);
    expect(session.status).toBe('logged');
    expect(session.time_entry_id).toBe(entry.entry_id);
    expect(session.closed_at).toBe(at(121).toISOString());
  });

  it('pauses a running session as part of logging it', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-running');
    const sheet = await createSheet(db, tenantId, periodId, user);
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: bucket.ticketId, serviceId: bucket.serviceId }, { now: at(0) }));
    const { session } = await inTrx((trx) =>
      logSession(trx, tenantId, { ...actor, user_id: user }, started.session_id, {}, { now: at(45) }));
    expect(session.segments.every((s: any) => s.ended_at !== null)).toBe(true);
    const [entry] = await entriesFor(user);
    expect(Number(entry.billable_duration)).toBe(45);
    expect(entry.time_sheet_id).toBe(sheet);
  });

  it('caller values win over the session-derived ones', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-override');
    await createSheet(db, tenantId, periodId, user);
    const sessionId = await seedPausedSession(user, bucket.ticketId, null);
    await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, sessionId, {
      service_id: bucket.serviceId,
      notes: 'drawer notes',
      start_time: '2026-10-05T14:00:00.000Z',
      end_time: '2026-10-05T15:30:00.000Z',
    }, { now: at(121) }));
    const [entry] = await entriesFor(user);
    expect(entry.notes).toBe('drawer notes');
    expect(new Date(entry.start_time).toISOString()).toBe('2026-10-05T14:00:00.000Z');
    expect(Number(entry.billable_duration)).toBe(90);
    // A non-billable log forces zero minutes.
    const user2 = await createStopwatchUser(db, tenantId, 'sw-log-nonbill');
    await createSheet(db, tenantId, periodId, user2);
    const s2 = await seedPausedSession(user2);
    await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user2 }, s2, { is_billable: false }, { now: at(121) }));
    expect(Number((await entriesFor(user2))[0].billable_duration)).toBe(0);
  });

  it('requires a service, and logging twice never creates a second entry', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-twice');
    await createSheet(db, tenantId, periodId, user);
    const noService = await seedPausedSession(user, bucket.ticketId, null);
    const failure = await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, noService, {}, { now: at(121) }))
      .then(() => null, (e) => e);
    expect(failure?.message).toContain('serviceRequired');
    expect(await entriesFor(user)).toHaveLength(0);

    await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, noService, { service_id: bucket.serviceId }, { now: at(121) }));
    const second = await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, noService, { service_id: bucket.serviceId }))
      .then(() => null, (e) => e);
    expect((second as StopwatchError).kind).toBe('notOpen');
    expect(await entriesFor(user)).toHaveLength(1);
  });

  it('a locked sheet is an expected error, writes nothing, and leaves the session paused', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-locked');
    const sheet = await createSheet(db, tenantId, periodId, user, 'SUBMITTED');
    const sessionId = await seedPausedSession(user);

    const error = await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, sessionId, {}, { now: at(121) }))
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(TimeSheetResolutionError);
    expect(error.expected.actionError).toContain('Submitted');

    expect(await entriesFor(user)).toHaveLength(0);
    const after = await inTrx((trx) => getSession(trx, tenantId, user, sessionId, { now: at(130) }));
    expect(after?.status).toBe('paused');
    expect(after?.time_entry_id).toBeNull();
    expect(after?.active_ms).toBe(60 * 60_000);

    // Once the sheet is editable again the same session logs fine.
    await tenantDb(db, tenantId).table('time_sheets').where({ id: sheet }).update({ approval_status: 'CHANGES_REQUESTED' });
    await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, sessionId, {}, { now: at(131) }));
    expect(await entriesFor(user)).toHaveLength(1);
  });

  it('no period covering the work date is an expected error too', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-noperiod');
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: bucket.ticketId, serviceId: bucket.serviceId },
        { now: new Date('2027-03-03T09:00:00Z') }));
    const error = await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, started.session_id, {}, { now: new Date('2027-03-03T10:00:00Z') }))
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(TimeSheetResolutionError);
    expect(error.expected.messageKey).toBe('msp/time-entry:workItemEntry.save.noPeriod');
  });

  it('saveTimeEntry with stopwatch_session_id writes the entry and closes the session together; drawer values win', async () => {
    const fx = await freshUser('sw-log-save');
    const userId = fx.user;
    const sheetId = fx.sheet;
    mockCurrentUser = fx.actor;
    const sessionId = await seedPausedSession(userId);
    const before = (await entriesFor(userId)).length;

    const saved = await saveTimeEntry({
      entry_id: null,
      stopwatch_session_id: sessionId,
      work_item_id: bucket.ticketId,
      work_item_type: 'ticket',
      start_time: '2026-10-05T09:00:00.000Z',
      end_time: '2026-10-05T10:15:00.000Z',
      created_at: '2026-10-05T10:15:00.000Z',
      updated_at: '2026-10-05T10:15:00.000Z',
      billable_duration: 75,
      notes: 'drawer wins',
      user_id: userId,
      time_sheet_id: sheetId,
      approval_status: 'DRAFT',
      service_id: bucket.serviceId,
    });
    expect(saved.actionError).toBeUndefined();
    expect(saved.entry_id).toBeTruthy();
    expect(Number(saved.billable_duration)).toBe(75);

    expect(await entriesFor(userId)).toHaveLength(before + 1);
    const session = await inTrx((trx) => getSession(trx, tenantId, userId, sessionId));
    expect(session?.status).toBe('logged');
    expect(session?.time_entry_id).toBe(saved.entry_id);
    expect(session?.notes).toBe('drawer wins');
  });

  it('saveTimeEntry rolls everything back when the session is not the caller\'s open session', async () => {
    const fx = await freshUser('sw-log-caller');
    const userId = fx.user;
    const sheetId = fx.sheet;
    mockCurrentUser = fx.actor;
    const other = await freshUser('sw-log-owner');
    const otherUserId = other.user;
    const foreign = await seedPausedSession(otherUserId);
    const before = (await entriesFor(userId)).length;

    const result = await saveTimeEntry({
      entry_id: null,
      stopwatch_session_id: foreign,
      work_item_id: bucket.ticketId,
      work_item_type: 'ticket',
      start_time: '2026-10-06T09:00:00.000Z',
      end_time: '2026-10-06T10:00:00.000Z',
      created_at: '2026-10-06T10:00:00.000Z',
      updated_at: '2026-10-06T10:00:00.000Z',
      billable_duration: 60,
      notes: 'should not persist',
      user_id: userId,
      time_sheet_id: sheetId,
      approval_status: 'DRAFT',
      service_id: bucket.serviceId,
    });
    expect(result.actionError).toBeTruthy();
    expect(result.messageKey).toBe('msp/time-entry:errors.stopwatch.notFound');
    expect(await entriesFor(userId)).toHaveLength(before);
    const session = await inTrx((trx) => getSession(trx, tenantId, otherUserId, foreign));
    expect(session?.status).toBe('paused');
  });

  it('saveTimeEntry on a locked sheet leaves the session untouched', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-save-locked');
    const locked = await createSheet(db, tenantId, periodId, user, 'APPROVED');
    const sessionId = await seedPausedSession(user);
    mockCurrentUser = { ...actor, user_id: user };
    try {
      const result = await saveTimeEntry({
        entry_id: null,
        stopwatch_session_id: sessionId,
        work_item_id: bucket.ticketId,
        work_item_type: 'ticket',
        start_time: '2026-10-05T09:00:00.000Z',
        end_time: '2026-10-05T10:00:00.000Z',
        created_at: '2026-10-05T10:00:00.000Z',
        updated_at: '2026-10-05T10:00:00.000Z',
        billable_duration: 60,
        notes: 'locked',
        user_id: user,
        time_sheet_id: locked,
        approval_status: 'DRAFT',
        service_id: bucket.serviceId,
      });
      expect(result.actionError).toBeTruthy();
    } finally {
      mockCurrentUser = actor;
    }
    expect(await entriesFor(user)).toHaveLength(0);
    const session = await inTrx((trx) => getSession(trx, tenantId, user, sessionId));
    expect(session?.status).toBe('paused');
  });

  it('a discarded session cannot be logged', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-log-discarded');
    const sessionId = await seedPausedSession(user);
    await inTrx((trx) => discardSession(trx, tenantId, user, sessionId));
    const error = await inTrx((trx) => logSession(trx, tenantId, { ...actor, user_id: user }, sessionId, { service_id: bucket.serviceId }))
      .then(() => null, (e) => e);
    expect((error as StopwatchError).kind).toBe('notOpen');
  });
});
