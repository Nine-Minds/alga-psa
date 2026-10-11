import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * The ticket-only service-request provider runs inside the portal submission's open
 * transaction. It must (a) keep a savepoint so a ticket failure does not abort the submission
 * transaction, and (b) publish TICKET_CREATED on the owning transaction after commit.
 */
let testDb: Knex;
type BusEvent = { eventType: string; payload: Record<string, any> };
const busEvents: BusEvent[] = [];

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async (event: any) => {
    busEvents.push({ eventType: event.eventType, payload: event.payload });
  }),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

describe('ticket-only execution provider transaction handling (integration)', () => {
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let requesterId: string;
  const created = () => busEvents.filter((e) => e.eventType === 'TICKET_CREATED');

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    tenant = await createTenant(testDb, `TicketOnly ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    requesterId = await createUser(testDb, tenant, { email: 'requester@example.com' });
    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Main', is_default: true });
    await scoped.table('statuses').insert({
      tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket',
      order_number: 1, is_default: true, is_closed: false,
    });
    await scoped.table('priorities').insert({
      tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: requesterId,
    });
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy().catch(() => undefined);
  });

  beforeEach(() => {
    busEvents.length = 0;
  });

  const context = (knex: Knex, config: Record<string, unknown>) => ({
    knex,
    tenant,
    definitionId: uuidv4(),
    definitionVersionId: uuidv4(),
    submissionId: uuidv4(),
    requesterUserId: requesterId,
    clientId,
    contactId: null,
    payload: {},
    config: { boardId, statusId, priorityId, ...config },
  });

  it('publishes TICKET_CREATED after the submission transaction commits', async () => {
    const { ticketOnlyExecutionProvider } = await import(
      '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider'
    );
    let result: any;
    await withTransaction(testDb, async (outer) => {
      result = await ticketOnlyExecutionProvider.execute(context(outer, {}) as any);
      expect(result.status).toBe('succeeded');
      expect(created()).toHaveLength(0); // deferred until the outer transaction commits
    });
    expect(created()).toHaveLength(1);
    expect(created()[0].payload).toMatchObject({ tenantId: tenant, ticketId: result.createdTicketId, userId: requesterId });
  });

  it('also publishes when the provider owns the transaction (plain Knex)', async () => {
    const { ticketOnlyExecutionProvider } = await import(
      '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider'
    );
    const result = await ticketOnlyExecutionProvider.execute(context(testDb, {}) as any);
    expect(result.status).toBe('succeeded');
    expect(created()).toHaveLength(1);
  });

  it('a ticket insert failure returns failed, leaves the outer transaction usable and publishes nothing', async () => {
    const { ticketOnlyExecutionProvider } = await import(
      '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider'
    );
    const marker = uuidv4();
    let result: any;
    await withTransaction(testDb, async (outer) => {
      await tenantDb(outer, tenant).table('boards').insert({ tenant, board_id: marker, board_name: `Marker ${marker.slice(0, 6)}`, is_default: false });
      // A status id that does not exist violates the tickets status foreign key: a real DB error.
      result = await ticketOnlyExecutionProvider.execute(context(outer, { statusId: uuidv4() }) as any);
      expect(result.status).toBe('failed');
      // The outer transaction is not aborted: the caller can still record the outcome.
      const row = await tenantDb(outer, tenant).table('boards').where({ board_id: marker }).first();
      expect(row).toBeTruthy();
    });
    expect(await scoped.table('boards').where({ board_id: marker }).first()).toBeTruthy();
    expect(created()).toHaveLength(0);
  });
});
