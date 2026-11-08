import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const runtime = vi.hoisted(() => ({
  db: null as any,
  user: null as any,
  published: [] as Array<{ eventType: string; payload: any }>,
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    withAuth: (action: any) => async (...args: any[]) => {
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(runtime.user.tenant, () =>
        action(runtime.user, { tenant: runtime.user.tenant }, ...args),
      );
    },
    localizeActionError: async (result: unknown) => result,
  };
});

vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: runtime.db, tenant: runtime.user?.tenant }),
  };
});

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/event-bus/publishers')>();
  const capture = async (event: { eventType: string; payload: any }) => {
    runtime.published.push(event);
  };
  return {
    ...actual,
    publishEvent: vi.fn(capture),
    publishBuiltWorkflowPayload: vi.fn(capture),
    publishStoredWorkflowEvent: vi.fn(capture),
    publishWorkflowEvent: vi.fn(capture),
  };
});

import { importTickets } from '../../../../packages/tickets/src/actions/ticketImportActions';

describe('CSV historical ticket import with the real TicketModel', () => {
  let db: Knex;
  let tenantId: string;
  let clientId: string;
  let userId: string;
  let boardId: string;
  let boardWithoutClosedStatusId: string;
  let openStatusId: string;
  let closedStatusId: string;
  let priorityId: string;
  const table = (name: string) => tenantDb(db, tenantId).table(name);

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtime.db = db;
    tenantId = await createTenant(db, `CSV Historical ${uuidv4().slice(0, 8)}`);
    clientId = await createClient(db, tenantId, 'CSV Historical Client');
    userId = await createUser(db, tenantId, { first_name: 'CSV', last_name: 'Importer', user_type: 'internal' });
    boardId = uuidv4();
    await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Import Board', is_default: true });
    openStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, status_id: openStatusId, board_id: boardId, name: 'Open', status_type: 'ticket',
      item_type: 'ticket', order_number: 1, is_default: true, is_closed: false,
    });
    closedStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, status_id: closedStatusId, board_id: boardId, name: 'Closed', status_type: 'ticket',
      item_type: 'ticket', order_number: 100, is_default: false, is_closed: true,
    });
    boardWithoutClosedStatusId = uuidv4();
    await table('boards').insert({ tenant: tenantId, board_id: boardWithoutClosedStatusId, board_name: 'Open Only Board', is_default: false });
    await table('statuses').insert({
      tenant: tenantId, status_id: uuidv4(), board_id: boardWithoutClosedStatusId, name: 'Open Only', status_type: 'ticket',
      item_type: 'ticket', order_number: 1, is_default: true, is_closed: false,
    });
    priorityId = uuidv4();
    await table('priorities').insert({
      tenant: tenantId, priority_id: priorityId, priority_name: 'Normal', item_type: 'ticket',
      order_number: 1, color: '#808080', created_by: userId,
    });
    runtime.user = { user_id: userId, user_type: 'internal', tenant: tenantId };
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 180_000);

  beforeEach(() => {
    runtime.published.length = 0;
  });

  const closedHistoricalRow = (title = 'CSV imported closed history') => ({
    title,
    description: null,
    status_id: null,
    priority_id: priorityId,
    board_id: boardId,
    category_id: null,
    subcategory_id: null,
    client_id: clientId,
    contact_id: null,
    assigned_to: null,
    assigned_team_id: null,
    due_date: null,
    entered_at: '2025-03-14T09:30:00Z',
    closed_at: '2025-03-20T16:00:00Z',
    is_closed: true,
    tags: [],
    rowNumber: 17,
  });

  it('chooses a destination-board closed status and persists the historical row silently', async () => {
    expect(await db('statuses').where({ tenant: tenantId, status_id: closedStatusId }).first()).toMatchObject({
      board_id: boardId,
      status_type: 'ticket',
      is_closed: true,
    });
    const result = await importTickets(
      [closedHistoricalRow()] as any,
      [] as any,
      [] as any,
      [] as any,
      [] as any,
      [] as any,
      boardId,
    ) as any;

    expect(result).toMatchObject({ success: true, ticketsCreated: 1, errors: [] });
    const persisted = await table('tickets').where({ title: 'CSV imported closed history' }).first();
    expect(persisted).toMatchObject({
      source: 'csv_import',
      status_id: closedStatusId,
      is_closed: true,
      closed_by: userId,
    });
    expect(new Date(persisted.entered_at).toISOString()).toBe('2025-03-14T09:30:00.000Z');
    expect(new Date(persisted.closed_at).toISOString()).toBe('2025-03-20T16:00:00.000Z');
    expect(runtime.published.map((event) => event.eventType)).not.toContain('TICKET_CREATED');
    expect(runtime.published.map((event) => event.eventType)).not.toContain('TICKET_CLOSED');
  });

  it('returns a row-level setup error when the destination board has no closed status', async () => {
    const result = await importTickets(
      [{ ...closedHistoricalRow('CSV closed history without destination status'), board_id: boardWithoutClosedStatusId }] as any,
      [] as any,
      [] as any,
      [] as any,
      [] as any,
      [] as any,
      boardId,
    ) as any;

    expect(result.ticketsCreated).toBe(0);
    expect(result.ticketsSkipped).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining(`Row 17: Cannot import "CSV closed history without destination status" as closed because destination board ${boardWithoutClosedStatusId} has no closed ticket status`),
    ]);
    expect(await table('tickets').where({ title: 'CSV closed history without destination status' })).toHaveLength(0);
  });
});
