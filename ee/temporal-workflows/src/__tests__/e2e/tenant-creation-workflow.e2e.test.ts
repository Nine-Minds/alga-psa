import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import { v4 as uuidv4 } from 'uuid';
import * as activities from '../../activities';
import { tenantCreationWorkflow } from '../../workflows/tenant-creation-workflow';
import { setupTestDatabase, type TestDatabase } from '../../test-utils/database';
import type { TenantCreationInput, TenantCreationResult } from '../../types/workflow-types';

describe('Tenant Creation Workflow E2E Tests', () => {
  let testEnv: TestWorkflowEnvironment;
  let testDb: TestDatabase;

  beforeAll(async () => {
    // Set up test database
    testDb = await setupTestDatabase();

    // Configure runtime for testing
    Runtime.install({
      logger: new DefaultLogger('WARN'), // Reduce log noise during tests
      telemetryOptions: {
        disabled: true,
      },
    });

    // Create test workflow environment with time skipping
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
    await testDb?.cleanup();
  });

  beforeEach(async () => {
    // Clean database state before each test
    await testDb.cleanup();
  });

  afterEach(async () => {
    // Clean up after each test
    await testDb.cleanup();
  });

  describe('Complete Tenant Creation Workflow', () => {
    it('should successfully create a complete tenant with admin user', async () => {
      const timestamp = Date.now();
      const input: TenantCreationInput = {
        tenantName: `E2E Test Tenant ${timestamp}`,
        adminUser: {
          firstName: 'John',
          lastName: 'Admin',
          email: `admin-${timestamp}@e2etest.com`,
        },
        companyName: `E2E Test Company ${timestamp}`,
        billingPlan: 'Enterprise',
      };

      // Create worker with our activities
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      // Execute the workflow
      const handle = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue: 'test-task-queue',
        workflowId: `tenant-creation-${timestamp}`,
      });

      const result: TenantCreationResult = await handle.result();

      // Verify workflow completed successfully
      expect(result.success).toBe(true);
      expect(result.tenantId).toBeDefined();
      expect(result.adminUserId).toBeDefined();
      expect(result.companyId).toBeDefined();
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(12);
      expect(result.createdAt).toBeDefined();

      // Verify tenant was created in database
      const tenant = await testDb.getTenant(result.tenantId);
      expect(tenant).toBeDefined();
      expect(tenant.company_name).toBe(input.tenantName);
      expect(tenant.email).toBe(input.adminUser.email);

      // Verify admin user was created
      const user = await testDb.getUserById(result.adminUserId, result.tenantId);
      expect(user).toBeDefined();
      expect(user.first_name).toBe(input.adminUser.firstName);
      expect(user.last_name).toBe(input.adminUser.lastName);
      expect(user.email).toBe(input.adminUser.email);
      expect(user.user_type).toBe('internal');

      // Verify company was created and associated
      const companies = await testDb.getCompaniesForTenant(result.tenantId);
      expect(companies).toHaveLength(1);
      expect(companies[0].company_name).toBe(input.companyName);
      expect(companies[0].account_manager_id).toBe(result.adminUserId);

      // Verify user has admin role
      const userRoles = await testDb.getUserRoles(result.adminUserId, result.tenantId);
      expect(userRoles).toHaveLength(1);
      expect(userRoles[0].role_name).toBe('Admin');

      // Verify default roles were created
      const roles = await testDb.getRolesForTenant(result.tenantId);
      expect(roles.length).toBeGreaterThanOrEqual(3);
      const roleNames = roles.map(r => r.role_name);
      expect(roleNames).toContain('Admin');
      expect(roleNames).toContain('User');
      expect(roleNames).toContain('Client');

      // Verify default statuses were created
      const statuses = await testDb.getStatusesForTenant(result.tenantId);
      expect(statuses.length).toBeGreaterThan(0);
      const statusNames = statuses.map(s => s.name);
      expect(statusNames).toContain('Open');
      expect(statusNames).toContain('Closed');

      await worker.shutdown();
    });

    it('should create tenant without company when companyName is not provided', async () => {
      const timestamp = Date.now();
      const input: TenantCreationInput = {
        tenantName: `Solo Tenant ${timestamp}`,
        adminUser: {
          firstName: 'Jane',
          lastName: 'Solo',
          email: `solo-${timestamp}@e2etest.com`,
        },
        // No companyName provided
      };

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      const handle = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue: 'test-task-queue',
        workflowId: `solo-tenant-${timestamp}`,
      });

      const result: TenantCreationResult = await handle.result();

      expect(result.success).toBe(true);
      expect(result.tenantId).toBeDefined();
      expect(result.adminUserId).toBeDefined();
      expect(result.companyId).toBeUndefined();

      // Verify no companies were created
      const companies = await testDb.getCompaniesForTenant(result.tenantId);
      expect(companies).toHaveLength(0);

      await worker.shutdown();
    });

    it('should handle workflow cancellation gracefully', async () => {
      const timestamp = Date.now();
      const input: TenantCreationInput = {
        tenantName: `Cancel Test ${timestamp}`,
        adminUser: {
          firstName: 'Cancel',
          lastName: 'Test',
          email: `cancel-${timestamp}@e2etest.com`,
        },
        companyName: `Cancel Company ${timestamp}`,
      };

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      const handle = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue: 'test-task-queue',
        workflowId: `cancel-test-${timestamp}`,
      });

      // Cancel the workflow before it completes
      await handle.cancel();

      // Verify workflow was cancelled
      await expect(handle.result()).rejects.toThrow();

      // Verify no partial data remains in database
      // Note: The workflow should handle cleanup on cancellation
      const tenants = await testDb.getTenantsMatching(input.tenantName);
      expect(tenants).toHaveLength(0);

      await worker.shutdown();
    });

    it('should handle duplicate email addresses gracefully', async () => {
      const timestamp = Date.now();
      const duplicateEmail = `duplicate-${timestamp}@e2etest.com`;

      const input1: TenantCreationInput = {
        tenantName: `First Tenant ${timestamp}`,
        adminUser: {
          firstName: 'First',
          lastName: 'User',
          email: duplicateEmail,
        },
      };

      const input2: TenantCreationInput = {
        tenantName: `Second Tenant ${timestamp}`,
        adminUser: {
          firstName: 'Second',
          lastName: 'User',
          email: duplicateEmail, // Same email
        },
      };

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      // First workflow should succeed
      const handle1 = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input1],
        taskQueue: 'test-task-queue',
        workflowId: `duplicate-test-1-${timestamp}`,
      });

      const result1 = await handle1.result();
      expect(result1.success).toBe(true);

      // Second workflow should fail due to duplicate email
      const handle2 = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input2],
        taskQueue: 'test-task-queue',
        workflowId: `duplicate-test-2-${timestamp}`,
      });

      await expect(handle2.result()).rejects.toThrow();

      // Verify only first tenant exists
      const tenants = await testDb.getTenantsMatching('Tenant');
      expect(tenants).toHaveLength(1);
      expect(tenants[0].company_name).toBe(input1.tenantName);

      await worker.shutdown();
    });
  });

  describe('Workflow State and Queries', () => {
    it('should provide accurate workflow state during execution', async () => {
      const timestamp = Date.now();
      const input: TenantCreationInput = {
        tenantName: `State Test ${timestamp}`,
        adminUser: {
          firstName: 'State',
          lastName: 'Test',
          email: `state-${timestamp}@e2etest.com`,
        },
      };

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      const handle = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue: 'test-task-queue',
        workflowId: `state-test-${timestamp}`,
      });

      // Query workflow state during execution
      const initialState = await handle.query('getState');
      expect(initialState.step).toBe('initializing');
      expect(initialState.progress).toBe(0);

      // Wait for completion
      const result = await handle.result();
      expect(result.success).toBe(true);

      // Query final state
      const finalState = await handle.query('getState');
      expect(finalState.step).toBe('completed');
      expect(finalState.progress).toBe(100);
      expect(finalState.tenantId).toBe(result.tenantId);
      expect(finalState.adminUserId).toBe(result.adminUserId);

      await worker.shutdown();
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete workflow within reasonable time', async () => {
      const timestamp = Date.now();
      const input: TenantCreationInput = {
        tenantName: `Perf Test ${timestamp}`,
        adminUser: {
          firstName: 'Perf',
          lastName: 'Test',
          email: `perf-${timestamp}@e2etest.com`,
        },
      };

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-task-queue',
        workflowsPath: require.resolve('../workflows'),
        activities,
      });

      const startTime = Date.now();
      
      const handle = await testEnv.client.workflow.start(tenantCreationWorkflow, {
        args: [input],
        taskQueue: 'test-task-queue',
        workflowId: `perf-test-${timestamp}`,
      });

      const result = await handle.result();
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      await worker.shutdown();
    });
  });
});