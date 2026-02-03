/**
 * SLA Service Integration Tests
 *
 * Tests SLA lifecycle with real database:
 * - SLA initialization on ticket create (policy assignment, due dates calculated)
 * - SLA response tracking (first comment marks response, sla_response_met set)
 * - SLA resolution tracking (ticket close marks resolution, sla_resolution_met set)
 * - Priority change recalculates due times
 * - No SLA set when no matching policy
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser, createClient } from '../../../../test-utils/testDataFactory';

// Mock external dependencies
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

// Import SLA service functions after mocks
let startSlaForTicket: typeof import('@alga-psa/sla/services').startSlaForTicket;
let recordFirstResponse: typeof import('@alga-psa/sla/services').recordFirstResponse;
let recordResolution: typeof import('@alga-psa/sla/services').recordResolution;
let handlePriorityChange: typeof import('@alga-psa/sla/services').handlePriorityChange;
let getSlaStatus: typeof import('@alga-psa/sla/services').getSlaStatus;

describe('SLA Service Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let otherTenantId: string;
  let boardId: string;
  let statusOpenId: string;
  let statusClosedId: string;
  let priorityHighId: string;
  let priorityMediumId: string;
  let priorityLowId: string;
  let slaPolicyId: string;
  let businessHoursScheduleId: string;
  let internalUserId: string;
  let clientId: string;
  let contactId: string;

  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();

    // Import SLA services
    ({
      startSlaForTicket,
      recordFirstResponse,
      recordResolution,
      handlePriorityChange,
      getSlaStatus,
    } = await import('@alga-psa/sla/services'));

    // Create test tenant
    tenantId = await createTenant(db, 'SLA Service Test Tenant');
    otherTenantId = await createTenant(db, 'Other SLA Tenant');

    // Create internal user
    internalUserId = await createUser(db, tenantId, {
      email: `sla-agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'SLA',
      last_name: 'Agent',
      user_type: 'internal',
    });

    // Create client
    clientId = await createClient(db, tenantId, 'SLA Test Client');
    contactId = await createContact(db, tenantId, clientId, `sla-contact-${uuidv4().slice(0, 8)}@example.com`);

    // Create board
    boardId = await createBoard(db, tenantId, 'SLA Test Board');

    // Create statuses
    statusOpenId = await createStatus(db, tenantId, 'Open', false);
    statusClosedId = await createStatus(db, tenantId, 'Closed', true);

    // Create priorities
    priorityHighId = await createPriority(db, tenantId, 'High', 1, internalUserId);
    priorityMediumId = await createPriority(db, tenantId, 'Medium', 2, internalUserId);
    priorityLowId = await createPriority(db, tenantId, 'Low', 3, internalUserId);

    // Create business hours schedule (9-5 Mon-Fri)
    businessHoursScheduleId = await createBusinessHoursSchedule(db, tenantId, '24x7 Schedule');

    // Create SLA policy with targets
    slaPolicyId = await createSlaPolicy(db, tenantId, 'Standard SLA', businessHoursScheduleId, true);

    // Create SLA targets for each priority
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityHighId, 30, 120); // 30min response, 2hr resolution
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityMediumId, 60, 240); // 1hr response, 4hr resolution
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityLowId, 120, 480); // 2hr response, 8hr resolution

  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    // Clean up tickets and SLA audit logs before each test
    await db('sla_audit_log').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('tickets').where({ tenant: tenantId }).delete().catch(() => undefined);
  });

  // ==========================================================================
  // SLA Initialization Tests
  // ==========================================================================
  describe('SLA Initialization on Ticket Create', () => {
    it('assigns SLA policy and calculates due dates for ticket with matching priority', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Test SLA Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        const result = await startSlaForTicket(
          trx,
          tenantId,
          ticketId,
          clientId,
          boardId,
          priorityHighId,
          createdAt
        );

        expect(result.success).toBe(true);
        expect(result.sla_policy_id).toBe(slaPolicyId);
        expect(result.sla_started_at).toEqual(createdAt);
        expect(result.sla_response_due_at).toBeDefined();
        expect(result.sla_resolution_due_at).toBeDefined();

        // Verify due dates are in the future
        expect(result.sla_response_due_at!.getTime()).toBeGreaterThan(createdAt.getTime());
        expect(result.sla_resolution_due_at!.getTime()).toBeGreaterThan(createdAt.getTime());
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_policy_id).toBe(slaPolicyId);
      expect(ticket.sla_started_at).toBeDefined();
      expect(ticket.sla_response_due_at).toBeDefined();
      expect(ticket.sla_resolution_due_at).toBeDefined();

      // Verify audit log
      const auditLog = await db('sla_audit_log')
        .where({ tenant: tenantId, ticket_id: ticketId, event_type: 'sla_started' })
        .first();
      expect(auditLog).toBeDefined();
    });

    it('uses client-specific SLA policy when available', async () => {
      // Create client-specific SLA policy
      const clientSlaPolicyId = await createSlaPolicy(db, tenantId, 'Client Premium SLA', businessHoursScheduleId, false);
      await createSlaPolicyTarget(db, tenantId, clientSlaPolicyId, priorityHighId, 15, 60); // 15min response, 1hr resolution

      // Assign policy to client
      await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ sla_policy_id: clientSlaPolicyId });

      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Client SLA Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        const result = await startSlaForTicket(
          trx,
          tenantId,
          ticketId,
          clientId,
          boardId,
          priorityHighId
        );

        expect(result.success).toBe(true);
        expect(result.sla_policy_id).toBe(clientSlaPolicyId);
      });

      // Clean up
      await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ sla_policy_id: null });
    });

    it('returns no SLA when no matching policy exists', async () => {
      // Create a new client without SLA policy
      const newClientId = await createClient(db, tenantId, 'No SLA Client');

      // Remove default policy temporarily
      await db('sla_policies').where({ tenant: tenantId, sla_policy_id: slaPolicyId }).update({ is_default: false });

      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'No SLA Ticket',
        clientId: newClientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        const result = await startSlaForTicket(
          trx,
          tenantId,
          ticketId,
          newClientId,
          boardId,
          priorityHighId
        );

        expect(result.success).toBe(true);
        expect(result.sla_policy_id).toBeNull();
        expect(result.sla_response_due_at).toBeNull();
        expect(result.sla_resolution_due_at).toBeNull();
      });

      // Restore default policy
      await db('sla_policies').where({ tenant: tenantId, sla_policy_id: slaPolicyId }).update({ is_default: true });
    });
  });

  // ==========================================================================
  // SLA Response Tracking Tests
  // ==========================================================================
  describe('SLA Response Tracking', () => {
    it('marks response as met when response is within SLA', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Response Test Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);

        // Record response within 30 minutes (High priority has 30min response target)
        const respondedAt = new Date(createdAt.getTime() + 15 * 60000); // 15 minutes later
        const result = await recordFirstResponse(trx, tenantId, ticketId, respondedAt, internalUserId);

        expect(result.success).toBe(true);
        expect(result.met).toBe(true);
        expect(result.recorded_at).toEqual(respondedAt);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_response_at).toBeDefined();
      expect(ticket.sla_response_met).toBe(true);
    });

    it('marks response as breached when response is after SLA', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Breached Response Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);

        // Record response after 30 minutes (High priority has 30min response target)
        const respondedAt = new Date(createdAt.getTime() + 45 * 60000); // 45 minutes later
        const result = await recordFirstResponse(trx, tenantId, ticketId, respondedAt, internalUserId);

        expect(result.success).toBe(true);
        expect(result.met).toBe(false);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_response_met).toBe(false);
    });

    it('does not update response if already recorded', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Double Response Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);

        // First response
        const firstResponseAt = new Date(createdAt.getTime() + 15 * 60000);
        await recordFirstResponse(trx, tenantId, ticketId, firstResponseAt, internalUserId);

        // Second response attempt should be a no-op
        const secondResponseAt = new Date(createdAt.getTime() + 20 * 60000);
        const result = await recordFirstResponse(trx, tenantId, ticketId, secondResponseAt, internalUserId);

        expect(result.success).toBe(true);
        expect(result.met).toBeNull(); // No change
      });

      // Verify first response is preserved
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(new Date(ticket.sla_response_at).getTime()).toBe(createdAt.getTime() + 15 * 60000);
    });
  });

  // ==========================================================================
  // SLA Resolution Tracking Tests
  // ==========================================================================
  describe('SLA Resolution Tracking', () => {
    it('marks resolution as met when resolved within SLA', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Resolution Test Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);

        // Record resolution within 2 hours (High priority has 120min resolution target)
        const resolvedAt = new Date(createdAt.getTime() + 90 * 60000); // 90 minutes later
        const result = await recordResolution(trx, tenantId, ticketId, resolvedAt, internalUserId);

        expect(result.success).toBe(true);
        expect(result.met).toBe(true);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_resolution_at).toBeDefined();
      expect(ticket.sla_resolution_met).toBe(true);
    });

    it('marks resolution as breached when resolved after SLA', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Breached Resolution Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);

        // Record resolution after 2 hours (High priority has 120min resolution target)
        const resolvedAt = new Date(createdAt.getTime() + 150 * 60000); // 150 minutes later
        const result = await recordResolution(trx, tenantId, ticketId, resolvedAt, internalUserId);

        expect(result.success).toBe(true);
        expect(result.met).toBe(false);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_resolution_met).toBe(false);
    });
  });

  // ==========================================================================
  // Priority Change Tests
  // ==========================================================================
  describe('Priority Change Recalculates Due Times', () => {
    it('recalculates due dates when priority changes', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Priority Change Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityLowId, // Start with Low priority
        boardId,
      });

      let originalResponseDue: Date | null = null;
      let originalResolutionDue: Date | null = null;

      await db.transaction(async (trx) => {
        // Start SLA with Low priority (2hr response, 8hr resolution)
        const result = await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityLowId, createdAt);
        originalResponseDue = result.sla_response_due_at;
        originalResolutionDue = result.sla_resolution_due_at;

        // Change to High priority (30min response, 2hr resolution)
        await handlePriorityChange(trx, tenantId, ticketId, priorityHighId, internalUserId);
      });

      // Verify ticket has new due dates
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();

      // New due dates should be earlier (High priority has shorter targets)
      expect(new Date(ticket.sla_response_due_at).getTime()).toBeLessThan(originalResponseDue!.getTime());
      expect(new Date(ticket.sla_resolution_due_at).getTime()).toBeLessThan(originalResolutionDue!.getTime());

      // Verify audit log
      const auditLog = await db('sla_audit_log')
        .where({ tenant: tenantId, ticket_id: ticketId, event_type: 'priority_changed' })
        .first();
      expect(auditLog).toBeDefined();
    });

    it('does not recalculate response due if already responded', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'Already Responded Priority Change',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityLowId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityLowId, createdAt);

        // Record response
        const respondedAt = new Date(createdAt.getTime() + 30 * 60000);
        await recordFirstResponse(trx, tenantId, ticketId, respondedAt, internalUserId);
      });

      const ticketBeforeChange = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      const responseDueBefore = ticketBeforeChange.sla_response_due_at;

      await db.transaction(async (trx) => {
        // Change priority
        await handlePriorityChange(trx, tenantId, ticketId, priorityHighId, internalUserId);
      });

      const ticketAfterChange = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();

      // Response due should not change since already responded
      expect(ticketAfterChange.sla_response_due_at?.toString()).toBe(responseDueBefore?.toString());
    });
  });

  // ==========================================================================
  // SLA Status Tests
  // ==========================================================================
  describe('SLA Status Calculation', () => {
    it('returns correct SLA status for ticket on track', async () => {
      const ticketId = uuidv4();
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'On Track Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityLowId, // Low priority - long SLA times
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityLowId, createdAt);
      });

      const status = await getSlaStatus(db, tenantId, ticketId);

      expect(status).toBeDefined();
      expect(status!.status).toBe('on_track');
      expect(status!.response_remaining_minutes).toBeGreaterThan(0);
      expect(status!.resolution_remaining_minutes).toBeGreaterThan(0);
      expect(status!.is_paused).toBe(false);
    });

    it('returns null for ticket without SLA', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SLA-${uuidv4().slice(0, 6)}`,
        title: 'No SLA Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      // Don't start SLA
      const status = await getSlaStatus(db, tenantId, ticketId);
      expect(status).toBeNull();
    });
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

async function createContact(db: Knex, tenant: string, clientId: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'SLA Test Contact',
    client_id: clientId,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return contactId;
}

async function createBoard(db: Knex, tenant: string, name: string): Promise<string> {
  const boardId = uuidv4();
  await db('boards').insert({
    tenant,
    board_id: boardId,
    name,
    description: 'Test board for SLA',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return boardId;
}

async function createStatus(db: Knex, tenant: string, name: string, isClosed: boolean): Promise<string> {
  const statusId = uuidv4();
  await db('statuses').insert({
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
  await db('priorities').insert({
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

async function createBusinessHoursSchedule(db: Knex, tenant: string, name: string): Promise<string> {
  const scheduleId = uuidv4();
  await db('business_hours_schedules').insert({
    tenant,
    schedule_id: scheduleId,
    schedule_name: name,
    timezone: 'UTC',
    is_default: true,
    is_24x7: true, // Use 24x7 for simplicity in tests
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return scheduleId;
}

async function createSlaPolicy(
  db: Knex,
  tenant: string,
  name: string,
  businessHoursScheduleId: string,
  isDefault: boolean
): Promise<string> {
  const policyId = uuidv4();
  await db('sla_policies').insert({
    tenant,
    sla_policy_id: policyId,
    policy_name: name,
    description: 'Test SLA policy',
    is_default: isDefault,
    business_hours_schedule_id: businessHoursScheduleId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return policyId;
}

async function createSlaPolicyTarget(
  db: Knex,
  tenant: string,
  slaPolicyId: string,
  priorityId: string,
  responseTimeMinutes: number,
  resolutionTimeMinutes: number
): Promise<string> {
  const targetId = uuidv4();
  await db('sla_policy_targets').insert({
    tenant,
    target_id: targetId,
    sla_policy_id: slaPolicyId,
    priority_id: priorityId,
    response_time_minutes: responseTimeMinutes,
    resolution_time_minutes: resolutionTimeMinutes,
    escalation_1_percent: 50,
    escalation_2_percent: 75,
    escalation_3_percent: 90,
    is_24x7: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return targetId;
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
}): Promise<void> {
  await db('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: params.ticketNumber,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}
