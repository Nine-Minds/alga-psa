import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * handleTicketCreated must honour suppressContactNotifications (recurring tickets email the client
 * only when the definition opts in) while leaving creators that never set the flag untouched.
 */
const sent: Array<{ to: string; template: string }> = [];
let testDb: Knex;

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));

vi.mock('../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: { to: string; template: string }) => {
    sent.push({ to: params.to, template: params.template });
  }),
}));

describe('handleTicketCreated notification suppression (integration)', () => {
  let tenant: string;
  let ticketId: string;
  let ticketBase: Record<string, unknown>;
  let handleTicketCreated: (event: any) => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketCreated } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));

    tenant = await createTenant(testDb, `Suppression ${uuidv4().slice(0, 6)}`);
    const clientId = await createClient(testDb, tenant, 'Mail Client');
    const assignee = await createUser(testDb, tenant, { email: 'assignee@example.com' });
    const scoped = tenantDb(testDb, tenant);
    const contactId = uuidv4();
    await scoped.table('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Casey Contact', email: 'client@example.com', client_id: clientId });
    const boardId = uuidv4();
    const statusId = uuidv4();
    const priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Main', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: assignee });
    ticketBase = {
      tenant,
      title: 'Generated',
      client_id: clientId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      contact_name_id: contactId,
      ticket_origin: 'recurring',
      entered_at: new Date(),
    };
    ticketId = uuidv4();
    await scoped.table('tickets').insert({
      ...ticketBase,
      ticket_id: ticketId,
      ticket_number: `T-${uuidv4().slice(0, 6)}`,
      assigned_to: assignee,
    });
    await createUser(testDb, tenant, { email: 'watcher@example.com' });
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const event = (extra: Record<string, unknown>) => ({
    id: uuidv4(),
    eventType: 'TICKET_CREATED',
    timestamp: new Date().toISOString(),
    payload: { tenantId: tenant, ticketId, occurredAt: new Date().toISOString(), actorType: 'SYSTEM', ...extra },
  });

  it('emails the client and the assignee when the creator sets no suppression flag (unchanged behaviour)', async () => {
    await runWithTenant(tenant, () => handleTicketCreated(event({})));
    expect(sent.map((email) => email.to).sort()).toEqual(['assignee@example.com', 'client@example.com']);
  });

  it('emails only the internal assignee when contact notifications are suppressed', async () => {
    await runWithTenant(tenant, () => handleTicketCreated(event({ suppressContactNotifications: true })));
    expect(sent.map((email) => email.to)).toEqual(['assignee@example.com']);
  });

  it('still emails an internal watcher when contact notifications are suppressed and nobody is assigned', async () => {
    const unassignedId = uuidv4();
    await tenantDb(testDb, tenant).table('tickets').insert({
      ...ticketBase,
      ticket_id: unassignedId,
      ticket_number: `T-${uuidv4().slice(0, 6)}`,
      assigned_to: null,
      attributes: {
        watch_list: [
          { email: 'watcher@example.com', active: true },
          { email: 'outsider@example.org', active: true },
        ],
      },
    });
    const unassignedEvent = event({ suppressContactNotifications: true });
    unassignedEvent.payload.ticketId = unassignedId;

    await runWithTenant(tenant, () => handleTicketCreated(unassignedEvent));

    expect(sent.map((email) => email.to)).toEqual(['watcher@example.com']);
  });

  it('sends no assignee email when internal notifications are suppressed (the client is still emailed)', async () => {
    await runWithTenant(tenant, () => handleTicketCreated(event({ suppressInternalNotifications: true })));
    expect(sent.map((email) => email.to)).toEqual(['client@example.com']);
  });

  it('returns quietly with no send and no error when both audiences are suppressed', async () => {
    await expect(
      runWithTenant(tenant, () =>
        handleTicketCreated(event({ suppressContactNotifications: true, suppressInternalNotifications: true }))
      )
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
