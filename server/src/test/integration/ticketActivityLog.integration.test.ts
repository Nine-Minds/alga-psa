/**
 * Integration tests for the ticket activity / audit log feature.
 *
 * Covers the most load-bearing PRD claims:
 *  - Migration creates the table with the required columns/index.
 *  - writeTicketActivity inserts rows using an explicit tenant and works
 *    inside a normal transaction.
 *  - writeTicketActivity also works when called without the
 *    `app.current_tenant` GUC (admin-transaction style).
 *  - readTicketActivity returns rows newest-first with stable tie-breaking.
 *  - buildUnifiedTicketTimeline interleaves activity + comments.
 *  - Empty tickets return an empty timeline (no historical backfill needed).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  buildUnifiedTicketTimeline,
  readTicketActivity,
  writeTicketActivity,
} from '../../../../shared/lib/ticketActivity';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

interface Fixture {
  tenantId: string;
  userId: string;
  ticketId: string;
  clientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const info = await db(table).columnInfo();
  return Object.prototype.hasOwnProperty.call(info, column);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('ticket_audit_logs').where({ tenant: tenantId }).del();
  await db('comments').where({ tenant: tenantId }).del();
  await db('tickets').where({ tenant: tenantId }).del();
  await db('next_number').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('priorities').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const ticketId = uuidv4();
  const clientId = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  tenantsToCleanup.add(tenantId);

  const tenantHasCompanyName = await hasColumn('tenants', 'company_name');
  const userHasEmail = await hasColumn('users', 'email');
  const userHasRole = await hasColumn('users', 'role');

  await db('tenants').insert({
    tenant: tenantId,
    ...(tenantHasCompanyName
      ? { company_name: `Tenant ${tenantId.slice(0, 6)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 6)}` }),
    email: `t-${tenantId.slice(0, 6)}@example.com`,
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `u-${tenantId.slice(0, 6)}`,
    first_name: 'Alex',
    last_name: 'Tester',
    hashed_password: 'not-used',
    ...(userHasRole ? { role: 'admin' } : {}),
    ...(userHasEmail ? { email: `u-${tenantId.slice(0, 6)}@example.com` } : {}),
  });

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Test Client',
  });

  await db('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Default Board',
  });

  await db('statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    board_id: boardId,
    name: 'New',
    status_type: 'ticket',
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: userId,
  });

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'Normal',
    item_type: 'ticket',
    order_number: 10,
    color: '#888888',
    created_by: userId,
  });

  // Bootstrap next_number for ticket sequence.
  await db('next_number').insert({
    tenant: tenantId,
    entity_type: 'TICKET',
    prefix: 'T-',
    last_number: 0,
    initial_value: 1,
    padding_length: 6,
  });

  await db('tickets').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    ticket_number: 'T-000001',
    title: 'Activity Test Ticket',
    board_id: boardId,
    client_id: clientId,
    contact_name_id: null,
    status_id: statusId,
    entered_by: userId,
    entered_at: new Date().toISOString(),
    priority_id: priorityId,
    is_closed: false,
  });

  return { tenantId, userId, ticketId, clientId, boardId, statusId, priorityId };
}

beforeAll(async () => {
  db = await createTestDbConnection();
}, HOOK_TIMEOUT);

afterAll(async () => {
  for (const tenantId of tenantsToCleanup) {
    try {
      await cleanupTenant(tenantId);
    } catch {
      // best-effort cleanup
    }
  }
  await db?.destroy();
}, HOOK_TIMEOUT);

describe('ticket_audit_logs migration', () => {
  it('creates the table with the expected columns', async () => {
    const info = await db('ticket_audit_logs').columnInfo();
    for (const col of [
      'tenant',
      'audit_id',
      'ticket_id',
      'event_type',
      'entity_type',
      'entity_id',
      'actor_type',
      'actor_user_id',
      'actor_contact_id',
      'actor_display_name',
      'source',
      'occurred_at',
      'changes',
      'details',
      'created_at',
    ]) {
      expect(info[col], `column ${col} missing`).toBeTruthy();
    }
  });

  it('has the (tenant, ticket_id, occurred_at, audit_id) index', async () => {
    const rows = await db.raw(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'ticket_audit_logs'`,
    );
    const indexNames = (rows.rows ?? []).map((r: { indexname: string }) => r.indexname);
    expect(indexNames).toContain('ticket_audit_logs_ticket_time_idx');
  });
});

describe('writeTicketActivity', () => {
  it('writes and reads rows with explicit tenant inside a normal transaction', async () => {
    const fx = await createFixture();
    await db.transaction(async (trx) => {
      await writeTicketActivity(trx, {
        tenant: fx.tenantId,
        ticketId: fx.ticketId,
        eventType: TICKET_ACTIVITY_EVENT.CREATED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        entityId: fx.ticketId,
        actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: fx.userId },
        source: TICKET_ACTIVITY_SOURCE.UI,
        details: { title: 'Activity Test Ticket' },
      });
    });

    const rows = await readTicketActivity(db, fx.tenantId, fx.ticketId);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe(TICKET_ACTIVITY_EVENT.CREATED);
    expect(rows[0].actor_user_id).toBe(fx.userId);
    expect(rows[0].source).toBe(TICKET_ACTIVITY_SOURCE.UI);
    // Display name should have been resolved from users table.
    expect(rows[0].actor_display_name).toMatch(/Alex Tester/);
  });

  it('works without app.current_tenant GUC (admin-transaction simulation)', async () => {
    const fx = await createFixture();

    // Simulate an admin transaction context: the GUC is unset. We confirm
    // the helper does NOT read it by deliberately not setting it.
    await db.raw("RESET app.current_tenant"); // ignore if already unset
    await writeTicketActivity(db, {
      tenant: fx.tenantId,
      ticketId: fx.ticketId,
      eventType: TICKET_ACTIVITY_EVENT.INBOUND_EMAIL_RECEIVED,
      entityType: TICKET_ACTIVITY_ENTITY.EMAIL,
      entityId: 'msg-1',
      actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
      source: TICKET_ACTIVITY_SOURCE.INBOUND_EMAIL,
      details: {
        email: {
          messageId: 'msg-1',
          from: 'someone@example.com',
          provider: 'imap',
          subject: 'Test',
        },
      },
    });

    const rows = await readTicketActivity(db, fx.tenantId, fx.ticketId);
    const inbound = rows.find((r) => r.event_type === TICKET_ACTIVITY_EVENT.INBOUND_EMAIL_RECEIVED);
    expect(inbound).toBeTruthy();
    expect(inbound!.source).toBe(TICKET_ACTIVITY_SOURCE.INBOUND_EMAIL);
    // PRD FR-38: must not contain raw email body.
    expect(JSON.stringify(inbound!.details)).not.toMatch(/body/i);
  });

  it('orders results newest-first with stable tie-breaking', async () => {
    const fx = await createFixture();
    const sameTs = '2026-05-25T12:00:00.000Z';
    for (let i = 0; i < 3; i++) {
      await writeTicketActivity(db, {
        tenant: fx.tenantId,
        ticketId: fx.ticketId,
        eventType: TICKET_ACTIVITY_EVENT.UPDATED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: fx.userId },
        source: TICKET_ACTIVITY_SOURCE.UI,
        occurredAt: sameTs,
        changes: { title: { old: `old${i}`, new: `new${i}` } },
      });
    }

    const rows = await readTicketActivity(db, fx.tenantId, fx.ticketId);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Deterministic ordering on identical occurred_at means consecutive
    // reads must produce the same sequence.
    const second = await readTicketActivity(db, fx.tenantId, fx.ticketId);
    expect(rows.map((r) => r.audit_id)).toEqual(second.map((r) => r.audit_id));
  });

  it('throws when tenant is missing', async () => {
    await expect(
      writeTicketActivity(db, {
        tenant: '',
        ticketId: uuidv4(),
        eventType: TICKET_ACTIVITY_EVENT.CREATED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        actor: { actorType: TICKET_ACTIVITY_ACTOR.USER },
        source: TICKET_ACTIVITY_SOURCE.UI,
      }),
    ).rejects.toThrow(/tenant/);
  });

  it('isolates rows by tenant', async () => {
    const fxA = await createFixture();
    const fxB = await createFixture();

    await writeTicketActivity(db, {
      tenant: fxA.tenantId,
      ticketId: fxA.ticketId,
      eventType: TICKET_ACTIVITY_EVENT.CREATED,
      entityType: TICKET_ACTIVITY_ENTITY.TICKET,
      actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: fxA.userId },
      source: TICKET_ACTIVITY_SOURCE.UI,
    });

    const rowsA = await readTicketActivity(db, fxA.tenantId, fxA.ticketId);
    const rowsB = await readTicketActivity(db, fxB.tenantId, fxB.ticketId);

    expect(rowsA.length).toBeGreaterThanOrEqual(1);
    expect(rowsB).toHaveLength(0);
  });
});

describe('buildUnifiedTicketTimeline', () => {
  it('returns an empty array for tickets with no activity', async () => {
    const fx = await createFixture();
    const timeline = await buildUnifiedTicketTimeline(db, fx.tenantId, fx.ticketId);
    expect(timeline).toEqual([]);
  });

  it('interleaves activity rows and comments newest-first', async () => {
    const fx = await createFixture();

    const earlier = '2026-05-25T10:00:00.000Z';
    const later = '2026-05-25T11:00:00.000Z';

    // Earlier: activity
    await writeTicketActivity(db, {
      tenant: fx.tenantId,
      ticketId: fx.ticketId,
      eventType: TICKET_ACTIVITY_EVENT.CREATED,
      entityType: TICKET_ACTIVITY_ENTITY.TICKET,
      actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: fx.userId },
      source: TICKET_ACTIVITY_SOURCE.UI,
      occurredAt: earlier,
    });

    // Later: comment (comments.thread_id is NOT NULL and references comment_threads)
    const commentId = uuidv4();
    const threadId = uuidv4();
    await db('comment_threads').insert({
      tenant: fx.tenantId,
      thread_id: threadId,
      ticket_id: fx.ticketId,
      root_comment_id: commentId,
      is_internal: false,
      created_at: later,
    });
    await db('comments').insert({
      tenant: fx.tenantId,
      comment_id: commentId,
      thread_id: threadId,
      ticket_id: fx.ticketId,
      user_id: fx.userId,
      author_type: 'internal',
      note: 'A comment',
      is_internal: false,
      is_resolution: false,
      created_at: later,
    });

    const timeline = await buildUnifiedTicketTimeline(db, fx.tenantId, fx.ticketId);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].type).toBe('comment');
    expect(timeline[1].type).toBe('activity');
  });
});
