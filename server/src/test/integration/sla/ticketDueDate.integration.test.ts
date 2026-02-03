/**
 * Integration tests for Ticket Due Date functionality (SLA Phase 1)
 *
 * Tests due_date field on tickets including:
 * - Create ticket with due_date saves correctly to database
 * - Update ticket due_date persists change
 * - Clear due_date (set to null) works
 * - Query tickets by due_date filter: overdue, upcoming, today, no_due_date
 * - Sort tickets by due_date ascending/descending
 * - Multi-tenant isolation
 * - Due dates stored in UTC consistently
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';

// Mock dependencies
vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
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

describe('Ticket Due Date Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let tenant2Id: string;
  let clientId: string;
  let client2Id: string;
  let userId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;

  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();

    // Create tenant 1
    tenantId = await createTenant(db, 'Due Date Test Tenant 1');
    clientId = await createClient(db, tenantId, 'Due Date Test Client 1');
    userId = await createUser(db, tenantId, { first_name: 'Due Date', last_name: 'Tester' });

    // Create tenant 2 for isolation tests
    tenant2Id = await createTenant(db, 'Due Date Test Tenant 2');
    client2Id = await createClient(db, tenant2Id, 'Due Date Test Client 2');

    // Create required reference data for tenant 1
    boardId = uuidv4();
    await db('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      name: 'Test Board',
      created_at: new Date(),
      updated_at: new Date(),
    });

    statusId = uuidv4();
    await db('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      order_number: 1,
    });

    priorityId = uuidv4();
    await db('priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: 'Normal',
      color: '#808080',
      order_number: 1,
      created_by: userId,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // Helper function to create a test ticket
  async function createTestTicket(options: {
    tenantIdOverride?: string;
    clientIdOverride?: string;
    dueDate?: Date | null;
  } = {}): Promise<string> {
    const ticketId = uuidv4();
    const ticketNumber = `TEST-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    await db('tickets').insert({
      tenant: options.tenantIdOverride ?? tenantId,
      ticket_id: ticketId,
      ticket_number: ticketNumber,
      title: 'Test Ticket',
      client_id: options.clientIdOverride ?? clientId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      due_date: options.dueDate === undefined ? null : options.dueDate,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    return ticketId;
  }

  describe('Due Date Database Operations', () => {
    it('should create ticket with due_date and save correctly to database', async () => {
      const dueDate = new Date('2025-03-15T14:00:00.000Z');
      const ticketId = await createTestTicket({ dueDate });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.due_date).toBeDefined();
      // Compare as ISO strings to handle timezone normalization
      expect(new Date(ticket.due_date).toISOString()).toBe(dueDate.toISOString());
    });

    it('should create ticket without due_date (null by default)', async () => {
      const ticketId = await createTestTicket();

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.due_date).toBeNull();
    });

    it('should update ticket due_date and persist change', async () => {
      const initialDueDate = new Date('2025-03-15T14:00:00.000Z');
      const newDueDate = new Date('2025-04-20T10:00:00.000Z');
      const ticketId = await createTestTicket({ dueDate: initialDueDate });

      // Update the due date
      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ due_date: newDueDate, updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(new Date(ticket.due_date).toISOString()).toBe(newDueDate.toISOString());
    });

    it('should clear due_date (set to null) successfully', async () => {
      const dueDate = new Date('2025-03-15T14:00:00.000Z');
      const ticketId = await createTestTicket({ dueDate });

      // Verify due_date is set
      let ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();
      expect(ticket.due_date).not.toBeNull();

      // Clear the due date
      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ due_date: null, updated_at: new Date() });

      ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.due_date).toBeNull();
    });

    it('should store due dates in UTC consistently', async () => {
      // Create multiple tickets with different timezone representations
      const dueDateUTC = new Date('2025-06-15T12:00:00.000Z');
      const ticketId = await createTestTicket({ dueDate: dueDateUTC });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      // The stored date should be in UTC
      const storedDate = new Date(ticket.due_date);
      expect(storedDate.getUTCFullYear()).toBe(2025);
      expect(storedDate.getUTCMonth()).toBe(5); // June (0-indexed)
      expect(storedDate.getUTCDate()).toBe(15);
      expect(storedDate.getUTCHours()).toBe(12);
    });
  });

  describe('Due Date Filtering', () => {
    let overdueTicketId: string;
    let todayTicketId: string;
    let upcomingTicketId: string;
    let noDueDateTicketId: string;

    beforeEach(async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const today = new Date(now);
      today.setHours(23, 59, 59, 999);

      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      overdueTicketId = await createTestTicket({ dueDate: yesterday });
      todayTicketId = await createTestTicket({ dueDate: today });
      upcomingTicketId = await createTestTicket({ dueDate: nextWeek });
      noDueDateTicketId = await createTestTicket({ dueDate: null });
    });

    it('should filter overdue tickets (due_date < now)', async () => {
      const now = new Date();
      const overdueTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNotNull('due_date')
        .where('due_date', '<', now)
        .select('ticket_id');

      const ticketIds = overdueTickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(overdueTicketId);
      expect(ticketIds).not.toContain(upcomingTicketId);
    });

    it('should filter upcoming tickets (due_date > now)', async () => {
      const now = new Date();
      const upcomingTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNotNull('due_date')
        .where('due_date', '>', now)
        .select('ticket_id');

      const ticketIds = upcomingTickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(upcomingTicketId);
      expect(ticketIds).not.toContain(overdueTicketId);
    });

    it('should filter tickets due today', async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNotNull('due_date')
        .whereBetween('due_date', [todayStart, todayEnd])
        .select('ticket_id');

      const ticketIds = todayTickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(todayTicketId);
    });

    it('should filter tickets with no due date', async () => {
      const ticketsWithoutDueDate = await db('tickets')
        .where({ tenant: tenantId })
        .whereNull('due_date')
        .select('ticket_id');

      const ticketIds = ticketsWithoutDueDate.map(t => t.ticket_id);
      expect(ticketIds).toContain(noDueDateTicketId);
      expect(ticketIds).not.toContain(overdueTicketId);
      expect(ticketIds).not.toContain(upcomingTicketId);
    });
  });

  describe('Due Date Sorting', () => {
    it('should sort tickets by due_date ascending (earliest first)', async () => {
      const date1 = new Date('2025-01-01T12:00:00.000Z');
      const date2 = new Date('2025-02-15T12:00:00.000Z');
      const date3 = new Date('2025-03-30T12:00:00.000Z');

      const ticketId3 = await createTestTicket({ dueDate: date3 });
      const ticketId1 = await createTestTicket({ dueDate: date1 });
      const ticketId2 = await createTestTicket({ dueDate: date2 });

      const sortedTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereIn('ticket_id', [ticketId1, ticketId2, ticketId3])
        .orderBy('due_date', 'asc')
        .select('ticket_id');

      expect(sortedTickets[0].ticket_id).toBe(ticketId1);
      expect(sortedTickets[1].ticket_id).toBe(ticketId2);
      expect(sortedTickets[2].ticket_id).toBe(ticketId3);
    });

    it('should sort tickets by due_date descending (latest first)', async () => {
      const date1 = new Date('2025-01-01T12:00:00.000Z');
      const date2 = new Date('2025-02-15T12:00:00.000Z');
      const date3 = new Date('2025-03-30T12:00:00.000Z');

      const ticketId1 = await createTestTicket({ dueDate: date1 });
      const ticketId2 = await createTestTicket({ dueDate: date2 });
      const ticketId3 = await createTestTicket({ dueDate: date3 });

      const sortedTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereIn('ticket_id', [ticketId1, ticketId2, ticketId3])
        .orderBy('due_date', 'desc')
        .select('ticket_id');

      expect(sortedTickets[0].ticket_id).toBe(ticketId3);
      expect(sortedTickets[1].ticket_id).toBe(ticketId2);
      expect(sortedTickets[2].ticket_id).toBe(ticketId1);
    });

    it('should handle null due_dates in sorting (nulls last for asc)', async () => {
      const date1 = new Date('2025-01-01T12:00:00.000Z');
      const date2 = new Date('2025-02-15T12:00:00.000Z');

      const ticketId1 = await createTestTicket({ dueDate: date1 });
      const ticketIdNull = await createTestTicket({ dueDate: null });
      const ticketId2 = await createTestTicket({ dueDate: date2 });

      const sortedTickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereIn('ticket_id', [ticketId1, ticketIdNull, ticketId2])
        .orderByRaw('due_date ASC NULLS LAST')
        .select('ticket_id');

      expect(sortedTickets[0].ticket_id).toBe(ticketId1);
      expect(sortedTickets[1].ticket_id).toBe(ticketId2);
      expect(sortedTickets[2].ticket_id).toBe(ticketIdNull);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should not allow access to tickets from other tenants', async () => {
      // Create a ticket in tenant 2
      const board2Id = uuidv4();
      await db('boards').insert({
        tenant: tenant2Id,
        board_id: board2Id,
        name: 'Test Board 2',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const status2Id = uuidv4();
      await db('statuses').insert({
        tenant: tenant2Id,
        status_id: status2Id,
        name: 'Open',
        status_type: 'ticket',
        is_closed: false,
        order_number: 1,
      });

      const user2Id = await createUser(db, tenant2Id, { first_name: 'Tenant2', last_name: 'User' });
      const priority2Id = uuidv4();
      await db('priorities').insert({
        tenant: tenant2Id,
        priority_id: priority2Id,
        priority_name: 'Normal',
        color: '#808080',
        order_number: 1,
        created_by: user2Id,
      });

      const ticketId = uuidv4();
      const dueDate = new Date('2025-05-01T12:00:00.000Z');

      await db('tickets').insert({
        tenant: tenant2Id,
        ticket_id: ticketId,
        ticket_number: `TEST-TENANT2-${Date.now()}`,
        title: 'Tenant 2 Ticket',
        client_id: client2Id,
        board_id: board2Id,
        status_id: status2Id,
        priority_id: priority2Id,
        due_date: dueDate,
        entered_at: new Date(),
        updated_at: new Date(),
      });

      // Try to query from tenant 1's perspective
      const ticketFromTenant1 = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticketFromTenant1).toBeUndefined();

      // Query from tenant 2's perspective should work
      const ticketFromTenant2 = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenant2Id })
        .first();

      expect(ticketFromTenant2).toBeDefined();
      expect(new Date(ticketFromTenant2.due_date).toISOString()).toBe(dueDate.toISOString());
    });

    it('should isolate due_date queries by tenant', async () => {
      const dueDate = new Date('2025-06-15T12:00:00.000Z');

      // Create ticket in tenant 1
      const tenant1TicketId = await createTestTicket({ dueDate });

      // Get all tickets due on that date for tenant 1
      const tenant1Tickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNotNull('due_date')
        .whereRaw('DATE(due_date) = DATE(?)', [dueDate])
        .select('ticket_id');

      const tenant1TicketIds = tenant1Tickets.map(t => t.ticket_id);
      expect(tenant1TicketIds).toContain(tenant1TicketId);

      // Query for tenant 2 should not include tenant 1 tickets
      const tenant2Tickets = await db('tickets')
        .where({ tenant: tenant2Id })
        .whereNotNull('due_date')
        .whereRaw('DATE(due_date) = DATE(?)', [dueDate])
        .select('ticket_id');

      const tenant2TicketIds = tenant2Tickets.map(t => t.ticket_id);
      expect(tenant2TicketIds).not.toContain(tenant1TicketId);
    });
  });

  describe('Edge Cases', () => {
    it('should handle far future due dates', async () => {
      const farFutureDueDate = new Date('2099-12-31T23:59:59.000Z');
      const ticketId = await createTestTicket({ dueDate: farFutureDueDate });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(new Date(ticket.due_date).toISOString()).toBe(farFutureDueDate.toISOString());
    });

    it('should handle due dates at midnight UTC', async () => {
      const midnightUTC = new Date('2025-07-04T00:00:00.000Z');
      const ticketId = await createTestTicket({ dueDate: midnightUTC });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      const storedDate = new Date(ticket.due_date);
      expect(storedDate.getUTCHours()).toBe(0);
      expect(storedDate.getUTCMinutes()).toBe(0);
      expect(storedDate.getUTCSeconds()).toBe(0);
    });

    it('should handle due dates at end of day UTC', async () => {
      const endOfDayUTC = new Date('2025-07-04T23:59:59.999Z');
      const ticketId = await createTestTicket({ dueDate: endOfDayUTC });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      const storedDate = new Date(ticket.due_date);
      expect(storedDate.getUTCHours()).toBe(23);
      expect(storedDate.getUTCMinutes()).toBe(59);
    });
  });
});
