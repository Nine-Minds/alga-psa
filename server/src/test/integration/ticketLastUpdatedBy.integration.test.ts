/**
 * Integration tests for "who last updated a ticket" (docs/plans/2026-10-07-ticket-last-updated-by.md).
 *
 * Covers the write side (every meaningful ticket write stamps updated_at/updated_by
 * server-side, system writes stamp NULL, browsers cannot forge either column) and
 * the list read side (latest_activity_actor from batched enrichment lookups).
 * The auto-close NULL stamp is asserted in autoCloseTickets.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));
vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));
vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));
vi.mock('@alga-psa/notifications', () => ({
  getEmailNotificationService: () => ({ sendNotification: vi.fn(async () => undefined) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import { tenantDb } from '@alga-psa/db';
import { TicketModel } from '../../../../shared/models/ticketModel';
import {
  createCloseRulesFixture,
  insertTicket,
  type CloseRulesFixture,
} from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;
let userA: any;
let userB: any;

const scoped = () => tenantDb(db, fixture.tenantId);
const getTicket = (ticketId: string) => scoped().table('tickets').where({ ticket_id: ticketId }).first();

function asUser(user: any) {
  userRef.user = {
    user_id: user.user_id,
    user_type: user.user_type ?? 'internal',
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
  };
}

async function createExtraUser(firstName: string, lastName: string) {
  const userId = uuidv4();
  const info = await db('users').columnInfo();
  await db('users').insert({
    tenant: fixture.tenantId,
    user_id: userId,
    username: `lub-${userId.slice(0, 8)}`,
    first_name: firstName,
    last_name: lastName,
    hashed_password: 'not-used',
    user_type: 'internal',
    ...(info.email ? { email: `lub-${userId.slice(0, 8)}@example.com` } : {}),
  });
  return { user_id: userId, user_type: 'internal', first_name: firstName, last_name: lastName, username: `lub-${userId.slice(0, 8)}` };
}

describe('ticket last-updated-by', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for last-updated-by integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
    userA = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };
    userB = await createExtraUser('Beatrice', 'Second');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('updateTicketWithCache stamps the acting user and DB time', async () => {
    const { updateTicketWithCache } = await import('../../../../packages/tickets/src/actions/optimizedTicketActions');
    const ticketId = await insertTicket(db, fixture, { updated_by: null, updated_at: '2020-01-01T00:00:00Z' });

    asUser(userB);
    const result = await updateTicketWithCache(ticketId, { title: 'Changed by B' });
    expect(result).toBe('success');

    const row = await getTicket(ticketId);
    expect(row.title).toBe('Changed by B');
    expect(row.updated_by).toBe(userB.user_id);
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  }, HOOK_TIMEOUT);

  it('ticketActions.updateTicket ignores a forged updated_by/updated_at', async () => {
    const { updateTicket } = await import('../../../../packages/tickets/src/actions/ticketActions');
    const ticketId = await insertTicket(db, fixture, { updated_by: null, updated_at: '2020-01-01T00:00:00Z' });

    asUser(userA);
    const forged = { title: 'Forged', updated_by: userB.user_id, updated_at: '1999-01-01T00:00:00.000Z' };
    const result = await updateTicket(ticketId, forged as any);
    expect(result).toBe('success');

    const row = await getTicket(ticketId);
    expect(row.updated_by).toBe(userA.user_id);
    expect(new Date(row.updated_at).getFullYear()).toBeGreaterThanOrEqual(2026);
  }, HOOK_TIMEOUT);

  it('TicketModel.updateTicket stores the workflow actor, and NULL for an inbound webhook update', async () => {
    const ticketId = await insertTicket(db, fixture, { updated_by: userA.user_id });

    await db.transaction(async (trx) => {
      await TicketModel.updateTicket(ticketId, { title: 'Workflow edit', updated_by: userB.user_id } as any, fixture.tenantId, trx);
    });
    expect((await getTicket(ticketId)).updated_by).toBe(userB.user_id);

    // Inbound webhook: no updated_by in the input and no userId parameter.
    await db.transaction(async (trx) => {
      await TicketModel.updateTicket(ticketId, { title: 'Webhook edit' } as any, fixture.tenantId, trx);
    });
    const row = await getTicket(ticketId);
    expect(row.title).toBe('Webhook edit');
    expect(row.updated_by).toBeNull();
  }, HOOK_TIMEOUT);

  it('list enrichment reports the actor for comment-won, update-won and created-only rows with batched lookups', async () => {
    const { getTicketsForList } = await import('../../../../packages/tickets/src/actions/optimizedTicketActions');
    const longAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const midAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();

    // Created only: updated_at within 1s of entered_at.
    const createdOnly = await insertTicket(db, fixture, { entered_at: longAgo, updated_at: longAgo, updated_by: null });
    // Update won: updated_at newer than everything, written by user B.
    const updateWon = await insertTicket(db, fixture, { entered_at: longAgo, updated_at: midAgo, updated_by: userB.user_id });
    // Comment won: newest published comment by user B is newer than updated_at.
    const commentWon = await insertTicket(db, fixture, { entered_at: longAgo, updated_at: midAgo, updated_by: userA.user_id });
    const commentId = uuidv4();
    const threadId = uuidv4();
    await scoped().table('comment_threads').insert({
      tenant: fixture.tenantId,
      thread_id: threadId,
      ticket_id: commentWon,
      root_comment_id: commentId,
      is_internal: false,
      created_at: recent,
    });
    await scoped().table('comments').insert({
      tenant: fixture.tenantId,
      comment_id: commentId,
      thread_id: threadId,
      ticket_id: commentWon,
      user_id: userB.user_id,
      author_type: 'internal',
      note: 'hello',
      is_internal: false,
      is_resolution: false,
      is_system_generated: false,
      publish_state: 'published',
      created_at: recent,
    });

    asUser(userA);
    const queries: string[] = [];
    const listener = (q: { sql: string }) => queries.push(q.sql);
    db.on('query', listener);
    let page: any;
    try {
      page = await getTicketsForList({ boardFilterState: 'all', boardIds: [fixture.boardId] } as any, 1, 100);
    } finally {
      db.removeListener('query', listener);
    }

    const byId = new Map<string, any>(page.tickets.map((t: any) => [t.ticket_id, t]));
    expect(byId.get(createdOnly).latest_activity_actor).toEqual({ kind: 'user', name: expect.any(String) });
    expect(byId.get(updateWon).latest_activity_actor).toEqual({ kind: 'user', name: 'Beatrice Second' });
    expect(byId.get(commentWon).latest_activity_actor).toEqual({ kind: 'user', name: 'Beatrice Second' });

    expect(queries.filter((sql) => /DISTINCT ON \(ticket_id\)/i.test(sql) && /from comments/i.test(sql))).toHaveLength(1);
  }, HOOK_TIMEOUT);
});
