/**
 * Work trail (plan sections D13-D15, 11) against a real database: real ticket_audit_logs rows
 * (written through writeTicketActivity) become per-ticket-per-day suggestions; a logged entry, an open
 * stopwatch session or a dismissal hides them; only the owner or an allowed delegate may read or dismiss.
 * NOTE: plain Postgres only; Citus-specific behaviour is not exercised.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { writeTicketActivity } from '../../../../shared/lib/ticketActivity/writeTicketActivity';
import { TICKET_ACTIVITY_EVENT } from '../../../../shared/lib/ticketActivity/types';
import { createStopwatchUser, createTicket, grantPermissions } from './stopwatch/stopwatchTestSeed';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));
vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const hoisted = vi.hoisted(() => ({ tenant: '', userRow: null as any, db: null as any }));

// The global test setup stubs hasPermission to always allow; use the real RBAC so the delegate rules bite.
vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: (action: any) => async (...args: any[]) => action(hoisted.userRow, { tenant: hoisted.tenant }, ...args),
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: hoisted.db, tenant: hoisted.tenant }),
  };
});

import {
  dismissAllTimeEntrySuggestionsForDay,
  dismissTimeEntrySuggestion,
  getTimeEntrySuggestions,
} from '../../../../packages/scheduling/src/actions/workTrailActions';

let db: Knex;
let tenantId: string;
let owner: string;
let stranger: string;
let delegate: string;

const DAY = '2026-09-01';

async function actAs(userId: string) {
  const row = await tenantDb(db, tenantId).table('users').where({ user_id: userId }).first();
  hoisted.userRow = { ...row, tenant: tenantId };
}

async function touch(ticketId: string, actorUserId: string, iso: string, eventType: string = TICKET_ACTIVITY_EVENT.COMMENT_ADDED) {
  await writeTicketActivity(db, {
    tenant: tenantId,
    ticketId,
    eventType,
    entityType: 'ticket',
    entityId: ticketId,
    actor: { actorType: 'user', userId: actorUserId },
    source: 'ui',
    occurredAt: iso,
  });
}

async function suggestions(as: string, userId = owner, start = DAY, end = DAY) {
  await actAs(as);
  return getTimeEntrySuggestions({ userId, startDate: start, endDate: end });
}

describe('work trail actions (real DB)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    hoisted.db = db;
    tenantId = await createTenant(db, 'Work trail tenant');
    hoisted.tenant = tenantId;
    owner = await createStopwatchUser(db, tenantId, 'trail-owner');
    stranger = await createStopwatchUser(db, tenantId, 'trail-stranger');
    delegate = await createStopwatchUser(db, tenantId, 'trail-delegate');
    await grantPermissions(db, tenantId, delegate, [
      { resource: 'time_sheet', action: 'approve' },
      { resource: 'time_sheet', action: 'read_all' },
    ]);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('turns the owner\'s audit rows into one suggestion per ticket per day with display names', async () => {
    const t = await createTicket(db, tenantId);
    await touch(t.ticketId, owner, `${DAY}T09:12:00Z`);
    await touch(t.ticketId, owner, `${DAY}T11:40:00Z`, TICKET_ACTIVITY_EVENT.STATUS_CHANGED);
    await touch(t.ticketId, stranger, `${DAY}T12:00:00Z`); // someone else's work does not count
    // A non-user actor with the same id never counts.
    await writeTicketActivity(db, {
      tenant: tenantId, ticketId: t.ticketId, eventType: TICKET_ACTIVITY_EVENT.UPDATED, entityType: 'ticket',
      actor: { actorType: 'system', userId: owner }, source: 'system', occurredAt: `${DAY}T13:00:00Z`,
    });

    const result = await suggestions(owner);
    expect(Array.isArray(result)).toBe(true);
    const mine = (result as any[]).filter((s) => s.ticket_id === t.ticketId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      ticket_number: t.ticketNumber,
      title: t.title,
      work_date: DAY,
      event_count: 2,
      event_kinds: [TICKET_ACTIVITY_EVENT.COMMENT_ADDED, TICKET_ACTIVITY_EVENT.STATUS_CHANGED],
    });
    expect(mine[0].client_name).toBeTruthy();
    expect(new Date(mine[0].first_touch).toISOString()).toBe(`${DAY}T09:12:00.000Z`);
    expect(new Date(mine[0].last_touch).toISOString()).toBe(`${DAY}T11:40:00.000Z`);

    // The stranger's own trail is separate.
    const theirs = (await suggestions(stranger, stranger)) as any[];
    expect(theirs.find((s) => s.ticket_id === t.ticketId)?.event_count).toBe(1);
  });

  it('is hidden by a logged time entry for that ticket and day, but not for other days', async () => {
    const t = await createTicket(db, tenantId);
    await touch(t.ticketId, owner, `${DAY}T10:00:00Z`);
    await touch(t.ticketId, owner, '2026-09-02T10:00:00Z');
    await tenantDb(db, tenantId).table('time_entries').insert({
      tenant: tenantId, entry_id: randomUUID(), user_id: owner, work_item_type: 'ticket', work_item_id: t.ticketId,
      start_time: `${DAY}T10:00:00Z`, end_time: `${DAY}T10:30:00Z`, billable_duration: 30, notes: '',
      approval_status: 'DRAFT', work_date: DAY, work_timezone: 'UTC',
    });
    const result = (await suggestions(owner, owner, DAY, '2026-09-02')) as any[];
    expect(result.filter((s) => s.ticket_id === t.ticketId).map((s) => s.work_date)).toEqual(['2026-09-02']);
  });

  it('is hidden while an open stopwatch session exists on the ticket', async () => {
    const user = await createStopwatchUser(db, tenantId, 'trail-open');
    const t = await createTicket(db, tenantId);
    await touch(t.ticketId, user, `${DAY}T10:00:00Z`);
    expect(((await suggestions(user, user)) as any[]).some((s) => s.ticket_id === t.ticketId)).toBe(true);

    const sessionId = randomUUID();
    await tenantDb(db, tenantId).table('time_tracking_sessions').insert({
      tenant: tenantId, session_id: sessionId, user_id: user, work_item_type: 'ticket', work_item_id: t.ticketId, status: 'running',
    });
    expect(((await suggestions(user, user)) as any[]).some((s) => s.ticket_id === t.ticketId)).toBe(false);

    await tenantDb(db, tenantId).table('time_tracking_sessions').where({ session_id: sessionId }).update({ status: 'discarded', closed_at: new Date() });
    expect(((await suggestions(user, user)) as any[]).some((s) => s.ticket_id === t.ticketId)).toBe(true);
  });

  it('dismissal hides the suggestion idempotently and survives later activity', async () => {
    const t = await createTicket(db, tenantId);
    await touch(t.ticketId, owner, `${DAY}T10:00:00Z`);
    await actAs(owner);
    expect(await dismissTimeEntrySuggestion({ userId: owner, ticketId: t.ticketId, workDate: DAY })).toEqual({ dismissed: 1 });
    expect(await dismissTimeEntrySuggestion({ userId: owner, ticketId: t.ticketId, workDate: DAY })).toEqual({ dismissed: 1 });
    const rows = await tenantDb(db, tenantId).table('time_entry_suggestion_dismissals').where({ work_item_id: t.ticketId });
    expect(rows).toHaveLength(1);

    await touch(t.ticketId, owner, `${DAY}T16:00:00Z`);
    expect(((await suggestions(owner)) as any[]).some((s) => s.ticket_id === t.ticketId)).toBe(false);
  });

  it('dismiss-all-for-day dismisses every currently suggested ticket of that day only', async () => {
    const user = await createStopwatchUser(db, tenantId, 'trail-bulk');
    const a = await createTicket(db, tenantId);
    const b = await createTicket(db, tenantId);
    const other = await createTicket(db, tenantId);
    await touch(a.ticketId, user, `${DAY}T08:00:00Z`);
    await touch(b.ticketId, user, `${DAY}T09:00:00Z`);
    await touch(other.ticketId, user, '2026-09-02T09:00:00Z');
    await actAs(user);
    expect(await dismissAllTimeEntrySuggestionsForDay({ userId: user, workDate: DAY })).toEqual({ dismissed: 2 });
    const remaining = (await suggestions(user, user, DAY, '2026-09-02')) as any[];
    expect(remaining.map((s) => s.ticket_id)).toEqual([other.ticketId]);
  });

  it('only the owner or an allowed delegate may read or dismiss', async () => {
    const t = await createTicket(db, tenantId);
    await touch(t.ticketId, owner, '2026-09-03T10:00:00Z');

    const denied = await suggestions(stranger, owner, '2026-09-03', '2026-09-03');
    expect(denied).toMatchObject({ permissionError: expect.any(String) });
    await actAs(stranger);
    expect(await dismissTimeEntrySuggestion({ userId: owner, ticketId: t.ticketId, workDate: '2026-09-03' }))
      .toMatchObject({ permissionError: expect.any(String) });

    const viaDelegate = (await suggestions(delegate, owner, '2026-09-03', '2026-09-03')) as any[];
    expect(viaDelegate.map((s) => s.ticket_id)).toContain(t.ticketId);
  });
});
