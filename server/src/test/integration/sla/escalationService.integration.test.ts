/**
 * SLA Escalation Service Integration Tests (alga-2026-0002687)
 *
 * Real database and real in-app notification path; only the email transport is
 * mocked. Guards the escalation transaction: a failing query anywhere in it must
 * surface instead of being swallowed, and the email must go out after commit.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTenant, createUser, createClient } from '../../../../test-utils/testDataFactory';

// Mock external dependencies
vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
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
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(async () => {}),
  })),
}));

const sendNotification = vi.fn(async (_params: Record<string, unknown>) => {});

vi.mock('@alga-psa/notifications/notifications/email', () => ({
  getEmailNotificationService: vi.fn(() => ({
    sendNotification: (params: Record<string, unknown>) => sendNotification(params),
  })),
}));

let escalateTicket: typeof import('@alga-psa/sla/services').escalateTicket;

const tenantTable = (dbOrTrx: Knex | Knex.Transaction, tenant: string, tableName: string) =>
  tenantDb(dbOrTrx, tenant).table(tableName);

describe('SLA Escalation Service Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let boardId: string;
  let statusOpenId: string;
  let priorityHighId: string;
  let assigneeUserId: string;
  let managerL1Id: string;
  let clientId: string;
  let contactId: string;

  const HOOK_TIMEOUT = 180_000;

  /** withTransaction owns the commit and flushes after-commit hooks once it commits (as in production). */
  const runCommitted = <T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> =>
    withTransaction(db, fn);

  async function newTicket(boardForTicket: string = boardId): Promise<string> {
    const ticketId = uuidv4();
    await insertTicket(db, {
      tenant: tenantId,
      ticketId,
      ticketNumber: `ESC-${uuidv4().slice(0, 6)}`,
      title: 'Escalation Test Ticket',
      clientId,
      contactId,
      statusId: statusOpenId,
      priorityId: priorityHighId,
      boardId: boardForTicket,
      assignedTo: assigneeUserId,
    });
    return ticketId;
  }

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();

    ({ escalateTicket } = await import('@alga-psa/sla/services'));

    tenantId = await createTenant(db, 'SLA Escalation Test Tenant');
    assigneeUserId = await createUser(db, tenantId, {
      email: `assignee-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Ticket',
      last_name: 'Assignee',
      user_type: 'internal',
    });
    managerL1Id = await createUser(db, tenantId, {
      email: `manager-l1-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Escalation',
      last_name: 'Manager',
      user_type: 'internal',
    });
    clientId = await createClient(db, tenantId, 'Escalation Test Client');
    contactId = await createContact(db, tenantId, clientId, `esc-contact-${uuidv4().slice(0, 8)}@example.com`);
    boardId = await createBoard(db, tenantId, 'Escalation Test Board', assigneeUserId);
    statusOpenId = await createStatus(db, tenantId, 'Open', false);
    priorityHighId = await createPriority(db, tenantId, 'High', 1, assigneeUserId);
    await createEscalationManager(db, tenantId, boardId, managerL1Id, 1);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    sendNotification.mockClear();
  });

  it('writes escalation fields, manager resource, audit row and in-app notification', async () => {
    const ticketId = await newTicket();
    const ticket = await tenantTable(db, tenantId, 'tickets').where({ ticket_id: ticketId }).first();

    const result = await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 1));

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.managerId).toBe(managerL1Id);
    expect(result.resourceAdded).toBe(true);
    expect(result.notificationsSent.inApp).toBe(true);

    const after = await tenantTable(db, tenantId, 'tickets').where({ ticket_id: ticketId }).first();
    expect(after.escalated).toBe(true);
    expect(after.escalation_level).toBe(1);
    expect(after.escalated_at).toBeTruthy();
    expect(after.escalated_by).toBeNull();
    expect(after.board_id).toBe(ticket.board_id);

    const resources = await tenantTable(db, tenantId, 'ticket_resources').where({ ticket_id: ticketId });
    expect(resources).toHaveLength(1);
    expect(resources[0].additional_user_id).toBe(managerL1Id);
    expect(resources[0].role).toBe('escalation_manager_L1');

    const audit = await tenantTable(db, tenantId, 'sla_audit_log')
      .where({ ticket_id: ticketId, event_type: 'ticket_escalated' });
    expect(audit).toHaveLength(1);

    const notifications = await tenantTable(db, tenantId, 'internal_notifications')
      .where({ user_id: managerL1Id })
      .whereRaw("metadata->>'ticket_id' = ?", [ticketId]);
    expect(notifications).toHaveLength(1);
  });

  it('sends the escalation email only after commit, with mailClass ticket and the ticket board', async () => {
    const ticketId = await newTicket();

    await runCommitted(async (trx) => {
      const result = await escalateTicket(trx, tenantId, ticketId, 1);
      expect(result.success).toBe(true);
      expect(result.notificationsSent.email).toBe(true);
      // Deferred: nothing may be sent while the transaction is still open.
      expect(sendNotification).not.toHaveBeenCalled();
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      mailClass: 'ticket',
      boardId,
      tenant: tenantId,
      userId: managerL1Id,
      templateName: 'sla-escalation',
    });
  });

  it('does not create duplicates when escalating to the same level again', async () => {
    const ticketId = await newTicket();
    await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 1));
    sendNotification.mockClear();

    const again = await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 1));
    expect(again.success).toBe(true);
    expect(again.error).toMatch(/already at or above/i);

    expect(await tenantTable(db, tenantId, 'ticket_resources').where({ ticket_id: ticketId })).toHaveLength(1);
    expect(
      await tenantTable(db, tenantId, 'sla_audit_log').where({ ticket_id: ticketId, event_type: 'ticket_escalated' })
    ).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('updates the existing resource role when the same manager handles L2', async () => {
    const ticketId = await newTicket();
    await createEscalationManager(db, tenantId, boardId, managerL1Id, 2).catch(() => undefined);
    await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 1));
    const l2 = await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 2));
    expect(l2.success).toBe(true);

    const resources = await tenantTable(db, tenantId, 'ticket_resources').where({ ticket_id: ticketId });
    expect(resources).toHaveLength(1);
    expect(resources[0].role).toBe('escalation_manager_L2');
  });

  it('still escalates when no manager is configured and records manager_found false', async () => {
    const bareBoard = await createBoard(db, tenantId, 'Board Without Managers', assigneeUserId);
    const ticketId = await newTicket(bareBoard);

    const result = await runCommitted((trx) => escalateTicket(trx, tenantId, ticketId, 1));
    expect(result.success).toBe(true);
    expect(result.managerId).toBeNull();

    const after = await tenantTable(db, tenantId, 'tickets').where({ ticket_id: ticketId }).first();
    expect(after.escalated).toBe(true);
    expect(after.escalation_level).toBe(1);

    const audit = await tenantTable(db, tenantId, 'sla_audit_log')
      .where({ ticket_id: ticketId, event_type: 'ticket_escalated' });
    expect(audit).toHaveLength(1);
    const data = typeof audit[0].event_data === 'string' ? JSON.parse(audit[0].event_data) : audit[0].event_data;
    expect(data.manager_found).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

async function createContact(db: Knex, tenant: string, clientId: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await tenantTable(db, tenant, 'contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Notification Test Contact',
    client_id: clientId,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return contactId;
}

async function createBoard(db: Knex, tenant: string, name: string, managerUserId: string): Promise<string> {
  const boardId = uuidv4();
  await tenantTable(db, tenant, 'boards').insert({
    tenant,
    board_id: boardId,
    board_name: name,
    description: 'Test board for SLA notifications',
    manager_user_id: managerUserId,
  });
  return boardId;
}

async function createStatus(db: Knex, tenant: string, name: string, isClosed: boolean): Promise<string> {
  const statusId = uuidv4();
  await tenantTable(db, tenant, 'statuses').insert({
    tenant,
    status_id: statusId,
    name,
    is_closed: isClosed,
    status_type: 'ticket',
    order_number: isClosed ? 100 : 1,
  });
  return statusId;
}

async function createPriority(db: Knex, tenant: string, name: string, orderNumber: number, createdBy: string): Promise<string> {
  const priorityId = uuidv4();
  await tenantTable(db, tenant, 'priorities').insert({
    tenant,
    priority_id: priorityId,
    priority_name: name,
    color: '#808080',
    order_number: orderNumber,
    created_by: createdBy,
    created_at: db.fn.now(),
  });
  return priorityId;
}

async function createEscalationManager(
  db: Knex,
  tenant: string,
  boardId: string,
  managerUserId: string,
  escalationLevel: number
): Promise<string> {
  const configId = uuidv4();
  await tenantTable(db, tenant, 'escalation_managers').insert({
    config_id: configId,
    tenant,
    board_id: boardId,
    escalation_level: escalationLevel,
    manager_user_id: managerUserId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return configId;
}

async function insertTicket(db: Knex, params: {
  tenant: string;
  ticketId: string;
  ticketNumber: string;
  title: string;
  clientId: string;
  contactId: string;
  statusId: string;
  priorityId: string;
  boardId: string;
  assignedTo: string | null;
}): Promise<void> {
  await tenantTable(db, params.tenant, 'tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: params.ticketNumber,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    assigned_to: params.assignedTo,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}
