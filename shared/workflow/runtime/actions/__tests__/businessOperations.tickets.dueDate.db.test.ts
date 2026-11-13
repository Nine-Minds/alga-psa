import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from './_dbTestUtils';
import { useNativeCoManagedVerdict } from './helpers/nativeCoManagedVerdict';

/**
 * tickets.find returns due_date, ticket_origin and recurrence; tickets.update_fields writes the due_date
 * column and mirrors it into attributes.due_date for workflows written before the backfill. Real tickets, occurrence rows and TicketModel; only the tenant
 * transaction, permissions, audit capture and event publishing are stubbed.
 */
const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  audits: [] as Array<Record<string, any>>,
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) throw new Error('DB unavailable for test runtime state');
      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({ tenantId: runtimeState.tenantId, actorUserId: runtimeState.actorUserId, trx });
      });
    },
    requirePermission: async () => undefined,
    writeRunAudit: async (_ctx: any, _tx: any, entry: Record<string, any>) => { runtimeState.audits.push(entry); },
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTicketActions } from '../businessOperations/tickets';

function ctx() {
  return {
    runId: uuidv4(), stepPath: 'steps.ticket-action', idempotencyKey: uuidv4(), attempt: 1,
    nowIso: () => new Date().toISOString(), env: {}, tenantId: runtimeState.tenantId,
  } as any;
}

async function invoke(actionId: string, input: Record<string, unknown>) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action.handler(action.inputSchema.parse(input), ctx());
}

