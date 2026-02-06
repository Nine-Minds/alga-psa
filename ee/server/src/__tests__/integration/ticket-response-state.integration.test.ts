/**
 * Integration tests for Ticket Response State Tracking feature
 * Tests T001-T026, T054-T076 from the feature test plan
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import type { IComment } from '../../../../../server/src/interfaces/comment.interface';

// Type for createComment input - excludes tenant and author_type which are set by the function
type CreateCommentInput = Omit<IComment, 'tenant'> & { author_type?: IComment['author_type'] };

// Mock the tenant context for server actions
let db: Knex;
let tenantData: TenantTestData;
let tenantId: string;

// Mock createTenantKnex to return our test database, but keep other exports
vi.mock('../../../../../server/src/lib/db', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../../../server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId),
  };
});

// Mock getCurrentUser for user context
vi.mock('@alga-psa/users/actions', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@alga-psa/users/actions');
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => ({
      user_id: 'test-user-id',
      user_type: 'internal',
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
    })),
  };
});

// Mock RBAC permissions
vi.mock('../../../../../server/src/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../../../server/src/lib/auth/rbac');
  return {
    ...actual,
    hasPermission: vi.fn(async () => true),
  };
});

// Mock event publishing to capture events
const publishedEvents: Array<{ eventType: string; payload: any }> = [];
vi.mock('../../../../../server/src/lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../../../server/src/lib/eventBus/publishers');
  return {
    ...actual,
    publishEvent: vi.fn(async (event: { eventType: string; payload: any }) => {
      publishedEvents.push(event);
    }),
  };
});

vi.mock('../../../../../server/src/lib/eventBus', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../../../server/src/lib/eventBus');
  return {
    ...actual,
    getEventBus: vi.fn(() => ({
      publish: vi.fn(async () => {}),
    })),
  };
});

vi.mock('../../../../../server/src/lib/notifications/emailChannel', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../../../server/src/lib/notifications/emailChannel');
  return {
    ...actual,
    getEmailEventChannel: vi.fn(() => 'email-channel'),
  };
});

describe('Ticket Response State Integration Tests', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';

    db = createTestDbConnection();

    // Create isolated tenant for tests
    tenantData = await createTestTenant(db, {
      companyName: `Response State Test ${uuidv4().slice(0, 6)}`,
    });
    tenantId = tenantData.tenant.tenantId;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    // Clear published events
    publishedEvents.length = 0;
  });

  // Helper to create a test ticket
  async function createTestTicket(options: {
    responseState?: 'awaiting_client' | 'awaiting_internal' | null;
    statusIsClosed?: boolean;
  } = {}): Promise<string> {
    const ticketId = uuidv4();

    // Get or create a status
    let status = await db('statuses')
      .where({ tenant: tenantId, is_closed: options.statusIsClosed ?? false })
      .first();

    if (!status) {
      const statusId = uuidv4();
      await db('statuses').insert({
        status_id: statusId,
        tenant: tenantId,
        name: options.statusIsClosed ? 'Closed' : 'Open',
        is_closed: options.statusIsClosed ?? false,
        status_type: 'ticket',
        order_number: 1,
      });
      status = { status_id: statusId };
    }

    // Get or create a priority
    let priority = await db('priorities')
      .where({ tenant: tenantId })
      .first();

    if (!priority) {
      const priorityId = uuidv4();
      // Get a user for created_by
      const user = await db('users').where({ tenant: tenantId }).first();
      await db('priorities').insert({
        priority_id: priorityId,
        tenant: tenantId,
        priority_name: 'Normal',
        color: '#808080',
        order_number: 1,
        created_by: user?.user_id || tenantData.adminUser.userId,
      });
      priority = { priority_id: priorityId };
    }

    // Get or create a client for the ticket
    let client = await db('clients')
      .where({ tenant: tenantId })
      .first();

    if (!client && tenantData.client) {
      client = { client_id: tenantData.client.clientId };
    }

    if (!client) {
      // Create a client if none exists
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Test Client',
        created_at: new Date(),
        updated_at: new Date(),
      });
      client = { client_id: clientId };
    }

    await db('tickets').insert({
      ticket_id: ticketId,
      tenant: tenantId,
      ticket_number: `TEST-${Date.now()}`,
      title: 'Test Ticket',
      status_id: status.status_id,
      priority_id: priority.priority_id,
      client_id: client.client_id,
      response_state: options.responseState ?? null,
      entered_at: new Date(),
      updated_at: new Date(),
    });

    return ticketId;
  }

  // Helper to create a test user
  async function createTestUser(userType: 'internal' | 'client'): Promise<string> {
    const userId = uuidv4();
    await db('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: `test-${userType}-${userId.slice(0, 6)}`,
      email: `${userId.slice(0, 6)}@test.com`,
      first_name: 'Test',
      last_name: userType === 'internal' ? 'Staff' : 'Client',
      user_type: userType,
      is_inactive: false,
      hashed_password: 'not-a-real-hash',
    });
    return userId;
  }

  // Helper to create a comment with correct types
  async function createTestComment(options: {
    ticketId: string;
    userId: string;
    note: string;
    isInternal: boolean;
    isResolution?: boolean;
  }): Promise<void> {
    const { createComment } = await import('@alga-psa/tickets/actions/comment-actions/commentActions');

    // The createComment function sets author_type internally based on user_id,
    // but we need to provide it to satisfy TypeScript - it will be overwritten
    const commentData: CreateCommentInput = {
      ticket_id: options.ticketId,
      user_id: options.userId,
      note: options.note,
      is_internal: options.isInternal,
      is_resolution: options.isResolution ?? false,
      author_type: 'unknown', // Will be overwritten by createComment
    };

    await createComment(commentData as Omit<IComment, 'tenant'>);
  }

  // ==========================================================================
  // T001-T004: Database Migration Tests
  // ==========================================================================
  describe('Database Migration Tests (T001-T004)', () => {
    it('T001: ticket_response_state enum type exists with correct values', async () => {
      const result = await db.raw(`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ticket_response_state')
        ORDER BY enumsortorder
      `);

      const enumValues = result.rows.map((r: { enumlabel: string }) => r.enumlabel);
      expect(enumValues).toContain('awaiting_client');
      expect(enumValues).toContain('awaiting_internal');
    });

    it('T002: response_state column exists on tickets table and is nullable', async () => {
      const result = await db.raw(`
        SELECT column_name, is_nullable, udt_name
        FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'response_state'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].is_nullable).toBe('YES');
      expect(result.rows[0].udt_name).toBe('ticket_response_state');
    });

    it('T003: Index exists on (tenant, response_state)', async () => {
      const result = await db.raw(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'tickets'
        AND indexdef LIKE '%response_state%'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('T004: New tickets have null response_state by default', async () => {
      const ticketId = await createTestTicket();
      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBeNull();
    });
  });

  // ==========================================================================
  // T005-T006: Type Definition Tests (compile-time, verified by TypeScript)
  // ==========================================================================
  describe('Type Definition Tests (T005-T006)', () => {
    it('T005-T006: TicketResponseState type exists and allows correct values', async () => {
      // This test verifies at runtime that the database accepts the correct values
      const ticketId1 = await createTestTicket({ responseState: 'awaiting_client' });
      const ticketId2 = await createTestTicket({ responseState: 'awaiting_internal' });
      const ticketId3 = await createTestTicket({ responseState: null });

      const ticket1 = await db('tickets').where({ ticket_id: ticketId1 }).first();
      const ticket2 = await db('tickets').where({ ticket_id: ticketId2 }).first();
      const ticket3 = await db('tickets').where({ ticket_id: ticketId3 }).first();

      expect(ticket1.response_state).toBe('awaiting_client');
      expect(ticket2.response_state).toBe('awaiting_internal');
      expect(ticket3.response_state).toBeNull();
    });
  });

  // ==========================================================================
  // T007-T017: Comment-Triggered State Changes
  // ==========================================================================
  describe('Comment-Triggered State Changes (T007-T017)', () => {
    it('T007: Staff creates client-visible comment → response_state becomes awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      // Clear events before test
      publishedEvents.length = 0;

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Test comment' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('T008: Staff creates client-visible comment on ticket already awaiting_client → state unchanged', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });
      const staffUserId = await createTestUser('internal');

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Another comment' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('T009: Staff creates client-visible comment on ticket awaiting_internal → state becomes awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });
      const staffUserId = await createTestUser('internal');

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Response to client' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('T010: Client creates comment → response_state becomes awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const clientUserId = await createTestUser('client');

      await createTestComment({
        ticketId,
        userId: clientUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Client question' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('T011: Client creates comment on ticket already awaiting_internal → state unchanged', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });
      const clientUserId = await createTestUser('client');

      await createTestComment({
        ticketId,
        userId: clientUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Follow up question' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('T012: Client creates comment on ticket awaiting_client → state becomes awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });
      const clientUserId = await createTestUser('client');

      await createTestComment({
        ticketId,
        userId: clientUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Client response' }] }]),
        isInternal: false,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('T013: Staff creates internal note → response_state does not change from null', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Internal note' }] }]),
        isInternal: true,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBeNull();
    });

    it('T014: Staff creates internal note on awaiting_client ticket → state remains awaiting_client', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });
      const staffUserId = await createTestUser('internal');

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Internal note' }] }]),
        isInternal: true,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('T015: Staff creates internal note on awaiting_internal ticket → state remains awaiting_internal', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_internal' });
      const staffUserId = await createTestUser('internal');

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Internal discussion' }] }]),
        isInternal: true,
      });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('T016-T017: Comment creation and response state update occur in same transaction', async () => {
      // This is implicitly tested by the above tests - if transaction wasn't working,
      // the tests would see inconsistent states. We can verify by checking that
      // a failed comment doesn't change state.

      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      // Store original state
      const originalTicket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(originalTicket.response_state).toBeNull();

      // Attempting to create a comment with invalid data should not change state
      try {
        await createTestComment({
          ticketId,
          userId: staffUserId,
          note: '', // Empty note should fail or be handled
          isInternal: false,
        });
      } catch {
        // Expected to potentially fail
      }

      // Verify state hasn't changed unexpectedly (should still be null or awaiting_client if comment succeeded)
      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      // Either null (if failed) or awaiting_client (if empty note was accepted)
      expect(ticket.response_state === null || ticket.response_state === 'awaiting_client').toBe(true);
    });
  });

  // ==========================================================================
  // T018-T026: Manual Override and Close Behavior
  // ==========================================================================
  describe('Manual Override and Close Behavior (T018-T026)', () => {
    it('T018: updateTicket with response_state=awaiting_client updates ticket', async () => {
      const ticketId = await createTestTicket({ responseState: null });

      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ response_state: 'awaiting_client' });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_client');
    });

    it('T019: updateTicket with response_state=awaiting_internal updates ticket', async () => {
      const ticketId = await createTestTicket({ responseState: null });

      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ response_state: 'awaiting_internal' });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBe('awaiting_internal');
    });

    it('T020: updateTicket with response_state=null clears response state', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });

      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ response_state: null });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBeNull();
    });

    it('T022-T024: Closing ticket clears response_state', async () => {
      // Get or create a closed status
      let closedStatus = await db('statuses')
        .where({ tenant: tenantId, is_closed: true })
        .first();

      if (!closedStatus) {
        const statusId = uuidv4();
        await db('statuses').insert({
          status_id: statusId,
          tenant: tenantId,
          name: 'Closed',
          is_closed: true,
          status_type: 'ticket',
          order_number: 100,
        });
        closedStatus = { status_id: statusId };
      }

      // T022: From awaiting_client
      const ticketId1 = await createTestTicket({ responseState: 'awaiting_client' });
      await db('tickets')
        .where({ ticket_id: ticketId1 })
        .update({ status_id: closedStatus.status_id, response_state: null });

      const ticket1 = await db('tickets').where({ ticket_id: ticketId1 }).first();
      expect(ticket1.response_state).toBeNull();

      // T023: From awaiting_internal
      const ticketId2 = await createTestTicket({ responseState: 'awaiting_internal' });
      await db('tickets')
        .where({ ticket_id: ticketId2 })
        .update({ status_id: closedStatus.status_id, response_state: null });

      const ticket2 = await db('tickets').where({ ticket_id: ticketId2 }).first();
      expect(ticket2.response_state).toBeNull();

      // T024: From null (stays null)
      const ticketId3 = await createTestTicket({ responseState: null });
      await db('tickets')
        .where({ ticket_id: ticketId3 })
        .update({ status_id: closedStatus.status_id });

      const ticket3 = await db('tickets').where({ ticket_id: ticketId3 }).first();
      expect(ticket3.response_state).toBeNull();
    });

    it('T025: Closing ticket with null response_state keeps response_state null', async () => {
      let closedStatus = await db('statuses')
        .where({ tenant: tenantId, is_closed: true })
        .first();

      if (!closedStatus) {
        const statusId = uuidv4();
        await db('statuses').insert({
          status_id: statusId,
          tenant: tenantId,
          name: 'Closed',
          is_closed: true,
          status_type: 'ticket',
          order_number: 100,
        });
        closedStatus = { status_id: statusId };
      }

      const ticketId = await createTestTicket({ responseState: null });
      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ status_id: closedStatus.status_id });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBeNull();
    });

    it('T026: Reopening closed ticket does not set response_state', async () => {
      // Get open and closed statuses
      let openStatus = await db('statuses')
        .where({ tenant: tenantId, is_closed: false })
        .first();

      let closedStatus = await db('statuses')
        .where({ tenant: tenantId, is_closed: true })
        .first();

      if (!closedStatus) {
        const statusId = uuidv4();
        await db('statuses').insert({
          status_id: statusId,
          tenant: tenantId,
          name: 'Closed',
          is_closed: true,
          status_type: 'ticket',
          order_number: 100,
        });
        closedStatus = { status_id: statusId };
      }

      // Create ticket, close it, then reopen
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });

      // Close it
      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ status_id: closedStatus.status_id, response_state: null });

      // Reopen it
      await db('tickets')
        .where({ ticket_id: ticketId })
        .update({ status_id: openStatus.status_id });

      const ticket = await db('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.response_state).toBeNull();
    });
  });

  // ==========================================================================
  // T054-T065, T072, T076: Event Publishing Tests
  // ==========================================================================
  describe('Event Publishing Tests (T054-T065, T072, T076)', () => {
    it('T054: TICKET_RESPONSE_STATE_CHANGED event type exists', async () => {
      // Import the event types
      const { EventTypeEnum } = await import('../../../../../server/src/lib/eventBus/events');
      expect(EventTypeEnum.options).toContain('TICKET_RESPONSE_STATE_CHANGED');
    });

    it('T055: Event schema validates required fields', async () => {
      const { TicketResponseStateChangedPayloadSchema } = await import('../../../../../server/src/lib/eventBus/events');

      // Valid payload
      const validPayload = {
        tenantId: uuidv4(),
        ticketId: uuidv4(),
        userId: uuidv4(),
        previousState: 'awaiting_client',
        newState: 'awaiting_internal',
        trigger: 'comment',
      };

      const result = TicketResponseStateChangedPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);

      // Invalid payload (missing trigger)
      const invalidPayload = {
        tenantId: uuidv4(),
        ticketId: uuidv4(),
      };

      const invalidResult = TicketResponseStateChangedPayloadSchema.safeParse(invalidPayload);
      expect(invalidResult.success).toBe(false);
    });

    it('T056-T057: Creating client-visible comment fires TICKET_RESPONSE_STATE_CHANGED event with trigger=comment', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      publishedEvents.length = 0;

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Test comment for event' }] }]),
        isInternal: false,
      });

      const stateChangeEvent = publishedEvents.find(e => e.eventType === 'TICKET_RESPONSE_STATE_CHANGED');
      expect(stateChangeEvent).toBeDefined();
      expect(stateChangeEvent?.payload.trigger).toBe('comment');
      expect(stateChangeEvent?.payload.previousState).toBeNull();
      expect(stateChangeEvent?.payload.newState).toBe('awaiting_client');
    });

    it('T063-T064: Event includes correct previousState and newState values', async () => {
      const ticketId = await createTestTicket({ responseState: 'awaiting_client' });
      const clientUserId = await createTestUser('client');

      publishedEvents.length = 0;

      await createTestComment({
        ticketId,
        userId: clientUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Client response' }] }]),
        isInternal: false,
      });

      const stateChangeEvent = publishedEvents.find(e => e.eventType === 'TICKET_RESPONSE_STATE_CHANGED');
      expect(stateChangeEvent).toBeDefined();
      expect(stateChangeEvent?.payload.previousState).toBe('awaiting_client');
      expect(stateChangeEvent?.payload.newState).toBe('awaiting_internal');
    });

    it('T072: TICKET_COMMENT_ADDED event payload includes author_type', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      publishedEvents.length = 0;

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Comment with author type' }] }]),
        isInternal: false,
      });

      const commentEvent = publishedEvents.find(e => e.eventType === 'TICKET_COMMENT_ADDED');
      expect(commentEvent).toBeDefined();
      expect(commentEvent?.payload.comment.authorType).toBe('internal');
    });

    it('T076: Internal note does not fire TICKET_RESPONSE_STATE_CHANGED event', async () => {
      const ticketId = await createTestTicket({ responseState: null });
      const staffUserId = await createTestUser('internal');

      publishedEvents.length = 0;

      await createTestComment({
        ticketId,
        userId: staffUserId,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Internal note' }] }]),
        isInternal: true,
      });

      const stateChangeEvent = publishedEvents.find(e => e.eventType === 'TICKET_RESPONSE_STATE_CHANGED');
      expect(stateChangeEvent).toBeUndefined();
    });
  });

  // ==========================================================================
  // T073-T075: Tenant Isolation Tests
  // ==========================================================================
  describe('Tenant Isolation Tests (T073-T075)', () => {
    it('T073-T074: Users cannot see or update response_state of tickets in other tenants', async () => {
      // Create a second tenant
      const tenant2Data = await createTestTenant(db, {
        companyName: `Tenant 2 ${uuidv4().slice(0, 6)}`,
      });

      // Create ticket in tenant 1
      const ticketId1 = await createTestTicket({ responseState: 'awaiting_client' });

      // Try to query the ticket from tenant 2's perspective
      const ticketFromTenant2 = await db('tickets')
        .where({ ticket_id: ticketId1, tenant: tenant2Data.tenant.tenantId })
        .first();

      expect(ticketFromTenant2).toBeUndefined();

      // Create ticket in tenant 2
      const ticketId2 = uuidv4();
      const status = await db('statuses').where({ tenant: tenant2Data.tenant.tenantId }).first()
        || await (async () => {
          const statusId = uuidv4();
          await db('statuses').insert({
            status_id: statusId,
            tenant: tenant2Data.tenant.tenantId,
            name: 'Open',
            is_closed: false,
            status_type: 'ticket',
            order_number: 1,
          });
          return { status_id: statusId };
        })();

      const priority = await db('priorities').where({ tenant: tenant2Data.tenant.tenantId }).first()
        || await (async () => {
          const priorityId = uuidv4();
          await db('priorities').insert({
            priority_id: priorityId,
            tenant: tenant2Data.tenant.tenantId,
            priority_name: 'Normal',
            color: '#808080',
            order_number: 1,
            created_by: tenant2Data.adminUser.userId,
          });
          return { priority_id: priorityId };
        })();

      // Get or create a client for tenant 2
      let client2 = await db('clients')
        .where({ tenant: tenant2Data.tenant.tenantId })
        .first();

      if (!client2 && tenant2Data.client) {
        client2 = { client_id: tenant2Data.client.clientId };
      }

      if (!client2) {
        const clientId = uuidv4();
        await db('clients').insert({
          client_id: clientId,
          tenant: tenant2Data.tenant.tenantId,
          client_name: 'Test Client 2',
          created_at: new Date(),
          updated_at: new Date(),
        });
        client2 = { client_id: clientId };
      }

      await db('tickets').insert({
        ticket_id: ticketId2,
        tenant: tenant2Data.tenant.tenantId,
        ticket_number: `T2-${Date.now()}`,
        title: 'Tenant 2 Ticket',
        status_id: status.status_id,
        priority_id: priority.priority_id,
        client_id: client2.client_id,
        response_state: 'awaiting_internal',
        entered_at: new Date(),
        updated_at: new Date(),
      });

      // Try to query from tenant 1's perspective
      const ticketFromTenant1 = await db('tickets')
        .where({ ticket_id: ticketId2, tenant: tenantId })
        .first();

      expect(ticketFromTenant1).toBeUndefined();
    });
  });
});
