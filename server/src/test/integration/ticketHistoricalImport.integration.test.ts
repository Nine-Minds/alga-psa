/**
 * Historical ticket import through the REST service (alga-2026-0002678).
 * DB-backed. Run with the dev stack env:
 *   cd server && set -a && . ../.env.localtest && set +a && \
 *     npx vitest run src/test/integration/ticketHistoricalImport.integration.test.ts --coverage.enabled=false
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const state = vi.hoisted(() => ({
  db: null as any,
  published: [] as Array<{ eventType: string; payload: any }>,
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@alga-psa/event-bus/publishers');
  const record = async (event: { eventType: string; payload: any }) => {
    state.published.push({ eventType: event.eventType, payload: event.payload });
  };
  return {
    ...actual,
    publishEvent: vi.fn(record),
    publishBuiltWorkflowPayload: vi.fn(record),
    publishStoredWorkflowEvent: vi.fn(record),
    publishWorkflowEvent: vi.fn(async (p: { eventType: string; payload: any }) => record(p)),
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});

import { TicketService } from '../../lib/api/services/TicketService';
import { ValidationError } from '../../lib/api/middleware/apiMiddleware';

describe('historical ticket import via TicketService (integration)', () => {
  const HOOK_TIMEOUT = 180_000;
  let db: Knex;
  let tenantId: string;
  let clientId: string;
  let userId: string;
  let boardId: string;
  let openStatusId: string;
  let closedStatusId: string;
  let priorityId: string;
  let service: TicketService;
  const table = (name: string) => tenantDb(db, tenantId).table(name);
  const ctx = () => ({ tenant: tenantId, userId, user: { user_id: userId, user_type: 'internal' } }) as any;
  const body = (extra: Record<string, unknown> = {}) => ({
    title: 'Imported ticket',
    client_id: clientId,
    board_id: boardId,
    status_id: openStatusId,
    priority_id: priorityId,
    ...extra,
  }) as any;
  const eventTypes = () => state.published.map((e) => e.eventType);

  beforeAll(async () => {
    db = await createTestDbConnection();
    state.db = db;
    tenantId = await createTenant(db, 'Historical Import Tenant');
    clientId = await createClient(db, tenantId, 'Historical Import Client');
    userId = await createUser(db, tenantId, { first_name: 'Ida', last_name: 'Import', user_type: 'internal' });
    boardId = uuidv4();
    await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Hist Board' });
    openStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, board_id: boardId, status_id: openStatusId, name: 'Open', status_type: 'ticket', is_closed: false, order_number: 1,
    });
    closedStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, board_id: boardId, status_id: closedStatusId, name: 'Closed', status_type: 'ticket', is_closed: true, order_number: 100,
    });
    priorityId = uuidv4();
    await table('priorities').insert({
      tenant: tenantId, priority_id: priorityId, priority_name: 'Normal', color: '#808080', order_number: 1, created_by: userId,
    });
    service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    state.published.length = 0;
  });

  it('keeps a past entered_at, starts no SLA, and publishes no TICKET_CREATED', async () => {
    const created = await service.create(body({ entered_at: '2025-03-14T09:30:00Z' }), ctx());
    const row = await table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(new Date(row.entered_at).toISOString()).toBe('2025-03-14T09:30:00.000Z');
    expect(row.sla_policy_id).toBeNull();
    expect(row.sla_started_at).toBeNull();
    expect(row.is_closed ?? false).toBe(false);
    expect(eventTypes()).not.toContain('TICKET_CREATED');
    // The creation activity is back-dated too.
    const activity = await table('ticket_audit_logs').where({ ticket_id: created.ticket_id }).first();
    expect(activity).toBeTruthy();
    expect(new Date(activity.occurred_at).toISOString()).toBe('2025-03-14T09:30:00.000Z');
    expect(activity.details.historical_import).toBe(true);
  });

  it('a create without entered_at is unchanged: now, and TICKET_CREATED published', async () => {
    const created = await service.create(body(), ctx());
    const row = await table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(Date.now() - new Date(row.entered_at).getTime()).toBeLessThan(60_000);
    expect(eventTypes()).toContain('TICKET_CREATED');
  });

  it('stores a closed historical ticket as closed with closed_at and closed_by', async () => {
    const created = await service.create(
      body({ status_id: closedStatusId, entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-20T16:00:00Z' }),
      ctx(),
    );
    const row = await table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(row.is_closed).toBe(true);
    expect(new Date(row.closed_at).toISOString()).toBe('2025-03-20T16:00:00.000Z');
    expect(row.closed_by).toBe(userId);
    expect(eventTypes()).not.toContain('TICKET_CREATED');
    expect(eventTypes()).not.toContain('TICKET_CLOSED');
  });

  it('rejects a closed status without closed_at, and closed_at before entered_at', async () => {
    const missing = await service
      .create(body({ status_id: closedStatusId, entered_at: '2025-03-14T09:30:00Z' }), ctx())
      .catch((e) => e);
    expect(missing).toBeInstanceOf(ValidationError);
    expect(missing.details[0].path).toEqual(['closed_at']);
    const misordered = await service
      .create(
        body({ status_id: closedStatusId, entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-01T00:00:00Z' }),
        ctx(),
      )
      .catch((e) => e);
    expect(misordered).toBeInstanceOf(ValidationError);
    expect(misordered.details[0].path).toEqual(['closed_at']);
  });

  it('keeps comment created_at, orders by it, and publishes nothing', async () => {
    const ticket = await service.create(body({ entered_at: '2025-03-14T09:30:00Z' }), ctx());
    state.published.length = 0;

    const c1 = await service.addComment(
      ticket.ticket_id,
      { comment_text: 'first', is_internal: false, created_at: '2025-03-15T10:00:00Z' } as any,
      ctx(),
    );
    const c2 = await service.addComment(
      ticket.ticket_id,
      { comment_text: 'second', is_internal: false, created_at: '2025-03-16T10:00:00Z' } as any,
      ctx(),
    );
    const rows = await table('comments').where({ ticket_id: ticket.ticket_id }).orderBy('created_at', 'asc');
    expect(rows.map((r: any) => r.comment_id)).toEqual([c1.comment_id, c2.comment_id]);
    expect(new Date(rows[0].created_at).toISOString()).toBe('2025-03-15T10:00:00.000Z');
    expect(eventTypes()).not.toContain('TICKET_COMMENT_ADDED');
    // The publication intent lives on the comment row; a historical comment never gets one.
    for (const r of rows) {
      expect(r.comment_publication_payload).toBeNull();
      expect(r.scheduled_publish_event_id).toBeNull();
    }
    const ticketRow = await table('tickets').where({ ticket_id: ticket.ticket_id }).first();
    expect(ticketRow.response_state ?? null).toBeNull();
  });

  it('rejects a comment dated before the ticket entered_at', async () => {
    const ticket = await service.create(body({ entered_at: '2025-03-14T09:30:00Z' }), ctx());
    const error = await service
      .addComment(ticket.ticket_id, { comment_text: 'too early', is_internal: false, created_at: '2025-01-01T00:00:00Z' } as any, ctx())
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details[0].path).toEqual(['created_at']);
  });

  it('status endpoint honors a supplied closed_at on an open->closed crossing, and still emits TICKET_CLOSED', async () => {
    const ticket = await service.create(body({ entered_at: '2025-03-14T09:30:00Z' }), ctx());
    state.published.length = 0;
    await service.update(
      ticket.ticket_id,
      { status_id: closedStatusId, closed_at: '2025-04-01T12:00:00Z' } as any,
      ctx(),
    );
    const row = await table('tickets').where({ ticket_id: ticket.ticket_id }).first();
    expect(row.is_closed).toBe(true);
    expect(new Date(row.closed_at).toISOString()).toBe('2025-04-01T12:00:00.000Z');
    expect(eventTypes()).toContain('TICKET_CLOSED');
  });

  it('status endpoint rejects a closed_at before the ticket entered_at', async () => {
    const ticket = await service.create(body({ entered_at: '2025-03-14T09:30:00Z' }), ctx());
    const error = await service
      .update(ticket.ticket_id, { status_id: closedStatusId, closed_at: '2025-01-01T00:00:00Z' } as any, ctx())
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
  });
});
