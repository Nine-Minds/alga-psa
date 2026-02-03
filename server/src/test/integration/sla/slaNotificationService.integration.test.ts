/**
 * SLA Notification Service Integration Tests
 *
 * Tests notifications with real database:
 * - Notification sent at configured thresholds
 * - Duplicate notification prevention
 * - Notification recipients (assignee, board manager)
 * - In-app notification created
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

// Track in-app notifications created
const createdNotifications: Array<{
  tenant: string;
  user_id: string;
  template_name: string;
  data: Record<string, unknown>;
}> = [];

vi.mock('@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateInternal: vi.fn(async (trx: any, params: any) => {
    createdNotifications.push({
      tenant: params.tenant,
      user_id: params.user_id,
      template_name: params.template_name,
      data: params.data,
    });
    return { notification_id: uuidv4() };
  }),
}));

vi.mock('@alga-psa/notifications/notifications/email', () => ({
  getEmailNotificationService: vi.fn(() => ({
    sendNotification: vi.fn(async () => {}),
  })),
}));

// Import SLA service functions after mocks
let startSlaForTicket: typeof import('@alga-psa/sla/services').startSlaForTicket;
let sendSlaNotification: typeof import('@alga-psa/sla/services').sendSlaNotification;
let checkAndSendThresholdNotifications: typeof import('@alga-psa/sla/services').checkAndSendThresholdNotifications;

describe('SLA Notification Service Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let boardId: string;
  let statusOpenId: string;
  let priorityHighId: string;
  let slaPolicyId: string;
  let businessHoursScheduleId: string;
  let assigneeUserId: string;
  let boardManagerId: string;
  let escalationManagerId: string;
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
      sendSlaNotification,
      checkAndSendThresholdNotifications,
    } = await import('@alga-psa/sla/services'));

    // Create test tenant
    tenantId = await createTenant(db, 'SLA Notification Test Tenant');

    // Create users
    assigneeUserId = await createUser(db, tenantId, {
      email: `assignee-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Ticket',
      last_name: 'Assignee',
      user_type: 'internal',
    });

    boardManagerId = await createUser(db, tenantId, {
      email: `board-manager-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Board',
      last_name: 'Manager',
      user_type: 'internal',
    });

    escalationManagerId = await createUser(db, tenantId, {
      email: `escalation-manager-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Escalation',
      last_name: 'Manager',
      user_type: 'internal',
    });

    // Create client
    clientId = await createClient(db, tenantId, 'Notification Test Client');
    contactId = await createContact(db, tenantId, clientId, `notify-contact-${uuidv4().slice(0, 8)}@example.com`);

    // Create board with manager
    boardId = await createBoard(db, tenantId, 'Notification Test Board', boardManagerId);

    // Create status
    statusOpenId = await createStatus(db, tenantId, 'Open', false);

    // Create priority
    priorityHighId = await createPriority(db, tenantId, 'High', 1, assigneeUserId);

    // Create business hours schedule (24x7 for simplicity)
    businessHoursScheduleId = await createBusinessHoursSchedule(db, tenantId, '24x7 Schedule');

    // Create SLA policy with escalation manager
    slaPolicyId = await createSlaPolicy(db, tenantId, 'Standard SLA', businessHoursScheduleId, true, escalationManagerId);
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityHighId, 60, 240); // 1hr response, 4hr resolution

    // Create notification thresholds
    await createNotificationThreshold(db, tenantId, slaPolicyId, 50, 'warning', true, true, false);
    await createNotificationThreshold(db, tenantId, slaPolicyId, 75, 'warning', true, true, true);
    await createNotificationThreshold(db, tenantId, slaPolicyId, 100, 'breach', true, true, true);

  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    // Clean up before each test
    createdNotifications.length = 0;
    await db('sla_audit_log').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('tickets').where({ tenant: tenantId }).delete().catch(() => undefined);
  });

  // ==========================================================================
  // Send SLA Notification Tests
  // ==========================================================================
  describe('Send SLA Notification', () => {
    it('sends notification to assignee and board manager at warning threshold', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `NOTIF-${uuidv4().slice(0, 6)}`;
      const title = 'Warning Notification Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Send 50% warning notification
        const result = await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: assigneeUserId,
          boardId,
          slaPolicyId,
          thresholdPercent: 50,
          slaType: 'response',
          remainingMinutes: 30,
          dueAt: new Date(Date.now() + 30 * 60000),
        });

        expect(result.success).toBe(true);
        expect(result.recipientCount).toBe(2); // Assignee + Board Manager
        expect(result.inAppSent).toBeGreaterThanOrEqual(1);
      });

      // Verify in-app notifications were created
      expect(createdNotifications.length).toBeGreaterThanOrEqual(1);
      expect(createdNotifications.some(n => n.user_id === assigneeUserId)).toBe(true);
      expect(createdNotifications.some(n => n.user_id === boardManagerId)).toBe(true);

      // Verify audit log
      const auditLog = await db('sla_audit_log')
        .where({ tenant: tenantId, ticket_id: ticketId, event_type: 'notification_sent' })
        .first();
      expect(auditLog).toBeDefined();
    });

    it('sends notification to escalation manager at higher thresholds', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `ESCAL-${uuidv4().slice(0, 6)}`;
      const title = 'Escalation Notification Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Send 75% warning notification (includes escalation manager)
        const result = await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: assigneeUserId,
          boardId,
          slaPolicyId,
          thresholdPercent: 75,
          slaType: 'response',
          remainingMinutes: 15,
          dueAt: new Date(Date.now() + 15 * 60000),
        });

        expect(result.success).toBe(true);
        expect(result.recipientCount).toBe(3); // Assignee + Board Manager + Escalation Manager
      });

      // Verify escalation manager received notification
      expect(createdNotifications.some(n => n.user_id === escalationManagerId)).toBe(true);
    });

    it('sends breach notification when threshold is 100% or more', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `BREACH-${uuidv4().slice(0, 6)}`;
      const title = 'Breach Notification Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Send 100% breach notification
        const result = await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: assigneeUserId,
          boardId,
          slaPolicyId,
          thresholdPercent: 100,
          slaType: 'response',
          remainingMinutes: 0,
          dueAt: new Date(),
        });

        expect(result.success).toBe(true);
      });

      // Verify breach notification was sent
      expect(createdNotifications.some(n => n.template_name === 'sla-breach')).toBe(true);
    });

    it('returns success with zero recipients when no threshold configured', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `NO-THRESH-${uuidv4().slice(0, 6)}`;
      const title = 'No Threshold Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Send notification at 25% - no threshold configured for this
        const result = await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: assigneeUserId,
          boardId,
          slaPolicyId,
          thresholdPercent: 25, // No threshold configured for 25%
          slaType: 'response',
          remainingMinutes: 45,
          dueAt: new Date(Date.now() + 45 * 60000),
        });

        expect(result.success).toBe(true);
        expect(result.recipientCount).toBe(0);
      });
    });

    it('does not send notification when assignee is not set', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `NO-ASSIGN-${uuidv4().slice(0, 6)}`;
      const title = 'No Assignee Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: null, // No assignee
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        // Send 50% warning notification
        const result = await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: null, // No assignee
          boardId,
          slaPolicyId,
          thresholdPercent: 50,
          slaType: 'response',
          remainingMinutes: 30,
          dueAt: new Date(Date.now() + 30 * 60000),
        });

        expect(result.success).toBe(true);
        // Should only notify board manager (notify_assignee=true but no assignee)
        expect(result.recipientCount).toBe(1);
      });
    });
  });

  // ==========================================================================
  // Check and Send Threshold Notifications Tests
  // ==========================================================================
  describe('Check and Send Threshold Notifications', () => {
    it('sends notification when threshold is crossed', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `THRESH-CROSS-${uuidv4().slice(0, 6)}`;
      const title = 'Threshold Cross Test';
      const createdAt = new Date();

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId, createdAt);
      });

      // Update ticket to have response_due_at and proper SLA fields
      const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();

      await db.transaction(async (trx) => {
        // Check at 60% elapsed (past 50% threshold, not yet at 75%)
        const result = await checkAndSendThresholdNotifications(
          trx,
          tenantId,
          ticketId,
          60, // 60% elapsed
          'response',
          0 // Last notified threshold
        );

        expect(result.notifiedThreshold).toBe(50); // Should notify at 50% threshold
        expect(result.result).toBeDefined();
        if (result.result) {
          expect(result.result.success).toBe(true);
        }
      });
    });

    it('skips notification when already notified at threshold', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `ALREADY-NOTIF-${uuidv4().slice(0, 6)}`;
      const title = 'Already Notified Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      await db.transaction(async (trx) => {
        // Check at 60% elapsed, already notified at 50%
        const result = await checkAndSendThresholdNotifications(
          trx,
          tenantId,
          ticketId,
          60,
          'response',
          50 // Already notified at 50%
        );

        expect(result.notifiedThreshold).toBe(50); // No new threshold crossed
        expect(result.result).toBeNull();
      });
    });

    it('sends notification at next threshold when crossing multiple', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `MULTI-THRESH-${uuidv4().slice(0, 6)}`;
      const title = 'Multi Threshold Test';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);
      });

      await db.transaction(async (trx) => {
        // Check at 80% elapsed (past 50% and 75% thresholds)
        const result = await checkAndSendThresholdNotifications(
          trx,
          tenantId,
          ticketId,
          80,
          'response',
          0
        );

        // Should notify at the highest crossed threshold (75%)
        expect(result.notifiedThreshold).toBe(75);
      });
    });
  });

  // ==========================================================================
  // Notification Content Tests
  // ==========================================================================
  describe('Notification Content', () => {
    it('includes ticket details in notification data', async () => {
      const ticketId = uuidv4();
      const ticketNumber = `CONTENT-${uuidv4().slice(0, 6)}`;
      const title = 'Content Test Ticket';

      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title,
        clientId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: assigneeUserId,
      });

      await db.transaction(async (trx) => {
        await startSlaForTicket(trx, tenantId, ticketId, clientId, boardId, priorityHighId);

        await sendSlaNotification(trx, {
          tenant: tenantId,
          ticketId,
          ticketNumber,
          ticketTitle: title,
          clientName: 'Notification Test Client',
          priorityName: 'High',
          assigneeId: assigneeUserId,
          boardId,
          slaPolicyId,
          thresholdPercent: 50,
          slaType: 'response',
          remainingMinutes: 30,
          dueAt: new Date(Date.now() + 30 * 60000),
        });
      });

      // Find notification for assignee
      const notification = createdNotifications.find(n => n.user_id === assigneeUserId);
      expect(notification).toBeDefined();
      expect(notification!.data.ticketNumber).toBe(ticketNumber);
      expect(notification!.data.ticketTitle).toBe(title);
      expect(notification!.data.clientName).toBe('Notification Test Client');
      expect(notification!.data.priorityName).toBe('High');
      expect(notification!.data.slaType).toBe('Response');
      expect(notification!.data.thresholdPercent).toBe(50);
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
  await db('boards').insert({
    tenant,
    board_id: boardId,
    name,
    description: 'Test board for SLA notifications',
    manager_user_id: managerUserId,
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
  isDefault: boolean,
  escalationManagerId?: string
): Promise<string> {
  const policyId = uuidv4();
  await db('sla_policies').insert({
    tenant,
    sla_policy_id: policyId,
    policy_name: name,
    description: 'Test SLA policy',
    is_default: isDefault,
    business_hours_schedule_id: businessHoursScheduleId,
    escalation_manager_id: escalationManagerId || null,
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

async function createNotificationThreshold(
  db: Knex,
  tenant: string,
  slaPolicyId: string,
  thresholdPercent: number,
  notificationType: 'warning' | 'breach',
  notifyAssignee: boolean,
  notifyBoardManager: boolean,
  notifyEscalationManager: boolean
): Promise<string> {
  const thresholdId = uuidv4();
  await db('sla_notification_thresholds').insert({
    tenant,
    threshold_id: thresholdId,
    sla_policy_id: slaPolicyId,
    threshold_percent: thresholdPercent,
    notification_type: notificationType,
    notify_assignee: notifyAssignee,
    notify_board_manager: notifyBoardManager,
    notify_escalation_manager: notifyEscalationManager,
    channels: JSON.stringify(['in_app']),
    created_at: db.fn.now(),
  });
  return thresholdId;
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
    assigned_to: params.assignedTo,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}
