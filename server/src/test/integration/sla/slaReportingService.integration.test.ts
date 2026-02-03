/**
 * SLA Reporting Service Integration Tests (Phase 5)
 *
 * Tests reporting with real database:
 * - getSlaOverview returns correct metrics
 * - getSlaComplianceRate calculates correctly
 * - getSlaTrend returns daily data points
 * - getBreachRateByPriority groups correctly
 * - getRecentBreaches returns recent breaches
 * - getTicketsAtRisk returns at-risk tickets
 * - Date range filtering works
 * - Multi-tenant data isolation
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

// Mock database and auth for reporting actions
let mockTenantId: string;
let mockDb: Knex;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: mockDb, tenant: mockTenantId })),
  withTransaction: vi.fn(async (db: Knex, callback: (trx: Knex.Transaction) => Promise<any>) => {
    return db.transaction(async (trx) => callback(trx));
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: vi.fn((fn: Function) => {
    return async (...args: any[]) => {
      const mockUser = { user_id: 'mock-user' };
      const mockContext = { tenant: mockTenantId };
      return fn(mockUser, mockContext, ...args);
    };
  }),
}));

// Import SLA reporting actions after mocks
let getSlaComplianceRate: typeof import('@alga-psa/sla/actions').getSlaComplianceRate;
let getBreachRateByPriority: typeof import('@alga-psa/sla/actions').getBreachRateByPriority;
let getSlaTrend: typeof import('@alga-psa/sla/actions').getSlaTrend;
let getRecentBreaches: typeof import('@alga-psa/sla/actions').getRecentBreaches;
let getTicketsAtRisk: typeof import('@alga-psa/sla/actions').getTicketsAtRisk;
let getSlaOverview: typeof import('@alga-psa/sla/actions').getSlaOverview;

describe('SLA Reporting Service Integration Tests', () => {
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
  let otherInternalUserId: string;
  let clientId: string;
  let contactId: string;
  let companyId: string;

  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    mockDb = db;

    // Import SLA reporting actions
    ({
      getSlaComplianceRate,
      getBreachRateByPriority,
      getSlaTrend,
      getRecentBreaches,
      getTicketsAtRisk,
      getSlaOverview,
    } = await import('@alga-psa/sla/actions'));

    // Create test tenants
    tenantId = await createTenant(db, 'SLA Reporting Test Tenant');
    otherTenantId = await createTenant(db, 'Other Reporting Tenant');
    mockTenantId = tenantId;

    // Create users
    internalUserId = await createUser(db, tenantId, {
      email: `report-agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Report',
      last_name: 'Agent',
      user_type: 'internal',
    });

    otherInternalUserId = await createUser(db, tenantId, {
      email: `report-agent2-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Another',
      last_name: 'Agent',
      user_type: 'internal',
    });

    // Create company (for tickets)
    companyId = uuidv4();
    await db('companies').insert({
      tenant: tenantId,
      company_id: companyId,
      company_name: 'Reporting Test Company',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Create client linked to company
    clientId = await createClient(db, tenantId, 'Reporting Test Client');
    contactId = await createContact(db, tenantId, clientId, companyId, `report-contact-${uuidv4().slice(0, 8)}@example.com`);

    // Create board
    boardId = await createBoard(db, tenantId, 'Reporting Test Board');

    // Create statuses
    statusOpenId = await createStatus(db, tenantId, 'Open', false);
    statusClosedId = await createStatus(db, tenantId, 'Closed', true);

    // Create priorities with order
    priorityHighId = await createPriority(db, tenantId, 'High', 1, internalUserId);
    priorityMediumId = await createPriority(db, tenantId, 'Medium', 2, internalUserId);
    priorityLowId = await createPriority(db, tenantId, 'Low', 3, internalUserId);

    // Create business hours schedule (24x7 for simplicity)
    businessHoursScheduleId = await createBusinessHoursSchedule(db, tenantId, '24x7 Schedule');

    // Create SLA policy with targets
    slaPolicyId = await createSlaPolicy(db, tenantId, 'Standard SLA', businessHoursScheduleId, true);
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityHighId, 30, 120);
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityMediumId, 60, 240);
    await createSlaPolicyTarget(db, tenantId, slaPolicyId, priorityLowId, 120, 480);

  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    // Clean up tickets before each test
    await db('tickets').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db('tickets').where({ tenant: otherTenantId }).delete().catch(() => undefined);
    mockTenantId = tenantId;
  });

  // ==========================================================================
  // Compliance Rate Tests
  // ==========================================================================
  describe('getSlaComplianceRate', () => {
    it('returns correct compliance rate with all SLAs met', async () => {
      // Create tickets with SLA met
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });

      const result = await getSlaComplianceRate({});

      expect(result.totalTickets).toBe(2);
      expect(result.responseMetCount).toBe(2);
      expect(result.responseBreachedCount).toBe(0);
      expect(result.resolutionMetCount).toBe(2);
      expect(result.resolutionBreachedCount).toBe(0);
      expect(result.responseRate).toBe(100);
      expect(result.resolutionRate).toBe(100);
      expect(result.overallRate).toBe(100);
    });

    it('returns correct compliance rate with mixed results', async () => {
      // 2 met, 2 breached
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: false, // Resolution breached
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityLowId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false, // Response breached
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: false, // Both breached
      });

      const result = await getSlaComplianceRate({});

      expect(result.totalTickets).toBe(4);
      expect(result.responseMetCount).toBe(2);
      expect(result.responseBreachedCount).toBe(2);
      expect(result.resolutionMetCount).toBe(2);
      expect(result.resolutionBreachedCount).toBe(2);
      expect(result.responseRate).toBe(50);
      expect(result.resolutionRate).toBe(50);
      expect(result.overallRate).toBe(50);
    });

    it('returns 100% when no tickets have SLA tracking', async () => {
      // Create ticket without SLA
      await insertTicket(db, {
        tenant: tenantId,
        ticketId: uuidv4(),
        ticketNumber: `NO-SLA-${uuidv4().slice(0, 6)}`,
        title: 'No SLA Ticket',
        companyId,
        contactId,
        statusId: statusClosedId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: internalUserId,
        slaPolicyId: null, // No SLA
      });

      const result = await getSlaComplianceRate({});

      expect(result.totalTickets).toBe(0); // Tickets without SLA are not counted
      expect(result.overallRate).toBe(100);
    });
  });

  // ==========================================================================
  // Breach Rate by Priority Tests
  // ==========================================================================
  describe('getBreachRateByPriority', () => {
    it('groups breach rate correctly by priority', async () => {
      // High priority: 1 met, 1 breached = 50%
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: true,
      });

      // Medium priority: 2 met, 0 breached = 0%
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });

      const result = await getBreachRateByPriority({});

      expect(result.length).toBeGreaterThanOrEqual(2);

      const highResult = result.find(r => r.dimensionId === priorityHighId);
      const mediumResult = result.find(r => r.dimensionId === priorityMediumId);

      expect(highResult).toBeDefined();
      expect(highResult!.totalTickets).toBe(2);
      expect(highResult!.breachedCount).toBe(1);
      expect(highResult!.breachRate).toBe(50);

      expect(mediumResult).toBeDefined();
      expect(mediumResult!.totalTickets).toBe(2);
      expect(mediumResult!.breachedCount).toBe(0);
      expect(mediumResult!.breachRate).toBe(0);
    });
  });

  // ==========================================================================
  // SLA Trend Tests
  // ==========================================================================
  describe('getSlaTrend', () => {
    it('returns daily trend data points', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      // Create tickets closed on different days
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
        closedAt: today,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: true,
        closedAt: yesterday,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: false,
        closedAt: twoDaysAgo,
      });

      const result = await getSlaTrend({}, 7);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('complianceRate');
      expect(result[0]).toHaveProperty('ticketCount');
      expect(result[0]).toHaveProperty('breachCount');
    });
  });

  // ==========================================================================
  // Recent Breaches Tests
  // ==========================================================================
  describe('getRecentBreaches', () => {
    it('returns recent breached tickets', async () => {
      // Create breached ticket
      const breachedTicketId = await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: false,
      });

      // Create non-breached ticket
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });

      const result = await getRecentBreaches({}, 10);

      expect(result.length).toBe(1);
      expect(result[0].ticketId).toBe(breachedTicketId);
      expect(result[0].responseBreached).toBe(true);
      expect(result[0].resolutionBreached).toBe(true);
      expect(result[0]).toHaveProperty('ticketNumber');
      expect(result[0]).toHaveProperty('ticketTitle');
      expect(result[0]).toHaveProperty('companyName');
      expect(result[0]).toHaveProperty('priorityName');
    });

    it('returns only response-breached tickets', async () => {
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: true, // Only response breached
      });

      const result = await getRecentBreaches({}, 10);

      expect(result.length).toBe(1);
      expect(result[0].responseBreached).toBe(true);
      expect(result[0].resolutionBreached).toBe(false);
    });

    it('limits results correctly', async () => {
      // Create 5 breached tickets
      for (let i = 0; i < 5; i++) {
        await createTicketWithSlaResult(db, tenantId, {
          priorityId: priorityHighId,
          statusId: statusClosedId,
          slaPolicyId,
          companyId,
          boardId,
          assignedTo: internalUserId,
          responseMet: false,
          resolutionMet: false,
        });
      }

      const result = await getRecentBreaches({}, 3);

      expect(result.length).toBe(3);
    });
  });

  // ==========================================================================
  // Tickets at Risk Tests
  // ==========================================================================
  describe('getTicketsAtRisk', () => {
    it('returns tickets that are at risk of breach', async () => {
      const now = new Date();
      const ticketId = uuidv4();

      // Create open ticket with SLA started and near breach
      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `RISK-${uuidv4().slice(0, 6)}`,
        title: 'At Risk Ticket',
        companyId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: internalUserId,
        slaPolicyId,
      });

      // Set SLA fields to make it at risk (75% elapsed)
      const startedAt = new Date(now.getTime() - 90 * 60000); // 90 minutes ago
      const responseDueAt = new Date(now.getTime() + 30 * 60000); // Due in 30 minutes (started 90 min ago, 30 min target = 120 total, 75% elapsed)
      const resolutionDueAt = new Date(now.getTime() + 60 * 60000);

      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).update({
        sla_started_at: startedAt,
        sla_response_due_at: responseDueAt,
        sla_resolution_due_at: resolutionDueAt,
      });

      const result = await getTicketsAtRisk(10);

      expect(result.length).toBeGreaterThanOrEqual(1);
      const atRiskTicket = result.find(t => t.ticketId === ticketId);
      expect(atRiskTicket).toBeDefined();
      expect(atRiskTicket!.percentElapsed).toBeGreaterThanOrEqual(50);
      expect(atRiskTicket!).toHaveProperty('ticketNumber');
      expect(atRiskTicket!).toHaveProperty('companyName');
      expect(atRiskTicket!).toHaveProperty('priorityName');
      expect(atRiskTicket!).toHaveProperty('dueAt');
    });

    it('excludes paused tickets', async () => {
      const now = new Date();
      const ticketId = uuidv4();

      // Create paused ticket
      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `PAUSED-RISK-${uuidv4().slice(0, 6)}`,
        title: 'Paused At Risk Ticket',
        companyId,
        contactId,
        statusId: statusOpenId,
        priorityId: priorityHighId,
        boardId,
        assignedTo: internalUserId,
        slaPolicyId,
      });

      // Set SLA fields and mark as paused
      const startedAt = new Date(now.getTime() - 90 * 60000);
      const responseDueAt = new Date(now.getTime() + 30 * 60000);

      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).update({
        sla_started_at: startedAt,
        sla_response_due_at: responseDueAt,
        sla_resolution_due_at: new Date(now.getTime() + 60 * 60000),
        sla_paused_at: now, // Paused
      });

      const result = await getTicketsAtRisk(10);

      const pausedTicket = result.find(t => t.ticketId === ticketId);
      expect(pausedTicket).toBeUndefined(); // Should not include paused tickets
    });

    it('excludes closed tickets', async () => {
      const now = new Date();
      const ticketId = uuidv4();

      // Create closed ticket
      await insertTicket(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber: `CLOSED-RISK-${uuidv4().slice(0, 6)}`,
        title: 'Closed At Risk Ticket',
        companyId,
        contactId,
        statusId: statusClosedId, // Closed
        priorityId: priorityHighId,
        boardId,
        assignedTo: internalUserId,
        slaPolicyId,
      });

      const startedAt = new Date(now.getTime() - 90 * 60000);
      const responseDueAt = new Date(now.getTime() + 30 * 60000);

      await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).update({
        sla_started_at: startedAt,
        sla_response_due_at: responseDueAt,
        sla_resolution_due_at: new Date(now.getTime() + 60 * 60000),
      });

      const result = await getTicketsAtRisk(10);

      const closedTicket = result.find(t => t.ticketId === ticketId);
      expect(closedTicket).toBeUndefined(); // Should not include closed tickets
    });
  });

  // ==========================================================================
  // Date Range Filtering Tests
  // ==========================================================================
  describe('Date Range Filtering', () => {
    it('filters compliance rate by date range', async () => {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sixtyDaysAgo = new Date(today);
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      // Recent ticket (within 30 days) - breached
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: false,
        createdAt: today,
      });

      // Old ticket (60 days ago) - met
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
        createdAt: sixtyDaysAgo,
      });

      // Filter for last 30 days only
      const result = await getSlaComplianceRate({
        dateFrom: thirtyDaysAgo.toISOString().split('T')[0],
        dateTo: today.toISOString().split('T')[0],
      });

      // Should only include the recent breached ticket
      expect(result.totalTickets).toBe(1);
      expect(result.overallRate).toBe(0);
    });
  });

  // ==========================================================================
  // Multi-Tenant Isolation Tests
  // ==========================================================================
  describe('Multi-Tenant Data Isolation', () => {
    it('only returns data for current tenant', async () => {
      // Create ticket in main tenant
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: false,
      });

      // Set up other tenant data
      const otherUserId = await createUser(db, otherTenantId, {
        email: `other-user-${uuidv4().slice(0, 8)}@example.com`,
        first_name: 'Other',
        last_name: 'User',
        user_type: 'internal',
      });
      const otherCompanyId = uuidv4();
      await db('companies').insert({
        tenant: otherTenantId,
        company_id: otherCompanyId,
        company_name: 'Other Company',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      const otherBoardId = await createBoard(db, otherTenantId, 'Other Board');
      const otherStatusId = await createStatus(db, otherTenantId, 'Open', false);
      const otherPriorityId = await createPriority(db, otherTenantId, 'High', 1, otherUserId);
      const otherScheduleId = await createBusinessHoursSchedule(db, otherTenantId, 'Other Schedule');
      const otherPolicyId = await createSlaPolicy(db, otherTenantId, 'Other Policy', otherScheduleId, true);

      // Create ticket in other tenant
      await createTicketWithSlaResult(db, otherTenantId, {
        priorityId: otherPriorityId,
        statusId: otherStatusId,
        slaPolicyId: otherPolicyId,
        companyId: otherCompanyId,
        boardId: otherBoardId,
        assignedTo: otherUserId,
        responseMet: true,
        resolutionMet: true,
      });

      // Query as main tenant
      mockTenantId = tenantId;
      const result = await getSlaComplianceRate({});

      // Should only include main tenant ticket
      expect(result.totalTickets).toBe(1);
      expect(result.responseBreachedCount).toBe(1); // The breached ticket from main tenant

      // Query as other tenant
      mockTenantId = otherTenantId;
      const otherResult = await getSlaComplianceRate({});

      // Should only include other tenant ticket
      expect(otherResult.totalTickets).toBe(1);
      expect(otherResult.responseMetCount).toBe(1); // The met ticket from other tenant

      // Reset mock
      mockTenantId = tenantId;
    });
  });

  // ==========================================================================
  // Overview Tests
  // ==========================================================================
  describe('getSlaOverview', () => {
    it('returns combined overview metrics', async () => {
      // Create various tickets
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityHighId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: true,
        resolutionMet: true,
      });
      await createTicketWithSlaResult(db, tenantId, {
        priorityId: priorityMediumId,
        statusId: statusClosedId,
        slaPolicyId,
        companyId,
        boardId,
        assignedTo: internalUserId,
        responseMet: false,
        resolutionMet: true,
      });

      const result = await getSlaOverview({});

      expect(result).toHaveProperty('compliance');
      expect(result).toHaveProperty('averageTimes');
      expect(result).toHaveProperty('activeTicketsCount');
      expect(result).toHaveProperty('atRiskCount');
      expect(result).toHaveProperty('breachedCount');
      expect(result).toHaveProperty('pausedCount');

      expect(result.compliance.totalTickets).toBe(2);
    });
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

async function createContact(db: Knex, tenant: string, clientId: string, companyId: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Reporting Test Contact',
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
    description: 'Test board for SLA reporting',
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
    priority_order: orderNumber,
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
  companyId: string;
  contactId: string;
  statusId: string;
  priorityId: string;
  boardId: string;
  assignedTo: string | null;
  slaPolicyId: string | null;
}): Promise<void> {
  await db('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: params.ticketNumber,
    title: params.title,
    company_id: params.companyId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    assigned_to: params.assignedTo,
    sla_policy_id: params.slaPolicyId,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function createTicketWithSlaResult(db: Knex, tenant: string, params: {
  priorityId: string;
  statusId: string;
  slaPolicyId: string;
  companyId: string;
  boardId: string;
  assignedTo: string;
  responseMet: boolean;
  resolutionMet: boolean;
  createdAt?: Date;
  closedAt?: Date;
}): Promise<string> {
  const ticketId = uuidv4();
  const contactId = uuidv4();
  const now = params.createdAt || new Date();
  const closedAt = params.closedAt || now;

  // Create a simple contact for the ticket
  await db('contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Test Contact',
    email: `contact-${uuidv4().slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  }).catch(() => {}); // Ignore if contact already exists

  await db('tickets').insert({
    tenant,
    ticket_id: ticketId,
    ticket_number: `SLA-${uuidv4().slice(0, 6)}`,
    title: `SLA Test Ticket ${uuidv4().slice(0, 6)}`,
    company_id: params.companyId,
    contact_name_id: contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    assigned_to: params.assignedTo,
    sla_policy_id: params.slaPolicyId,
    sla_started_at: now,
    sla_response_at: new Date(now.getTime() + 15 * 60000),
    sla_response_due_at: new Date(now.getTime() + 30 * 60000),
    sla_response_met: params.responseMet,
    sla_resolution_at: closedAt,
    sla_resolution_due_at: new Date(now.getTime() + 120 * 60000),
    sla_resolution_met: params.resolutionMet,
    closed_at: closedAt,
    created_at: now,
    entered_at: now,
    updated_at: now,
  });

  return ticketId;
}
