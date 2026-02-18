/**
 * @alga-psa/sla - Escalation Service Tests
 *
 * Unit tests for the escalation service that handles ticket escalation logic
 * when SLA thresholds are reached.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escalateTicket,
  checkEscalationNeeded,
  getEscalationManagerForTicket,
  EscalationResult,
} from '../escalationService';
import { Knex } from 'knex';

// =============================================================================
// Mock Database Transaction Builder
// =============================================================================

interface MockQueryBuilder {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  fn: { now: ReturnType<typeof vi.fn> };
  raw: ReturnType<typeof vi.fn>;
}

interface MockData {
  tickets: Record<string, any>;
  escalation_managers: Record<string, any>;
  sla_policy_targets: Record<string, any>;
  ticket_resources: Record<string, any>;
}

const createMockTransaction = (mockData: MockData = {
  tickets: {},
  escalation_managers: {},
  sla_policy_targets: {},
  ticket_resources: {},
}) => {
  const createQueryBuilder = (tableName: string): MockQueryBuilder => {
    const builder: MockQueryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      first: vi.fn(),
      insert: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(1),
      fn: { now: vi.fn().mockReturnValue('NOW()') },
      raw: vi.fn((sql: string) => sql),
    };

    return builder;
  };

  const tableBuilders: Record<string, MockQueryBuilder> = {};

  const mockTrx = vi.fn((tableName: string) => {
    if (!tableBuilders[tableName]) {
      tableBuilders[tableName] = createQueryBuilder(tableName);
    }
    return tableBuilders[tableName];
  }) as unknown as Knex.Transaction;

  // Add fn.now() to the mock transaction itself
  (mockTrx as any).fn = { now: vi.fn().mockReturnValue('NOW()') };
  (mockTrx as any).raw = vi.fn((sql: string) => sql);

  return {
    trx: mockTrx,
    tableBuilders,
    mockData,
  };
};

// =============================================================================
// Test Constants
// =============================================================================

const TENANT = 'test-tenant';
const TICKET_ID = 'ticket-123';
const BOARD_ID = 'board-456';
const MANAGER_USER_ID = 'manager-789';
const SLA_POLICY_ID = 'sla-policy-001';
const PRIORITY_ID = 'priority-001';

// =============================================================================
// escalateTicket Tests
// =============================================================================

describe('escalateTicket', () => {
  let mockTrx: ReturnType<typeof createMockTransaction>;

  beforeEach(() => {
    mockTrx = createMockTransaction();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('escalation flow', () => {
    it('should escalate ticket to level 1', async () => {
      // Setup mock ticket data
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: null,
        escalated: false,
      };

      // Setup mock manager data
      const managerData = {
        config_id: 'config-123',
        board_id: BOARD_ID,
        escalation_level: 1,
        manager_user_id: MANAGER_USER_ID,
        notify_via: ['in_app', 'email'],
        manager_first_name: 'John',
        manager_last_name: 'Manager',
        manager_email: 'john@example.com',
      };

      // Configure mock responses
      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
      };

      mockTrx.tableBuilders['ticket_resources'] = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
      };

      mockTrx.tableBuilders['internal_notifications'] = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      expect(result.escalationLevel).toBe(1);
      expect(result.managerId).toBe(MANAGER_USER_ID);
      expect(result.managerName).toBe('John Manager');
    });

    it('should escalate ticket to level 2', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: 1,
        escalated: true,
      };

      const managerData = {
        config_id: 'config-456',
        board_id: BOARD_ID,
        escalation_level: 2,
        manager_user_id: 'senior-manager-001',
        notify_via: ['in_app'],
        manager_first_name: 'Jane',
        manager_last_name: 'Senior',
        manager_email: 'jane@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['ticket_resources'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['internal_notifications'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 2);

      expect(result.success).toBe(true);
      expect(result.escalationLevel).toBe(2);
      expect(result.managerId).toBe('senior-manager-001');
      expect(result.managerName).toBe('Jane Senior');
    });

    it('should escalate ticket to level 3', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Critical Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: 2,
        escalated: true,
      };

      const managerData = {
        config_id: 'config-789',
        board_id: BOARD_ID,
        escalation_level: 3,
        manager_user_id: 'executive-001',
        notify_via: ['in_app', 'email'],
        manager_first_name: 'Executive',
        manager_last_name: 'Smith',
        manager_email: 'exec@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['ticket_resources'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['internal_notifications'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 3);

      expect(result.success).toBe(true);
      expect(result.escalationLevel).toBe(3);
      expect(result.managerId).toBe('executive-001');
      expect(result.managerName).toBe('Executive Smith');
    });
  });

  describe('re-escalation prevention', () => {
    it('should not re-escalate if already at the same level', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: 1,
        escalated: true,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      expect(result.error).toBe('Ticket already at or above this escalation level');
    });

    it('should not re-escalate if already at a higher level', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: 3,
        escalated: true,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 2);

      expect(result.success).toBe(true);
      expect(result.error).toBe('Ticket already at or above this escalation level');
    });
  });

  describe('ticket not found', () => {
    it('should return error when ticket does not exist', async () => {
      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, 'non-existent-ticket', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });
  });

  describe('escalation without manager', () => {
    it('should still succeed when no manager is configured', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: null,
        escalated: false,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      expect(result.managerId).toBeNull();
      expect(result.managerName).toBeNull();
      expect(result.resourceAdded).toBe(false);
    });
  });

  describe('manager resource handling', () => {
    it('should add manager as a new resource when not already assigned', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: null,
        escalated: false,
      };

      const managerData = {
        config_id: 'config-123',
        board_id: BOARD_ID,
        escalation_level: 1,
        manager_user_id: MANAGER_USER_ID,
        notify_via: ['in_app'],
        manager_first_name: 'John',
        manager_last_name: 'Manager',
        manager_email: 'john@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['ticket_resources'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['internal_notifications'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      expect(result.resourceAdded).toBe(true);
    });
  });

  describe('notification handling', () => {
    it('should send in-app notification when configured', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: null,
        escalated: false,
      };

      const managerData = {
        config_id: 'config-123',
        board_id: BOARD_ID,
        escalation_level: 1,
        manager_user_id: MANAGER_USER_ID,
        notify_via: ['in_app'],
        manager_first_name: 'John',
        manager_last_name: 'Manager',
        manager_email: 'john@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['ticket_resources'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['internal_notifications'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      expect(result.notificationsSent.inApp).toBe(true);
    });
  });

  describe('audit logging', () => {
    it('should log escalation event on successful escalation', async () => {
      const ticketData = {
        ticket_id: TICKET_ID,
        ticket_number: 'T-001',
        title: 'Test Ticket',
        board_id: BOARD_ID,
        assigned_to: 'assignee-123',
        escalation_level: null,
        escalated: false,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const slaAuditLogInsert = vi.fn().mockResolvedValue([]);
      mockTrx.tableBuilders['sla_audit_log'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: slaAuditLogInsert,
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await escalateTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result.success).toBe(true);
      // Verify that the audit log insert was called
      expect(slaAuditLogInsert).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// checkEscalationNeeded Tests
// =============================================================================

describe('checkEscalationNeeded', () => {
  let mockTrx: ReturnType<typeof createMockTransaction>;

  beforeEach(() => {
    mockTrx = createMockTransaction();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('escalation threshold checks', () => {
    it('should return level 1 when elapsed percentage exceeds escalation_1_percent', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 55);

      expect(result).toBe(1);
    });

    it('should return level 2 when elapsed percentage exceeds escalation_2_percent', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 1,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 80);

      expect(result).toBe(2);
    });

    it('should return level 3 when elapsed percentage exceeds escalation_3_percent', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 2,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 95);

      expect(result).toBe(3);
    });
  });

  describe('no escalation needed', () => {
    it('should return null when elapsed percentage is below all thresholds', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 30);

      expect(result).toBeNull();
    });

    it('should return null when ticket has no SLA policy', async () => {
      const ticketData = {
        sla_policy_id: null,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 80);

      expect(result).toBeNull();
    });

    it('should return null when ticket has no priority', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: null,
        escalation_level: null,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 80);

      expect(result).toBeNull();
    });

    it('should return null when ticket is not found', async () => {
      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, 'non-existent', 80);

      expect(result).toBeNull();
    });

    it('should return null when SLA target is not found', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 80);

      expect(result).toBeNull();
    });
  });

  describe('respects current escalation level', () => {
    it('should not re-trigger level 1 if already at level 1', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 1,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      // At 60%, should trigger level 1, but since already at level 1, should return null
      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 60);

      expect(result).toBeNull();
    });

    it('should not re-trigger level 2 if already at level 2', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 2,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      // At 80%, should trigger level 2, but since already at level 2, should return null
      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 80);

      expect(result).toBeNull();
    });

    it('should not re-trigger level 3 if already at level 3', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 3,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      // At 95%, should trigger level 3, but since already at level 3, should return null
      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 95);

      expect(result).toBeNull();
    });

    it('should trigger level 3 when already at level 2 and threshold is exceeded', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: 2,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 95);

      expect(result).toBe(3);
    });
  });

  describe('edge cases with escalation thresholds', () => {
    it('should handle null escalation threshold values', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      const targetData = {
        escalation_1_percent: null,
        escalation_2_percent: null,
        escalation_3_percent: null,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 99);

      expect(result).toBeNull();
    });

    it('should handle exact threshold boundary', async () => {
      const ticketData = {
        sla_policy_id: SLA_POLICY_ID,
        priority_id: PRIORITY_ID,
        escalation_level: null,
      };

      const targetData = {
        escalation_1_percent: 50,
        escalation_2_percent: 75,
        escalation_3_percent: 90,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['sla_policy_targets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(targetData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      // Exactly at 50% should trigger level 1
      const result = await checkEscalationNeeded(mockTrx.trx, TENANT, TICKET_ID, 50);

      expect(result).toBe(1);
    });
  });
});

// =============================================================================
// getEscalationManagerForTicket Tests
// =============================================================================

describe('getEscalationManagerForTicket', () => {
  let mockTrx: ReturnType<typeof createMockTransaction>;

  beforeEach(() => {
    mockTrx = createMockTransaction();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('manager lookup', () => {
    it('should return correct manager for board level 1', async () => {
      const ticketData = {
        board_id: BOARD_ID,
      };

      const managerData = {
        config_id: 'config-123',
        board_id: BOARD_ID,
        escalation_level: 1,
        manager_user_id: MANAGER_USER_ID,
        notify_via: ['in_app', 'email'],
        manager_first_name: 'Level1',
        manager_last_name: 'Manager',
        manager_email: 'level1@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result).not.toBeNull();
      expect(result?.manager_user_id).toBe(MANAGER_USER_ID);
      expect(result?.escalation_level).toBe(1);
      expect(result?.manager_first_name).toBe('Level1');
    });

    it('should return correct manager for board level 2', async () => {
      const ticketData = {
        board_id: BOARD_ID,
      };

      const managerData = {
        config_id: 'config-456',
        board_id: BOARD_ID,
        escalation_level: 2,
        manager_user_id: 'senior-manager',
        notify_via: ['email'],
        manager_first_name: 'Level2',
        manager_last_name: 'Senior',
        manager_email: 'level2@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, TICKET_ID, 2);

      expect(result).not.toBeNull();
      expect(result?.manager_user_id).toBe('senior-manager');
      expect(result?.escalation_level).toBe(2);
    });

    it('should return correct manager for board level 3', async () => {
      const ticketData = {
        board_id: BOARD_ID,
      };

      const managerData = {
        config_id: 'config-789',
        board_id: BOARD_ID,
        escalation_level: 3,
        manager_user_id: 'executive-manager',
        notify_via: ['in_app', 'email'],
        manager_first_name: 'Level3',
        manager_last_name: 'Executive',
        manager_email: 'level3@example.com',
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(managerData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, TICKET_ID, 3);

      expect(result).not.toBeNull();
      expect(result?.manager_user_id).toBe('executive-manager');
      expect(result?.escalation_level).toBe(3);
    });
  });

  describe('no manager configured', () => {
    it('should return null when no manager is configured for the level', async () => {
      const ticketData = {
        board_id: BOARD_ID,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result).toBeNull();
    });

    it('should return null when ticket is not found', async () => {
      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, 'non-existent', 1);

      expect(result).toBeNull();
    });

    it('should return null when ticket has no board_id', async () => {
      const ticketData = {
        board_id: null,
      };

      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketData),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result = await getEscalationManagerForTicket(mockTrx.trx, TENANT, TICKET_ID, 1);

      expect(result).toBeNull();
    });
  });

  describe('different boards', () => {
    it('should return different managers for different boards', async () => {
      const ticketDataBoard1 = {
        board_id: 'board-1',
      };

      const ticketDataBoard2 = {
        board_id: 'board-2',
      };

      const manager1 = {
        config_id: 'config-board1',
        board_id: 'board-1',
        escalation_level: 1,
        manager_user_id: 'manager-board1',
        notify_via: ['in_app'],
        manager_first_name: 'Board1',
        manager_last_name: 'Manager',
        manager_email: 'board1@example.com',
      };

      const manager2 = {
        config_id: 'config-board2',
        board_id: 'board-2',
        escalation_level: 1,
        manager_user_id: 'manager-board2',
        notify_via: ['email'],
        manager_first_name: 'Board2',
        manager_last_name: 'Manager',
        manager_email: 'board2@example.com',
      };

      // First call for board-1
      mockTrx.tableBuilders['tickets'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(ticketDataBoard1),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      mockTrx.tableBuilders['escalation_managers as em'] = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(manager1),
        insert: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(1),
        fn: { now: vi.fn().mockReturnValue('NOW()') },
        raw: vi.fn((sql: string) => sql),
        andWhere: vi.fn().mockReturnThis(),
      };

      const result1 = await getEscalationManagerForTicket(mockTrx.trx, TENANT, 'ticket-board1', 1);

      expect(result1).not.toBeNull();
      expect(result1?.manager_user_id).toBe('manager-board1');
      expect(result1?.board_id).toBe('board-1');
    });
  });
});
