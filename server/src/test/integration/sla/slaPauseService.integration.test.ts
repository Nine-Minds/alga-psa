/**
 * SLA Pause Service Integration Tests
 *
 * Tests pause/resume with real database:
 * - SLA pauses when response_state changes to 'awaiting_client'
 * - SLA resumes when response_state changes from 'awaiting_client'
 * - Pause duration added to sla_total_pause_minutes
 * - SLA pauses/resumes based on status configuration
 * - Multiple pause/resume cycles accumulate correctly
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
let pauseSla: typeof import('@alga-psa/sla/services').pauseSla;
let resumeSla: typeof import('@alga-psa/sla/services').resumeSla;
let handleStatusChange: typeof import('@alga-psa/sla/services').handleStatusChange;
let handleResponseStateChange: typeof import('@alga-psa/sla/services').handleResponseStateChange;
let shouldSlaBePaused: typeof import('@alga-psa/sla/services').shouldSlaBePaused;
let getPauseStats: typeof import('@alga-psa/sla/services').getPauseStats;

describe('SLA Pause Service Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let boardId: string;
  let statusOpenId: string;
  let statusPendingId: string;
  let statusClosedId: string;
  let priorityHighId: string;
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
    ({ startSlaForTicket } = await import('@alga-psa/sla/services'));
    ({
      pauseSla,
      resumeSla,
      handleStatusChange,
      handleResponseStateChange,
      shouldSlaBePaused,
      getPauseStats,
    } = await import('@alga-psa/sla/services'));

    // Create test tenant
    tenantId = await createTenant(db, 'SLA Pause Test Tenant');

    // Create internal user
    internalUserId = await createUser(db, tenantId, {
      email: `pause-agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Pause',
      last_name: 'Agent',
      user_type: 'internal',
    });

    // Create client
    clientId = await createClient(db, tenantId, 'Pause Test Client');
    contactId = await createContact(db, tenantId, clientId, `pause-contact-${uuidv4().slice(0, 8)}@example.com`);

    // Create board
    boardId = await createBoard(db, tenantId, 'Pause Test Board');

    // Create statuses
    statusOpenId = await createStatus(db, tenantId, 'Open', false);
    statusPendingId = await createStatus(db, tenantId, 'Pending', false);
    statusClosedId = await createStatus(db, tenantId, 'Closed', true);

    // Create priority
    priorityHighId = await createPriority(db, tenantId, 'High', 1, internalUserId);

    // Create business hours schedule (24x7 for simplicity)
    businessHoursScheduleId = await createBusinessHoursSchedule(db, tenantId, '24x7 Schedule');

    // Create SLA policy with targets
    slaPolicyId = await createSlaPolicy(db, tenantId, 'Standard SLA', businessHoursScheduleId, true);
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityHighId, 60, 240); // 1hr response, 4hr resolution

    // Configure 'Pending' status to pause SLA
    await db('status_sla_pause_config').insert({
      tenant: tenantId,
      config_id: uuidv4(),
      status_id: statusPendingId,
      pauses_sla: true,
      created_at: db.fn.now(),
    });

    // Create SLA settings with pause_on_awaiting_client enabled
    await db('sla_settings').insert({
      tenant: tenantId,
      pause_on_awaiting_client: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }).onConflict('tenant').merge();

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
  // Direct Pause/Resume Tests
  // ==========================================================================
  describe('Direct Pause and Resume', () => {
    it('pauses SLA timer and sets sla_paused_at', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Pause Test Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        // Start SLA
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Pause SLA
        const result = await pauseSla(trx, tenantId, ticketId, 'awaiting_client', internalUserId);

        expect(result.success).toBe(true);
        expect(result.was_paused).toBe(false);
        expect(result.is_now_paused).toBe(true);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeDefined();

      // Verify audit log
      const auditLog = await db('sla_audit_log')
        .where({ tenant: tenantId, ticket_id: ticketId, event_type: 'sla_paused' })
        .first();
      expect(auditLog).toBeDefined();
    });

    it('resumes SLA timer and updates total pause minutes', async () => {
      const ticketId = uuidv4();
      const pausedAt = new Date(Date.now() - 30 * 60000); // 30 minutes ago

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `RESUME-${uuidv4().slice(0, 6)}`,
        title: 'Resume Test Ticket',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      // Start SLA and pause it
      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      // Manually set paused_at to simulate time passed
      await db('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({ sla_paused_at: pausedAt });

      await db.transaction(async (trx) => {
        // Resume SLA
        const result = await resumeSla(trx, tenantId, ticketId, internalUserId);

        expect(result.success).toBe(true);
        expect(result.was_paused).toBe(true);
        expect(result.is_now_paused).toBe(false);
        expect(result.pause_duration_minutes).toBeGreaterThanOrEqual(29); // At least 29 minutes
        expect(result.pause_duration_minutes).toBeLessThanOrEqual(31); // At most 31 minutes
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeNull();
      expect(ticket.sla_total_pause_minutes).toBeGreaterThanOrEqual(29);

      // Verify audit log
      const auditLog = await db('sla_audit_log')
        .where({ tenant: tenantId, ticket_id: ticketId, event_type: 'sla_resumed' })
        .first();
      expect(auditLog).toBeDefined();
    });

    it('returns no-op when pausing already paused SLA', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `DOUBLE-PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Double Pause Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
        await pauseSla(trx, tenantId, ticketId, 'awaiting_client', internalUserId);

        // Try to pause again
        const result = await pauseSla(trx, tenantId, ticketId, 'status_pause', internalUserId);

        expect(result.success).toBe(true);
        expect(result.was_paused).toBe(true);
        expect(result.is_now_paused).toBe(true);
      });
    });

    it('returns no-op when resuming non-paused SLA', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `NOT-PAUSED-${uuidv4().slice(0, 6)}`,
        title: 'Not Paused Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Try to resume non-paused SLA
        const result = await resumeSla(trx, tenantId, ticketId, internalUserId);

        expect(result.success).toBe(true);
        expect(result.was_paused).toBe(false);
        expect(result.is_now_paused).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Status-Based Pause Tests
  // ==========================================================================
  describe('Status-Based Pause', () => {
    it('pauses SLA when status changes to pause-configured status', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `STATUS-PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Status Pause Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Change status to Pending (configured to pause)
        const result = await handleStatusChange(
          trx,
          tenantId,
          ticketId,
          statusOpenId,
          statusPendingId,
          internalUserId
        );

        expect(result.success).toBe(true);
        expect(result.is_now_paused).toBe(true);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeDefined();
    });

    it('resumes SLA when status changes from pause-configured status', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `STATUS-RESUME-${uuidv4().slice(0, 6)}`,
        title: 'Status Resume Test',
        clientId,
        contactId,
        statusId: statusPendingId, // Start in Pending status
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
        await pauseSla(trx, tenantId, ticketId, 'status_pause', internalUserId);
      });

      // Wait a bit to accumulate pause time
      await new Promise(resolve => setTimeout(resolve, 100));

      await db.transaction(async (trx) => {
        // Change status to Open (not configured to pause)
        const result = await handleStatusChange(
          trx,
          tenantId,
          ticketId,
          statusPendingId,
          statusOpenId,
          internalUserId
        );

        expect(result.success).toBe(true);
        expect(result.is_now_paused).toBe(false);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeNull();
    });
  });

  // ==========================================================================
  // Awaiting Client Pause Tests
  // ==========================================================================
  describe('Awaiting Client Pause', () => {
    it('pauses SLA when response_state changes to awaiting_client', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `AWAIT-PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Awaiting Client Pause Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Change response_state to awaiting_client
        const result = await handleResponseStateChange(
          trx,
          tenantId,
          ticketId,
          null,
          'awaiting_client',
          internalUserId
        );

        expect(result.success).toBe(true);
        expect(result.is_now_paused).toBe(true);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeDefined();
    });

    it('resumes SLA when response_state changes from awaiting_client', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `AWAIT-RESUME-${uuidv4().slice(0, 6)}`,
        title: 'Awaiting Client Resume Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        responseState: 'awaiting_client',
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
        await pauseSla(trx, tenantId, ticketId, 'awaiting_client', internalUserId);
      });

      await db.transaction(async (trx) => {
        // Change response_state from awaiting_client to awaiting_internal
        const result = await handleResponseStateChange(
          trx,
          tenantId,
          ticketId,
          'awaiting_client',
          'awaiting_internal',
          internalUserId
        );

        expect(result.success).toBe(true);
        expect(result.is_now_paused).toBe(false);
      });

      // Verify ticket was updated
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      expect(ticket.sla_paused_at).toBeNull();
    });

    it('keeps SLA paused when changing from awaiting_client but status also pauses', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `DOUBLE-PAUSE-REASON-${uuidv4().slice(0, 6)}`,
        title: 'Double Pause Reason Test',
        clientId,
        contactId,
        statusId: statusPendingId, // Status that pauses SLA
        priorityId: priorityHighId,
        boardId,
        responseState: 'awaiting_client',
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
        await pauseSla(trx, tenantId, ticketId, 'awaiting_client', internalUserId);
      });

      await db.transaction(async (trx) => {
        // Change response_state from awaiting_client - but status still pauses
        const result = await handleResponseStateChange(
          trx,
          tenantId,
          ticketId,
          'awaiting_client',
          'awaiting_internal',
          internalUserId
        );

        expect(result.success).toBe(true);
        expect(result.is_now_paused).toBe(true); // Still paused due to status
      });
    });
  });

  // ==========================================================================
  // Multiple Pause/Resume Cycles Tests
  // ==========================================================================
  describe('Multiple Pause/Resume Cycles', () => {
    it('accumulates pause time correctly over multiple cycles', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `MULTI-CYCLE-${uuidv4().slice(0, 6)}`,
        title: 'Multi Cycle Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      // First pause cycle - simulate 10 minutes
      await db('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({ sla_paused_at: new Date(Date.now() - 10 * 60000) });

      await db.transaction(async (trx) => {
        await resumeSla(trx, tenantId, ticketId, internalUserId);
      });

      let ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      const firstCyclePause = ticket.sla_total_pause_minutes || 0;
      expect(firstCyclePause).toBeGreaterThanOrEqual(9);
      expect(firstCyclePause).toBeLessThanOrEqual(11);

      // Second pause cycle - simulate 20 minutes
      await db('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({ sla_paused_at: new Date(Date.now() - 20 * 60000) });

      await db.transaction(async (trx) => {
        await resumeSla(trx, tenantId, ticketId, internalUserId);
      });

      ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      const totalPause = ticket.sla_total_pause_minutes || 0;

      // Total should be approximately 30 minutes (10 + 20)
      expect(totalPause).toBeGreaterThanOrEqual(28);
      expect(totalPause).toBeLessThanOrEqual(32);
    });
  });

  // ==========================================================================
  // Pause Stats Tests
  // ==========================================================================
  describe('Pause Statistics', () => {
    it('returns correct pause stats for paused ticket', async () => {
      const ticketId = uuidv4();
      const pausedAt = new Date(Date.now() - 15 * 60000); // 15 minutes ago

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `STATS-${uuidv4().slice(0, 6)}`,
        title: 'Pause Stats Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        responseState: 'awaiting_client',
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      // Manually set paused_at and total_pause_minutes
      await db('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({
          sla_paused_at: pausedAt,
          sla_total_pause_minutes: 30, // Previous pause time
        });

      const stats = await getPauseStats(db, tenantId, ticketId);

      expect(stats).toBeDefined();
      expect(stats!.is_paused).toBe(true);
      expect(stats!.paused_at).toBeDefined();
      expect(stats!.total_pause_minutes).toBe(30);
      expect(stats!.current_pause_minutes).toBeGreaterThanOrEqual(14);
      expect(stats!.current_pause_minutes).toBeLessThanOrEqual(16);
      expect(stats!.pause_reason).toBe('awaiting_client');
    });

    it('returns correct pause stats for non-paused ticket', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `STATS-NOT-PAUSED-${uuidv4().slice(0, 6)}`,
        title: 'Not Paused Stats Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      // Set some previous pause time
      await db('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({ sla_total_pause_minutes: 45 });

      const stats = await getPauseStats(db, tenantId, ticketId);

      expect(stats).toBeDefined();
      expect(stats!.is_paused).toBe(false);
      expect(stats!.paused_at).toBeNull();
      expect(stats!.total_pause_minutes).toBe(45);
      expect(stats!.current_pause_minutes).toBe(0);
      expect(stats!.pause_reason).toBeNull();
    });
  });

  // ==========================================================================
  // Should Pause Check Tests
  // ==========================================================================
  describe('Should Pause Check', () => {
    it('returns paused=true for awaiting_client when setting enabled', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SHOULD-PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Should Pause Test',
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        responseState: 'awaiting_client',
      });

      const result = await shouldSlaBePaused(db, tenantId, ticketId);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('returns paused=true for status_pause when status configured', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SHOULD-PAUSE-STATUS-${uuidv4().slice(0, 6)}`,
        title: 'Should Pause Status Test',
        clientId,
        contactId,
        statusId: statusPendingId, // Configured to pause
        priorityId: priorityHighId,
        boardId,
      });

      const result = await shouldSlaBePaused(db, tenantId, ticketId);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('returns paused=false when no pause conditions met', async () => {
      const ticketId = uuidv4();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `SHOULD-NOT-PAUSE-${uuidv4().slice(0, 6)}`,
        title: 'Should Not Pause Test',
        clientId,
        contactId,
        statusId: statusOpenId, // Not configured to pause
        priorityId: priorityHighId,
        boardId,
        responseState: 'awaiting_internal', // Not awaiting_client
      });

      const result = await shouldSlaBePaused(db, tenantId, ticketId);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
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
    full_name: 'Pause Test Contact',
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
    description: 'Test board for SLA pause',
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
    order_number: isClosed ? 100 : name === 'Pending' ? 50 : 1,
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
    is_24x7: true,
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
  responseState?: 'awaiting_client' | 'awaiting_internal' | null;
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
    response_state: params.responseState ?? null,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}
