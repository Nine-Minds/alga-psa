/**
 * Stopwatch core against a real database (plan section 11).
 * NOTE: runs on plain Postgres. Citus-only paths (shard-suffixed constraint names, distributed DDL)
 * are not exercised here (the unique-violation path matches the unsuffixed index name, which is what plain Postgres emits).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant } from '../../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import {
  StopwatchConflictError,
  StopwatchError,
  discardSession,
  getOpenSession,
  pauseSession,
  resumeSession,
  startSession,
  updateSessionDraft,
} from '../../../../../packages/scheduling/src/lib/stopwatch/stopwatchCore';
import { createBoard, createStopwatchUser, createTicket } from './stopwatchTestSeed';

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



let db: Knex;
let tenantId: string;
let userId: string;
let otherUserId: string;

const T0 = new Date('2026-10-05T09:00:20.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const MIN = 60_000;

const inTrx = <T>(fn: (trx: Knex.Transaction) => Promise<T>) => db.transaction(fn);

async function sessionRows(user: string) {
  return tenantDb(db, tenantId).table('time_tracking_sessions').where({ user_id: user });
}

describe('stopwatch core (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Stopwatch core tenant');
    userId = await createStopwatchUser(db, tenantId, 'sw-owner');
    otherUserId = await createStopwatchUser(db, tenantId, 'sw-other');
    mockCurrentUser = { user_id: userId, tenant: tenantId, user_type: 'internal' };
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('persists wall-clock across start / pause / resume and derives active time from segments', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-wall');
    const ticket = await createTicket(db, tenantId);

    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId, notes: 'draft' }, { now: at(0) }));
    expect(started.status).toBe('running');
    expect(started.segments).toHaveLength(1);
    expect(started.segments[0].started_at).toBe(at(0).toISOString());
    expect(started.segments[0].ended_at).toBeNull();
    expect(started.ticket_number).toBe(ticket.ticketNumber);
    expect(started.work_item_title).toBe(ticket.title);
    expect(started.client_name).toBeTruthy();

    const paused = await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id, { now: at(10) }));
    expect(paused.status).toBe('paused');
    expect(paused.segments[0].ended_at).toBe(at(10).toISOString());
    expect(paused.active_ms).toBe(10 * MIN);

    // Time while paused does not count, no matter how long we look at it later.
    const stillPaused = await inTrx((trx) => getOpenSession(trx, tenantId, user, { now: at(25) }));
    expect(stillPaused?.active_ms).toBe(10 * MIN);

    const resumed = await inTrx((trx) => resumeSession(trx, tenantId, user, started.session_id, { now: at(30) }));
    expect(resumed.status).toBe('running');
    expect(resumed.segments).toHaveLength(2);

    // A fresh read (new transaction, i.e. "another device") 15 minutes later: 10 + 15.
    const later = await inTrx((trx) => getOpenSession(trx, tenantId, user, { now: at(45) }));
    expect(later?.session_id).toBe(started.session_id);
    expect(later?.active_ms).toBe(25 * MIN);
    expect(later?.server_now).toBe(at(45).toISOString());
  });

  it('a second start returns a conflict carrying the open session and creates nothing', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-conflict');
    const ticketA = await createTicket(db, tenantId);
    const ticketB = await createTicket(db, tenantId);
    const first = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticketA.ticketId }, { now: at(0) }));

    const error = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticketB.ticketId }, { now: at(1) }))
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(StopwatchConflictError);
    expect((error as StopwatchConflictError).openSession.session_id).toBe(first.session_id);
    expect((error as StopwatchConflictError).openSession.ticket_number).toBe(ticketA.ticketNumber);
    expect(await sessionRows(user)).toHaveLength(1);

    // A paused session still blocks.
    await inTrx((trx) => pauseSession(trx, tenantId, user, first.session_id, { now: at(2) }));
    const again = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticketB.ticketId }, { now: at(3) }))
      .then(() => null, (e) => e);
    expect(again).toBeInstanceOf(StopwatchConflictError);
  });

  it('concurrent starts for one user create exactly one session (partial unique index)', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-race');
    const ticket = await createTicket(db, tenantId);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        inTrx((trx) => startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId }))),
    );

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(StopwatchConflictError);
    expect(await sessionRows(user)).toHaveLength(1);
    const segments = await tenantDb(db, tenantId).table('time_tracking_session_segments')
      .where({ session_id: (fulfilled[0] as PromiseFulfilledResult<any>).value.session_id });
    expect(segments).toHaveLength(1);
  });

  it('rejects the start when the ticket board has the stopwatch turned off, allows it when on or unset', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-board');
    const offBoard = await createBoard(db, tenantId, false);
    const onBoard = await createBoard(db, tenantId, true);
    const offTicket = await createTicket(db, tenantId, { boardId: offBoard });
    const onTicket = await createTicket(db, tenantId, { boardId: onBoard });
    const noBoardTicket = await createTicket(db, tenantId);

    const rejected = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: offTicket.ticketId }))
      .then(() => null, (e) => e);
    expect(rejected).toBeInstanceOf(StopwatchError);
    expect((rejected as StopwatchError).kind).toBe('boardDisabled');
    expect(await sessionRows(user)).toHaveLength(0);

    const ok = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: onTicket.ticketId }));
    await inTrx((trx) => discardSession(trx, tenantId, user, ok.session_id));
    await inTrx((trx) => startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: noBoardTicket.ticketId }));
  });

  it('rejects unknown work items and unsupported work item types', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-bad-item');
    const missing = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: uuidv4() })).then(() => null, (e) => e);
    expect((missing as StopwatchError).kind).toBe('workItemNotFound');
    const missingTask = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'project_task', workItemId: uuidv4() })).then(() => null, (e) => e);
    expect((missingTask as StopwatchError).kind).toBe('workItemNotFound');
    const adHoc = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ad_hoc', workItemId: null })).then(() => null, (e) => e);
    expect((adHoc as StopwatchError).kind).toBe('unsupportedWorkItem');
    // The legacy adapter may opt in.
    const legacy = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ad_hoc', workItemId: null }, { allowLegacyWorkItemTypes: true }));
    expect(legacy.work_item_type).toBe('ad_hoc');
    expect(await sessionRows(user)).toHaveLength(1);
  });

  it('discard closes the open segment, frees the user to start again, and is idempotent', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-discard');
    const ticket = await createTicket(db, tenantId);
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId }, { now: at(0) }));

    const discarded = await inTrx((trx) => discardSession(trx, tenantId, user, started.session_id, { now: at(7) }));
    expect(discarded.status).toBe('discarded');
    expect(discarded.closed_at).toBe(at(7).toISOString());
    expect(discarded.segments[0].ended_at).toBe(at(7).toISOString());
    expect(await inTrx((trx) => getOpenSession(trx, tenantId, user))).toBeNull();

    const again = await inTrx((trx) => discardSession(trx, tenantId, user, started.session_id, { now: at(9) }));
    expect(again.closed_at).toBe(at(7).toISOString());

    const closed = await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id)).then(() => null, (e) => e);
    expect((closed as StopwatchError).kind).toBe('notOpen');

    const next = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId }));
    expect(next.session_id).not.toBe(started.session_id);
  });

  it('pause and resume are idempotent and do not touch segments on a repeat', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-idem');
    const ticket = await createTicket(db, tenantId);
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId }, { now: at(0) }));

    const resumedRunning = await inTrx((trx) => resumeSession(trx, tenantId, user, started.session_id, { now: at(1) }));
    expect(resumedRunning.segments).toHaveLength(1);

    const first = await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id, { now: at(5) }));
    const second = await inTrx((trx) => pauseSession(trx, tenantId, user, started.session_id, { now: at(20) }));
    expect(second.status).toBe('paused');
    expect(second.segments).toEqual(first.segments);
    expect(second.segments[0].ended_at).toBe(at(5).toISOString());
    expect(second.active_ms).toBe(5 * MIN);
  });

  it('only the owner can act on a session; another user sees it as not found', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-owner2');
    const ticket = await createTicket(db, tenantId);
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId }));
    const foreign = await inTrx((trx) => pauseSession(trx, tenantId, otherUserId, started.session_id)).then(() => null, (e) => e);
    expect((foreign as StopwatchError).kind).toBe('notFound');
    const stillRunning = await inTrx((trx) => getOpenSession(trx, tenantId, user));
    expect(stillRunning?.status).toBe('running');
  });

  it('updates the draft notes and service on an open session only', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-draft');
    const ticket = await createTicket(db, tenantId);
    const started = await inTrx((trx) =>
      startSession(trx, tenantId, user, { workItemType: 'ticket', workItemId: ticket.ticketId, notes: 'a' }));
    const updated = await inTrx((trx) => updateSessionDraft(trx, tenantId, user, started.session_id, { notes: 'b' }));
    expect(updated.notes).toBe('b');
    expect(updated.service_id).toBeNull();
    await inTrx((trx) => discardSession(trx, tenantId, user, started.session_id));
    const closed = await inTrx((trx) => updateSessionDraft(trx, tenantId, user, started.session_id, { notes: 'c' }))
      .then(() => null, (e) => e);
    expect((closed as StopwatchError).kind).toBe('notOpen');
  });

  it('the database rejects two open sessions and two open segments even if application checks are bypassed', async () => {
    const user = await createStopwatchUser(db, tenantId, 'sw-constraints');
    const scoped = tenantDb(db, tenantId);
    const sessionId = uuidv4();
    await scoped.table('time_tracking_sessions').insert({ tenant: tenantId, session_id: sessionId, user_id: user, work_item_type: 'ticket', status: 'paused' });
    await expect(scoped.table('time_tracking_sessions').insert({
      tenant: tenantId, user_id: user, work_item_type: 'ticket', status: 'running',
    })).rejects.toMatchObject({ code: '23505' });
    await expect(scoped.table('time_tracking_sessions').insert({
      tenant: tenantId, user_id: user, work_item_type: 'ticket', status: 'bogus',
    })).rejects.toMatchObject({ code: '23514' });
    await scoped.table('time_tracking_session_segments').insert({ tenant: tenantId, session_id: sessionId, started_at: at(0), ended_at: null });
    await expect(scoped.table('time_tracking_session_segments').insert({
      tenant: tenantId, session_id: sessionId, started_at: at(1), ended_at: null,
    })).rejects.toMatchObject({ code: '23505' });
    await expect(scoped.table('time_tracking_session_segments').insert({
      tenant: tenantId, session_id: sessionId, started_at: at(5), ended_at: at(1),
    })).rejects.toMatchObject({ code: '23514' });
    // Deleting the session cascades to its segments.
    await scoped.table('time_tracking_sessions').where({ session_id: sessionId }).del();
    expect(await scoped.table('time_tracking_session_segments').where({ session_id: sessionId })).toHaveLength(0);
  });
});
