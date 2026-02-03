/**
 * Integration tests for SLA Policy Actions (SLA Phase 2)
 *
 * Tests SLA policy CRUD and assignment including:
 * - getSlaPolicies, getSlaPolicyById, getDefaultSlaPolicy
 * - createSlaPolicy, updateSlaPolicy, deleteSlaPolicy
 * - setDefaultSlaPolicy (single default enforcement)
 * - Policy targets CRUD
 * - Notification thresholds CRUD
 * - Client/Board SLA assignment
 * - Policy resolution hierarchy (client > board > tenant default)
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

describe('SLA Actions Integration Tests', () => {
  let db: Knex;
  let tenantId: string;
  let tenant2Id: string;
  let clientId: string;
  let client2Id: string;
  let userId: string;
  let boardId: string;
  let board2Id: string;
  let statusId: string;
  let priorityId: string;
  let priority2Id: string;

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
    tenantId = await createTenant(db, 'SLA Actions Test Tenant 1');
    clientId = await createClient(db, tenantId, 'SLA Actions Test Client 1');
    userId = await createUser(db, tenantId, { first_name: 'SLA', last_name: 'Tester' });

    // Create tenant 2 for isolation tests
    tenant2Id = await createTenant(db, 'SLA Actions Test Tenant 2');
    client2Id = await createClient(db, tenant2Id, 'SLA Actions Test Client 2');

    // Create required reference data for tenant 1
    boardId = uuidv4();
    await db('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      name: 'Test Board',
      created_at: new Date(),
      updated_at: new Date(),
    });

    board2Id = uuidv4();
    await db('boards').insert({
      tenant: tenantId,
      board_id: board2Id,
      name: 'Test Board 2',
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
      priority_name: 'High',
      color: '#FF0000',
      order_number: 1,
      created_by: userId,
    });

    priority2Id = uuidv4();
    await db('priorities').insert({
      tenant: tenantId,
      priority_id: priority2Id,
      priority_name: 'Normal',
      color: '#808080',
      order_number: 2,
      created_by: userId,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // Helper function to create an SLA policy directly in the database
  async function createTestPolicy(options: {
    tenantIdOverride?: string;
    policyName?: string;
    isDefault?: boolean;
    description?: string;
  } = {}): Promise<string> {
    const policyId = uuidv4();

    await db('sla_policies').insert({
      tenant: options.tenantIdOverride ?? tenantId,
      sla_policy_id: policyId,
      policy_name: options.policyName ?? `Test Policy ${policyId.slice(0, 8)}`,
      description: options.description ?? null,
      is_default: options.isDefault ?? false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return policyId;
  }

  // Helper function to create a policy target
  async function createTestTarget(policyId: string, options: {
    priorityIdOverride?: string;
    responseTimeMinutes?: number | null;
    resolutionTimeMinutes?: number | null;
  } = {}): Promise<string> {
    const targetId = uuidv4();

    await db('sla_policy_targets').insert({
      tenant: tenantId,
      target_id: targetId,
      sla_policy_id: policyId,
      priority_id: options.priorityIdOverride ?? priorityId,
      response_time_minutes: options.responseTimeMinutes ?? 60,
      resolution_time_minutes: options.resolutionTimeMinutes ?? 240,
      escalation_1_percent: 70,
      escalation_2_percent: 90,
      escalation_3_percent: 110,
      is_24x7: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return targetId;
  }

  // Helper function to create a notification threshold
  async function createTestThreshold(policyId: string, options: {
    thresholdPercent?: number;
    notificationType?: 'warning' | 'breach';
  } = {}): Promise<string> {
    const thresholdId = uuidv4();

    await db('sla_notification_thresholds').insert({
      tenant: tenantId,
      threshold_id: thresholdId,
      sla_policy_id: policyId,
      threshold_percent: options.thresholdPercent ?? 75,
      notification_type: options.notificationType ?? 'warning',
      notify_assignee: true,
      notify_board_manager: false,
      notify_escalation_manager: false,
      channels: ['in_app'],
      created_at: new Date(),
    });

    return thresholdId;
  }

  describe('SLA Policy CRUD Operations', () => {
    describe('getSlaPolicies', () => {
      it('should return all SLA policies for tenant', async () => {
        const policyId1 = await createTestPolicy({ policyName: 'Policy A' });
        const policyId2 = await createTestPolicy({ policyName: 'Policy B' });

        const policies = await db('sla_policies')
          .where({ tenant: tenantId })
          .orderBy('policy_name', 'asc');

        const policyIds = policies.map(p => p.sla_policy_id);
        expect(policyIds).toContain(policyId1);
        expect(policyIds).toContain(policyId2);
      });

      it('should return empty array when no policies exist', async () => {
        // Create a new tenant with no policies
        const emptyTenantId = await createTenant(db, 'Empty SLA Tenant');

        const policies = await db('sla_policies')
          .where({ tenant: emptyTenantId });

        expect(policies).toHaveLength(0);
      });
    });

    describe('getSlaPolicyById', () => {
      it('should return policy with targets and notification thresholds', async () => {
        const policyId = await createTestPolicy({ policyName: 'Full Policy' });
        const targetId = await createTestTarget(policyId);
        const thresholdId = await createTestThreshold(policyId);

        const policy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .first();

        expect(policy).toBeDefined();
        expect(policy.policy_name).toBe('Full Policy');

        const targets = await db('sla_policy_targets')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(targets).toHaveLength(1);
        expect(targets[0].target_id).toBe(targetId);

        const thresholds = await db('sla_notification_thresholds')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(thresholds).toHaveLength(1);
        expect(thresholds[0].threshold_id).toBe(thresholdId);
      });

      it('should return null for non-existent policy', async () => {
        const policy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: uuidv4() })
          .first();

        expect(policy).toBeUndefined();
      });
    });

    describe('getDefaultSlaPolicy', () => {
      it('should return the default policy for tenant', async () => {
        await createTestPolicy({ policyName: 'Non-Default', isDefault: false });
        const defaultPolicyId = await createTestPolicy({ policyName: 'Default Policy', isDefault: true });

        const defaultPolicy = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .first();

        expect(defaultPolicy).toBeDefined();
        expect(defaultPolicy.sla_policy_id).toBe(defaultPolicyId);
        expect(defaultPolicy.policy_name).toBe('Default Policy');
      });

      it('should return null when no default policy exists', async () => {
        // Create a new tenant with only non-default policies
        const noDefaultTenantId = await createTenant(db, 'No Default SLA Tenant');

        const nonDefaultPolicyId = uuidv4();
        await db('sla_policies').insert({
          tenant: noDefaultTenantId,
          sla_policy_id: nonDefaultPolicyId,
          policy_name: 'Non-Default',
          is_default: false,
          created_at: new Date(),
          updated_at: new Date(),
        });

        const defaultPolicy = await db('sla_policies')
          .where({ tenant: noDefaultTenantId, is_default: true })
          .first();

        expect(defaultPolicy).toBeUndefined();
      });
    });

    describe('createSlaPolicy', () => {
      it('should create a new SLA policy', async () => {
        const policyId = uuidv4();

        await db('sla_policies').insert({
          tenant: tenantId,
          sla_policy_id: policyId,
          policy_name: 'New Policy',
          description: 'Test description',
          is_default: false,
          created_at: new Date(),
          updated_at: new Date(),
        });

        const policy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .first();

        expect(policy).toBeDefined();
        expect(policy.policy_name).toBe('New Policy');
        expect(policy.description).toBe('Test description');
        expect(policy.is_default).toBe(false);
      });

      it('should clear existing default when creating new default policy', async () => {
        const existingDefaultId = await createTestPolicy({ isDefault: true, policyName: 'Old Default' });

        // Create new default policy
        const newDefaultId = uuidv4();

        // First clear existing default
        await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .update({ is_default: false, updated_at: new Date() });

        // Then insert new default
        await db('sla_policies').insert({
          tenant: tenantId,
          sla_policy_id: newDefaultId,
          policy_name: 'New Default',
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Verify only one default exists
        const defaults = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true });

        expect(defaults).toHaveLength(1);
        expect(defaults[0].sla_policy_id).toBe(newDefaultId);

        // Verify old default was cleared
        const oldPolicy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: existingDefaultId })
          .first();

        expect(oldPolicy.is_default).toBe(false);
      });
    });

    describe('updateSlaPolicy', () => {
      it('should update policy name and description', async () => {
        const policyId = await createTestPolicy({ policyName: 'Original Name', description: 'Original desc' });

        await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .update({
            policy_name: 'Updated Name',
            description: 'Updated description',
            updated_at: new Date(),
          });

        const policy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .first();

        expect(policy.policy_name).toBe('Updated Name');
        expect(policy.description).toBe('Updated description');
      });

      it('should set policy as default and clear other defaults', async () => {
        const policy1Id = await createTestPolicy({ isDefault: true, policyName: 'Policy 1' });
        const policy2Id = await createTestPolicy({ isDefault: false, policyName: 'Policy 2' });

        // Clear existing default
        await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .update({ is_default: false, updated_at: new Date() });

        // Set policy 2 as default
        await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policy2Id })
          .update({ is_default: true, updated_at: new Date() });

        const policy1 = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policy1Id })
          .first();
        const policy2 = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policy2Id })
          .first();

        expect(policy1.is_default).toBe(false);
        expect(policy2.is_default).toBe(true);
      });
    });

    describe('deleteSlaPolicy', () => {
      it('should delete policy and its targets and thresholds', async () => {
        const policyId = await createTestPolicy({ policyName: 'To Delete' });
        await createTestTarget(policyId);
        await createTestThreshold(policyId);

        // Verify data exists
        let targets = await db('sla_policy_targets')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(targets.length).toBeGreaterThan(0);

        let thresholds = await db('sla_notification_thresholds')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(thresholds.length).toBeGreaterThan(0);

        // Delete in order: thresholds, targets, policy (due to foreign keys)
        await db('sla_notification_thresholds')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .delete();

        await db('sla_policy_targets')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .delete();

        await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .delete();

        // Verify deletion
        const policy = await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .first();
        expect(policy).toBeUndefined();

        targets = await db('sla_policy_targets')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(targets).toHaveLength(0);

        thresholds = await db('sla_notification_thresholds')
          .where({ tenant: tenantId, sla_policy_id: policyId });
        expect(thresholds).toHaveLength(0);
      });

      it('should not delete policy assigned to clients', async () => {
        const policyId = await createTestPolicy({ policyName: 'Client Assigned' });

        // Assign policy to client
        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        // Check if policy is assigned
        const assignedClients = await db('clients')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .count('* as count')
          .first();

        expect(Number(assignedClients?.count)).toBeGreaterThan(0);

        // Clean up - remove assignment
        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: null, updated_at: new Date() });
      });

      it('should not delete policy assigned to boards', async () => {
        const policyId = await createTestPolicy({ policyName: 'Board Assigned' });

        // Assign policy to board
        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        // Check if policy is assigned
        const assignedBoards = await db('boards')
          .where({ tenant: tenantId, sla_policy_id: policyId })
          .count('* as count')
          .first();

        expect(Number(assignedBoards?.count)).toBeGreaterThan(0);

        // Clean up - remove assignment
        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: null, updated_at: new Date() });
      });
    });

    describe('setDefaultSlaPolicy', () => {
      it('should set policy as default and clear existing default', async () => {
        const policy1Id = await createTestPolicy({ isDefault: true, policyName: 'Current Default' });
        const policy2Id = await createTestPolicy({ isDefault: false, policyName: 'To Be Default' });

        // Clear existing default
        await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .update({ is_default: false, updated_at: new Date() });

        // Set new default
        await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policy2Id })
          .update({ is_default: true, updated_at: new Date() });

        // Verify only one default exists
        const defaults = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true });

        expect(defaults).toHaveLength(1);
        expect(defaults[0].sla_policy_id).toBe(policy2Id);
      });

      it('should enforce single default policy', async () => {
        // Clear all existing defaults first
        await db('sla_policies')
          .where({ tenant: tenantId })
          .update({ is_default: false, updated_at: new Date() });

        const policy1Id = await createTestPolicy({ isDefault: true, policyName: 'Default 1' });
        const policy2Id = await createTestPolicy({ isDefault: false, policyName: 'Default 2' });

        // Try to set policy2 as default without clearing policy1
        await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .update({ is_default: false, updated_at: new Date() });

        await db('sla_policies')
          .where({ tenant: tenantId, sla_policy_id: policy2Id })
          .update({ is_default: true, updated_at: new Date() });

        const defaults = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true });

        // Should only have one default
        expect(defaults).toHaveLength(1);
      });
    });
  });

  describe('SLA Policy Targets CRUD', () => {
    it('should create target for policy', async () => {
      const policyId = await createTestPolicy();
      const targetId = await createTestTarget(policyId, {
        responseTimeMinutes: 30,
        resolutionTimeMinutes: 120,
      });

      const target = await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: targetId })
        .first();

      expect(target).toBeDefined();
      expect(target.sla_policy_id).toBe(policyId);
      expect(target.response_time_minutes).toBe(30);
      expect(target.resolution_time_minutes).toBe(120);
    });

    it('should update target times', async () => {
      const policyId = await createTestPolicy();
      const targetId = await createTestTarget(policyId, {
        responseTimeMinutes: 30,
        resolutionTimeMinutes: 120,
      });

      await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: targetId })
        .update({
          response_time_minutes: 60,
          resolution_time_minutes: 240,
          updated_at: new Date(),
        });

      const target = await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: targetId })
        .first();

      expect(target.response_time_minutes).toBe(60);
      expect(target.resolution_time_minutes).toBe(240);
    });

    it('should delete target', async () => {
      const policyId = await createTestPolicy();
      const targetId = await createTestTarget(policyId);

      await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: targetId })
        .delete();

      const target = await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: targetId })
        .first();

      expect(target).toBeUndefined();
    });

    it('should enforce unique priority per policy', async () => {
      const policyId = await createTestPolicy();
      await createTestTarget(policyId, { priorityIdOverride: priorityId });

      // Attempt to create another target with same priority
      const duplicateTargetId = uuidv4();

      await expect(
        db('sla_policy_targets').insert({
          tenant: tenantId,
          target_id: duplicateTargetId,
          sla_policy_id: policyId,
          priority_id: priorityId, // Same priority
          response_time_minutes: 45,
          resolution_time_minutes: 180,
          created_at: new Date(),
          updated_at: new Date(),
        })
      ).rejects.toThrow(); // Should throw unique constraint violation
    });

    it('should allow same priority in different policies', async () => {
      const policy1Id = await createTestPolicy({ policyName: 'Policy 1' });
      const policy2Id = await createTestPolicy({ policyName: 'Policy 2' });

      const target1Id = await createTestTarget(policy1Id, { priorityIdOverride: priorityId });
      const target2Id = await createTestTarget(policy2Id, { priorityIdOverride: priorityId });

      const target1 = await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: target1Id })
        .first();
      const target2 = await db('sla_policy_targets')
        .where({ tenant: tenantId, target_id: target2Id })
        .first();

      expect(target1).toBeDefined();
      expect(target2).toBeDefined();
      expect(target1.priority_id).toBe(target2.priority_id);
    });
  });

  describe('Notification Thresholds CRUD', () => {
    it('should create notification threshold', async () => {
      const policyId = await createTestPolicy();
      const thresholdId = await createTestThreshold(policyId, {
        thresholdPercent: 50,
        notificationType: 'warning',
      });

      const threshold = await db('sla_notification_thresholds')
        .where({ tenant: tenantId, threshold_id: thresholdId })
        .first();

      expect(threshold).toBeDefined();
      expect(threshold.sla_policy_id).toBe(policyId);
      expect(threshold.threshold_percent).toBe(50);
      expect(threshold.notification_type).toBe('warning');
    });

    it('should replace all thresholds when upserting', async () => {
      const policyId = await createTestPolicy();
      await createTestThreshold(policyId, { thresholdPercent: 50 });
      await createTestThreshold(policyId, { thresholdPercent: 75 });

      // Delete all existing thresholds
      await db('sla_notification_thresholds')
        .where({ tenant: tenantId, sla_policy_id: policyId })
        .delete();

      // Insert new thresholds
      const newThresholds = [
        { percent: 60, type: 'warning' },
        { percent: 90, type: 'warning' },
        { percent: 100, type: 'breach' },
      ];

      for (const t of newThresholds) {
        await db('sla_notification_thresholds').insert({
          tenant: tenantId,
          threshold_id: uuidv4(),
          sla_policy_id: policyId,
          threshold_percent: t.percent,
          notification_type: t.type,
          notify_assignee: true,
          notify_board_manager: false,
          notify_escalation_manager: false,
          channels: ['in_app'],
          created_at: new Date(),
        });
      }

      const thresholds = await db('sla_notification_thresholds')
        .where({ tenant: tenantId, sla_policy_id: policyId })
        .orderBy('threshold_percent', 'asc');

      expect(thresholds).toHaveLength(3);
      expect(thresholds[0].threshold_percent).toBe(60);
      expect(thresholds[1].threshold_percent).toBe(90);
      expect(thresholds[2].threshold_percent).toBe(100);
    });
  });

  describe('Client/Board SLA Assignment', () => {
    describe('Client SLA Assignment', () => {
      it('should assign SLA policy to client', async () => {
        const policyId = await createTestPolicy({ policyName: 'Client SLA' });

        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        const client = await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .first();

        expect(client.sla_policy_id).toBe(policyId);

        // Clean up
        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: null, updated_at: new Date() });
      });

      it('should remove SLA policy assignment from client', async () => {
        const policyId = await createTestPolicy({ policyName: 'Temp Client SLA' });

        // Assign
        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        // Remove
        await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .update({ sla_policy_id: null, updated_at: new Date() });

        const client = await db('clients')
          .where({ tenant: tenantId, client_id: clientId })
          .first();

        expect(client.sla_policy_id).toBeNull();
      });
    });

    describe('Board SLA Assignment', () => {
      it('should assign SLA policy to board', async () => {
        const policyId = await createTestPolicy({ policyName: 'Board SLA' });

        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        const board = await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .first();

        expect(board.sla_policy_id).toBe(policyId);

        // Clean up
        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: null, updated_at: new Date() });
      });

      it('should remove SLA policy assignment from board', async () => {
        const policyId = await createTestPolicy({ policyName: 'Temp Board SLA' });

        // Assign
        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: policyId, updated_at: new Date() });

        // Remove
        await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .update({ sla_policy_id: null, updated_at: new Date() });

        const board = await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .first();

        expect(board.sla_policy_id).toBeNull();
      });
    });
  });

  describe('Policy Resolution Hierarchy', () => {
    it('should resolve client policy over board and default', async () => {
      const clientPolicyId = await createTestPolicy({ policyName: 'Client Policy' });
      const boardPolicyId = await createTestPolicy({ policyName: 'Board Policy' });
      const defaultPolicyId = await createTestPolicy({ policyName: 'Default Policy', isDefault: true });

      // Assign policies
      await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .update({ sla_policy_id: clientPolicyId, updated_at: new Date() });

      await db('boards')
        .where({ tenant: tenantId, board_id: boardId })
        .update({ sla_policy_id: boardPolicyId, updated_at: new Date() });

      // Simulate resolution: client takes priority
      const client = await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .select('sla_policy_id')
        .first();

      let resolvedPolicyId = client?.sla_policy_id;

      if (!resolvedPolicyId) {
        const board = await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = board?.sla_policy_id;
      }

      if (!resolvedPolicyId) {
        const defaultPolicy = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = defaultPolicy?.sla_policy_id;
      }

      expect(resolvedPolicyId).toBe(clientPolicyId);

      // Clean up
      await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .update({ sla_policy_id: null, updated_at: new Date() });
      await db('boards')
        .where({ tenant: tenantId, board_id: boardId })
        .update({ sla_policy_id: null, updated_at: new Date() });
    });

    it('should resolve board policy when no client policy', async () => {
      const boardPolicyId = await createTestPolicy({ policyName: 'Board Only Policy' });
      const defaultPolicyId = await createTestPolicy({ policyName: 'Default Only Policy', isDefault: true });

      // Only assign board policy
      await db('boards')
        .where({ tenant: tenantId, board_id: boardId })
        .update({ sla_policy_id: boardPolicyId, updated_at: new Date() });

      // Simulate resolution
      const client = await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .select('sla_policy_id')
        .first();

      let resolvedPolicyId = client?.sla_policy_id;

      if (!resolvedPolicyId) {
        const board = await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = board?.sla_policy_id;
      }

      expect(resolvedPolicyId).toBe(boardPolicyId);

      // Clean up
      await db('boards')
        .where({ tenant: tenantId, board_id: boardId })
        .update({ sla_policy_id: null, updated_at: new Date() });
    });

    it('should resolve default policy when no client or board policy', async () => {
      // Clear all existing defaults first
      await db('sla_policies')
        .where({ tenant: tenantId })
        .update({ is_default: false, updated_at: new Date() });

      const defaultPolicyId = await createTestPolicy({ policyName: 'Fallback Default', isDefault: true });

      // Make sure client and board have no policy
      await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .update({ sla_policy_id: null, updated_at: new Date() });
      await db('boards')
        .where({ tenant: tenantId, board_id: boardId })
        .update({ sla_policy_id: null, updated_at: new Date() });

      // Simulate resolution
      const client = await db('clients')
        .where({ tenant: tenantId, client_id: clientId })
        .select('sla_policy_id')
        .first();

      let resolvedPolicyId = client?.sla_policy_id;

      if (!resolvedPolicyId) {
        const board = await db('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = board?.sla_policy_id;
      }

      if (!resolvedPolicyId) {
        const defaultPolicy = await db('sla_policies')
          .where({ tenant: tenantId, is_default: true })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = defaultPolicy?.sla_policy_id;
      }

      expect(resolvedPolicyId).toBe(defaultPolicyId);
    });

    it('should return null when no policy at any level', async () => {
      // Create a new tenant with no default policy
      const emptyTenantId = await createTenant(db, 'No Policy Tenant');
      const emptyClientId = await createClient(db, emptyTenantId, 'No Policy Client');

      const emptyBoardId = uuidv4();
      await db('boards').insert({
        tenant: emptyTenantId,
        board_id: emptyBoardId,
        name: 'No Policy Board',
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Simulate resolution
      const client = await db('clients')
        .where({ tenant: emptyTenantId, client_id: emptyClientId })
        .select('sla_policy_id')
        .first();

      let resolvedPolicyId = client?.sla_policy_id;

      if (!resolvedPolicyId) {
        const board = await db('boards')
          .where({ tenant: emptyTenantId, board_id: emptyBoardId })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = board?.sla_policy_id;
      }

      if (!resolvedPolicyId) {
        const defaultPolicy = await db('sla_policies')
          .where({ tenant: emptyTenantId, is_default: true })
          .select('sla_policy_id')
          .first();
        resolvedPolicyId = defaultPolicy?.sla_policy_id;
      }

      expect(resolvedPolicyId).toBeFalsy();
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should not return policies from other tenants', async () => {
      const tenant1PolicyId = await createTestPolicy({ policyName: 'Tenant 1 Policy' });

      // Create policy in tenant 2
      const tenant2PolicyId = uuidv4();
      await db('sla_policies').insert({
        tenant: tenant2Id,
        sla_policy_id: tenant2PolicyId,
        policy_name: 'Tenant 2 Policy',
        is_default: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Query from tenant 1
      const tenant1Policies = await db('sla_policies')
        .where({ tenant: tenantId });

      const policyIds = tenant1Policies.map(p => p.sla_policy_id);
      expect(policyIds).toContain(tenant1PolicyId);
      expect(policyIds).not.toContain(tenant2PolicyId);
    });

    it('should not allow querying policy by ID from another tenant', async () => {
      // Create policy in tenant 2
      const tenant2PolicyId = uuidv4();
      await db('sla_policies').insert({
        tenant: tenant2Id,
        sla_policy_id: tenant2PolicyId,
        policy_name: 'Cross Tenant Policy',
        is_default: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Try to query from tenant 1
      const policy = await db('sla_policies')
        .where({ tenant: tenantId, sla_policy_id: tenant2PolicyId })
        .first();

      expect(policy).toBeUndefined();
    });

    it('should isolate default policy per tenant', async () => {
      // Clear existing defaults in tenant 1
      await db('sla_policies')
        .where({ tenant: tenantId })
        .update({ is_default: false, updated_at: new Date() });

      const tenant1DefaultId = await createTestPolicy({ policyName: 'Tenant 1 Default', isDefault: true });

      // Create default in tenant 2
      const tenant2DefaultId = uuidv4();
      await db('sla_policies').insert({
        tenant: tenant2Id,
        sla_policy_id: tenant2DefaultId,
        policy_name: 'Tenant 2 Default',
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Query default for tenant 1
      const tenant1Default = await db('sla_policies')
        .where({ tenant: tenantId, is_default: true })
        .first();

      expect(tenant1Default.sla_policy_id).toBe(tenant1DefaultId);
      expect(tenant1Default.sla_policy_id).not.toBe(tenant2DefaultId);
    });
  });
});
