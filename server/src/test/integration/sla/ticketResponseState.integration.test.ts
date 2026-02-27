/**
 * Integration tests for Ticket Response State functionality (SLA Phase 1)
 *
 * Tests response_state field on tickets including:
 * - Create ticket with response_state saves correctly
 * - Update response_state transitions
 * - Clear response_state (set to null)
 * - Query tickets by response_state filter
 * - Multi-tenant isolation
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

type ResponseState = 'awaiting_client' | 'awaiting_internal' | null;

describe('Ticket Response State Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let tenant2Id: string;
  let clientId: string;
  let client2Id: string;
  let userId: string;
  let boardId: string;
  let statusId: string;
  let statusClosedId: string;
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

    // Verify the ticket_response_state enum exists
    const enumCheck = await db.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ticket_response_state'
      ) as exists
    `);
    if (!enumCheck.rows[0].exists) {
      throw new Error('ticket_response_state enum does not exist. Run migrations first.');
    }

    // Create tenant 1
    tenantId = await createTenant(db, 'Response State Test Tenant 1');
    clientId = await createClient(db, tenantId, 'Response State Test Client 1');
    userId = await createUser(db, tenantId, { first_name: 'Response', last_name: 'Tester' });

    // Create tenant 2 for isolation tests
    tenant2Id = await createTenant(db, 'Response State Test Tenant 2');
    client2Id = await createClient(db, tenant2Id, 'Response State Test Client 2');

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

    statusClosedId = uuidv4();
    await db('statuses').insert({
      tenant: tenantId,
      status_id: statusClosedId,
      name: 'Closed',
      status_type: 'ticket',
      is_closed: true,
      order_number: 100,
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
    responseState?: ResponseState;
    statusIdOverride?: string;
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
      status_id: options.statusIdOverride ?? statusId,
      priority_id: priorityId,
      response_state: options.responseState ?? null,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    return ticketId;
  }

  describe('Database Schema Tests', () => {
    it('should have ticket_response_state enum type with correct values', async () => {
      const result = await db.raw(`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ticket_response_state')
        ORDER BY enumsortorder
      `);

      const enumValues = result.rows.map((r: { enumlabel: string }) => r.enumlabel);
      expect(enumValues).toContain('awaiting_client');
      expect(enumValues).toContain('awaiting_internal');
      expect(enumValues).toHaveLength(2);
    });

    it('should have response_state column on tickets table that is nullable', async () => {
      const result = await db.raw(`
        SELECT column_name, is_nullable, udt_name
        FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'response_state'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].is_nullable).toBe('YES');
      expect(result.rows[0].udt_name).toBe('ticket_response_state');
    });

    it('should have index on (tenant, response_state)', async () => {
      const result = await db.raw(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'tickets'
        AND indexdef LIKE '%response_state%'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Response State Database Operations', () => {
    it('should create ticket with response_state=awaiting_client and save correctly', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('should create ticket with response_state=awaiting_internal and save correctly', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('should create ticket with response_state=null (default)', async () => {
      const ticketId = await createTestTicket({ responseState: null });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.response_state).toBeNull();
    });

    it('should create ticket without specifying response_state (defaults to null)', async () => {
      const ticketId = await createTestTicket();

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket).toBeDefined();
      expect(ticket.response_state).toBeNull();
    });
  });

  describe('Response State Transitions', () => {
    it('should update response_state from null to awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: null });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: 'awaiting_client', updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('should update response_state from null to awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: null });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: 'awaiting_internal', updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('should update response_state from awaiting_client to awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: 'awaiting_internal', updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('should update response_state from awaiting_internal to awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: 'awaiting_client', updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('should clear response_state (set to null) from awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: null, updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBeNull();
    });

    it('should clear response_state (set to null) from awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({ response_state: null, updated_at: new Date() });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBeNull();
    });
  });

  describe('Response State Filtering', () => {
    let awaitingClientTicketId: string;
    let awaitingInternalTicketId: string;
    let nullResponseStateTicketId: string;

    beforeEach(async () => {
      awaitingClientTicketId = await createTestTicket({ responseState: 'awaiting_client' });
      awaitingInternalTicketId = await createTestTicket({ responseState: 'awaiting_internal' });
      nullResponseStateTicketId = await createTestTicket({ responseState: null });
    });

    it('should filter tickets by response_state=awaiting_client', async () => {
      const tickets = await db('tickets')
        .where({ tenant: tenantId, response_state: 'awaiting_client' })
        .select('ticket_id');

      const ticketIds = tickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(awaitingClientTicketId);
      expect(ticketIds).not.toContain(awaitingInternalTicketId);
      expect(ticketIds).not.toContain(nullResponseStateTicketId);
    });

    it('should filter tickets by response_state=awaiting_internal', async () => {
      const tickets = await db('tickets')
        .where({ tenant: tenantId, response_state: 'awaiting_internal' })
        .select('ticket_id');

      const ticketIds = tickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(awaitingInternalTicketId);
      expect(ticketIds).not.toContain(awaitingClientTicketId);
      expect(ticketIds).not.toContain(nullResponseStateTicketId);
    });

    it('should filter tickets with null response_state', async () => {
      const tickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNull('response_state')
        .select('ticket_id');

      const ticketIds = tickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(nullResponseStateTicketId);
      expect(ticketIds).not.toContain(awaitingClientTicketId);
      expect(ticketIds).not.toContain(awaitingInternalTicketId);
    });

    it('should filter tickets with any non-null response_state', async () => {
      const tickets = await db('tickets')
        .where({ tenant: tenantId })
        .whereNotNull('response_state')
        .whereIn('ticket_id', [awaitingClientTicketId, awaitingInternalTicketId, nullResponseStateTicketId])
        .select('ticket_id');

      const ticketIds = tickets.map(t => t.ticket_id);
      expect(ticketIds).toContain(awaitingClientTicketId);
      expect(ticketIds).toContain(awaitingInternalTicketId);
      expect(ticketIds).not.toContain(nullResponseStateTicketId);
    });

    it('should count tickets by response_state', async () => {
      const counts = await db('tickets')
        .where({ tenant: tenantId })
        .whereIn('ticket_id', [awaitingClientTicketId, awaitingInternalTicketId, nullResponseStateTicketId])
        .select('response_state')
        .count('* as count')
        .groupBy('response_state');

      const countMap = new Map(counts.map(c => [c.response_state, parseInt(c.count as string)]));

      expect(countMap.get('awaiting_client')).toBe(1);
      expect(countMap.get('awaiting_internal')).toBe(1);
      expect(countMap.get(null)).toBe(1);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should not allow access to response_state of tickets from other tenants', async () => {
      // Create required data for tenant 2
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

      // Create ticket in tenant 2 with response_state
      const ticketId = uuidv4();
      await db('tickets').insert({
        tenant: tenant2Id,
        ticket_id: ticketId,
        ticket_number: `TEST-TENANT2-${Date.now()}`,
        title: 'Tenant 2 Ticket',
        client_id: client2Id,
        board_id: board2Id,
        status_id: status2Id,
        priority_id: priority2Id,
        response_state: 'awaiting_client',
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
      expect(ticketFromTenant2.response_state).toBe('awaiting_client');
    });

    it('should isolate response_state filter queries by tenant', async () => {
      // Create ticket in tenant 1 with awaiting_internal
      const tenant1TicketId = await createTestTicket({ responseState: 'awaiting_internal' });

      // Query for awaiting_internal in tenant 1 should include the ticket
      const tenant1Tickets = await db('tickets')
        .where({ tenant: tenantId, response_state: 'awaiting_internal' })
        .select('ticket_id');

      expect(tenant1Tickets.map(t => t.ticket_id)).toContain(tenant1TicketId);

      // Query for awaiting_internal in tenant 2 should not include tenant 1 ticket
      const tenant2Tickets = await db('tickets')
        .where({ tenant: tenant2Id, response_state: 'awaiting_internal' })
        .select('ticket_id');

      expect(tenant2Tickets.map(t => t.ticket_id)).not.toContain(tenant1TicketId);
    });
  });

  describe('Response State with Ticket Status', () => {
    it('should allow response_state on open tickets', async () => {
      const ticketId = await createTestTicket({
        responseState: 'awaiting_client',
        statusIdOverride: statusId, // Open status
      });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('should allow response_state to be cleared when ticket is closed', async () => {
      const ticketId = await createTestTicket({
        responseState: 'awaiting_client',
        statusIdOverride: statusId,
      });

      // Close the ticket and clear response_state
      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({
          status_id: statusClosedId,
          response_state: null,
          updated_at: new Date(),
        });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.status_id).toBe(statusClosedId);
      expect(ticket.response_state).toBeNull();
    });

    it('should keep response_state null when reopening closed ticket', async () => {
      // Create and close ticket
      const ticketId = await createTestTicket({
        responseState: 'awaiting_internal',
        statusIdOverride: statusId,
      });

      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({
          status_id: statusClosedId,
          response_state: null,
          updated_at: new Date(),
        });

      // Reopen the ticket (just change status, don't set response_state)
      await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .update({
          status_id: statusId,
          updated_at: new Date(),
        });

      const ticket = await db('tickets')
        .where({ ticket_id: ticketId, tenant: tenantId })
        .first();

      expect(ticket.status_id).toBe(statusId);
      expect(ticket.response_state).toBeNull(); // Should remain null after reopening
    });
  });

  describe('Invalid Response State Values', () => {
    it('should reject invalid response_state enum values', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `TEST-INVALID-${Date.now()}`;

      await expect(
        db('tickets').insert({
          tenant: tenantId,
          ticket_id: ticketId,
          ticket_number: ticketNumber,
          title: 'Test Ticket',
          client_id: clientId,
          board_id: boardId,
          status_id: statusId,
          priority_id: priorityId,
          response_state: 'invalid_state' as any,
          entered_at: new Date(),
          updated_at: new Date(),
        })
      ).rejects.toThrow();
    });
  });
});