describe('tickets actions: due date and recurring provenance (DB-backed)', () => {
  let db: Knex;
  let clientId: string;
  let boardId: string;
  let statusId: string;

  useNativeCoManagedVerdict();

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    const tenantRow = await db('tenants').first('tenant');
    runtimeState.tenantId = String(tenantRow.tenant);
    const user = await db('users').where({ tenant: runtimeState.tenantId }).first('user_id');
    runtimeState.actorUserId = String(user.user_id);
    registerTicketActions();

    clientId = uuidv4();
    await db('clients').insert({ tenant: runtimeState.tenantId, client_id: clientId, client_name: 'Due date action client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
    boardId = uuidv4();
    await db('boards').insert({ tenant: runtimeState.tenantId, board_id: boardId, board_name: 'Action board', display_order: 0 });
    statusId = uuidv4();
    await db('statuses').insert({ tenant: runtimeState.tenantId, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
  }, 900_000);

  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { runtimeState.audits.length = 0; });

  async function makeTicket(extra: Record<string, unknown> = {}) {
    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: runtimeState.tenantId, ticket_id: ticketId, ticket_number: `ACT-${ticketId.slice(0, 8)}`, title: 'Action ticket',
      board_id: boardId, status_id: statusId, client_id: clientId, entered_at: '2026-01-01T00:00:00Z', ...extra,
    });
    return ticketId;
  }

  const columnDue = async (ticketId: string) => {
    const row = await db('tickets').where({ tenant: runtimeState.tenantId, ticket_id: ticketId }).first('due_date', 'attributes');
    return { due: row.due_date ? new Date(row.due_date).toISOString() : null, attributes: row.attributes };
  };

  it('tickets.find returns due_date, ticket_origin and recurrence for a recurring ticket with a created occurrence', async () => {
    const dueAt = '2027-01-08T17:00:00.000Z';
    const ticketId = await makeTicket({ due_date: dueAt, ticket_origin: 'recurring', source: 'recurring_ticket' });
    const definitionId = uuidv4();
    const definitionClientId = uuidv4();
    const occurrenceId = uuidv4();
    const tenant = runtimeState.tenantId;
    await db('recurring_ticket_definitions').insert({ tenant, definition_id: definitionId, name: 'Renewal', title_template: 'Renewal', board_id: boardId, priority_id: uuidv4(), recurrence: JSON.stringify({ frequency: 'yearly' }), start_date: '2026-01-01' });
    await db('recurring_ticket_definition_clients').insert({ tenant, definition_client_id: definitionClientId, definition_id: definitionId, client_id: clientId, evaluated_through: '2026-01-01T00:00:00Z' });
    await db('recurring_ticket_occurrences').insert({
      tenant, occurrence_id: occurrenceId, definition_id: definitionId, definition_client_id: definitionClientId, client_id: clientId,
      occurrence_date: '2027-01-08', due_date: '2027-01-08', create_at: '2026-11-09T00:00:00Z', due_at: dueAt, status: 'created', ticket_id: ticketId,
    });

    const out = await invoke('tickets.find', { ticket_id: ticketId });
    expect(out.ticket).toMatchObject({
      ticket_id: ticketId, due_date: dueAt, ticket_origin: 'recurring',
      recurrence: { definition_id: definitionId, occurrence_id: occurrenceId, occurrence_date: '2027-01-08' },
    });
  });

  it('tickets.find returns recurrence null for a non-recurring ticket, and a null due date when none is set', async () => {
    const withDue = await makeTicket({ due_date: '2027-03-01T10:00:00.000Z' });
    const without = await makeTicket();
    const a = await invoke('tickets.find', { ticket_id: withDue });
    expect(a.ticket).toMatchObject({ due_date: '2027-03-01T10:00:00.000Z', recurrence: null });
    expect(a.ticket.ticket_origin).toBeTruthy();
    expect(a.ticket.ticket_origin).not.toBe('recurring');
    const b = await invoke('tickets.find', { ticket_id: without });
    expect(b.ticket).toMatchObject({ due_date: null, recurrence: null });
  });

  it('tickets.update_fields writes the due_date column, mirrors attributes.due_date, and reports before/after', async () => {
    const ticketId = await makeTicket({ attributes: JSON.stringify({ keep: 'me' }) });

    const out = await invoke('tickets.update_fields', { ticket_id: ticketId, patch: { due_date: '2027-05-05T12:00:00.000Z' } });
    expect(out.due_date).toBe('2027-05-05T12:00:00.000Z');
    const after = await columnDue(ticketId);
    expect(after.due).toBe('2027-05-05T12:00:00.000Z');
    // Other attributes survive; the attribute mirrors the column for workflows that still read it.
    expect(after.attributes).toEqual({ keep: 'me', due_date: '2027-05-05T12:00:00.000Z' });

    const audit = runtimeState.audits.find((entry) => entry.operation === 'workflow_action:tickets.update_fields');
    expect(audit?.changedData.before.due_date).toBeNull();
    expect(audit?.changedData.after.due_date).toBe('2027-05-05T12:00:00.000Z');

    // The new value is what tickets.find (and so the date trigger) sees.
    expect((await invoke('tickets.find', { ticket_id: ticketId })).ticket.due_date).toBe('2027-05-05T12:00:00.000Z');
  });

  it('tickets.update_fields clears the due date with null, and leaves it alone when the patch omits it', async () => {
    const ticketId = await makeTicket({ due_date: '2027-06-01T09:00:00.000Z' });

    await invoke('tickets.update_fields', { ticket_id: ticketId, patch: { title: 'Retitled' } });
    expect((await columnDue(ticketId)).due).toBe('2027-06-01T09:00:00.000Z');

    runtimeState.audits.length = 0;
    const out = await invoke('tickets.update_fields', { ticket_id: ticketId, patch: { due_date: null } });
    expect(out.due_date).toBeNull();
    expect((await columnDue(ticketId)).due).toBeNull();
    expect((await columnDue(ticketId)).attributes).toMatchObject({ due_date: null });
    const audit = runtimeState.audits.find((entry) => entry.operation === 'workflow_action:tickets.update_fields');
    expect(audit?.changedData.before.due_date).toBe('2027-06-01T09:00:00.000Z');
    expect(audit?.changedData.after.due_date).toBeNull();
  });
});
