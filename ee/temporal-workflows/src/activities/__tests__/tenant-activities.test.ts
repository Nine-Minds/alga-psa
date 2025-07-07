import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { createTenant, setupTenantData, rollbackTenant } from '../tenant-activities';
import { setupTestDatabase, type TestDatabase } from '../../test-utils/database';
import type { CreateTenantActivityInput, SetupTenantDataActivityInput } from '../../types/workflow-types';

describe('Tenant Activities', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    
    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-tenant-activities',
      activities: {
        createTenant,
        setupTenantData,
        rollbackTenant,
      },
    });
  });

  afterEach(async () => {
    await testDb.cleanup();
    await worker.shutdown();
    await testEnv.teardown();
  });

  describe('createTenant', () => {
    it('should create a tenant with basic information', async () => {
      const input: CreateTenantActivityInput = {
        tenantName: 'Test Company Inc',
        companyName: 'Test Company'
      };

      const result = await createTenant(input);

      expect(result.tenantId).toBeDefined();
      expect(result.companyId).toBeDefined();

      // Verify tenant was created in database
      const tenant = await testDb.getTenant(result.tenantId);
      expect(tenant).toBeDefined();
      expect(tenant.company_name).toBe('Test Company Inc');

      // Verify company was created
      if (result.companyId) {
        const companies = await testDb.getCompaniesForTenant(result.tenantId);
        expect(companies).toHaveLength(1);
        expect(companies[0].company_name).toBe('Test Company');
      }
    });

    it('should create a tenant without a company', async () => {
      const input: CreateTenantActivityInput = {
        tenantName: 'Solo Tenant'
      };

      const result = await createTenant(input);

      expect(result.tenantId).toBeDefined();
      expect(result.companyId).toBeUndefined();

      // Verify tenant was created
      const tenant = await testDb.getTenant(result.tenantId);
      expect(tenant).toBeDefined();
      expect(tenant.company_name).toBe('Solo Tenant');

      // Verify no companies were created
      const companies = await testDb.getCompaniesForTenant(result.tenantId);
      expect(companies).toHaveLength(0);
    });

    it('should handle duplicate tenant names gracefully', async () => {
      const input1: CreateTenantActivityInput = {
        tenantName: 'Duplicate Test'
      };
      const input2: CreateTenantActivityInput = {
        tenantName: 'Duplicate Test'
      };

      // Create first tenant
      const result1 = await createTenant(input1);
      expect(result1.tenantId).toBeDefined();

      // Create second tenant with same name (should succeed with different ID)
      const result2 = await createTenant(input2);
      expect(result2.tenantId).toBeDefined();
      expect(result1.tenantId).not.toBe(result2.tenantId);
    });
  });

  describe('setupTenantData', () => {
    it('should set up complete tenant data with all features', async () => {
      // First create a tenant
      const createInput: CreateTenantActivityInput = {
        tenantName: 'Setup Test Company',
        companyName: 'Setup Test Co'
      };
      const createResult = await createTenant(createInput);

      const setupInput: SetupTenantDataActivityInput = {
        tenantId: createResult.tenantId,
        adminUserId: 'admin-user-123',
        companyId: createResult.companyId,
        billingPlan: 'Enterprise'
      };

      const result = await setupTenantData(setupInput);

      expect(result.success).toBe(true);
      expect(result.setupSteps).toContain('Created Admin role');
      expect(result.setupSteps).toContain('Created User role');
      expect(result.setupSteps).toContain('Created Client role');
      expect(result.setupSteps).toContain('Created default statuses');
      expect(result.setupSteps).toContain('Set up billing plan: Enterprise');
      expect(result.setupSteps).toContain('Set up default notification preferences');

      // Verify roles were created
      const roles = await testDb.getRolesForTenant(createResult.tenantId);
      expect(roles).toHaveLength(3);
      const roleNames = roles.map(r => r.role_name);
      expect(roleNames).toContain('Admin');
      expect(roleNames).toContain('User');
      expect(roleNames).toContain('Client');

      // Verify statuses were created
      const statuses = await testDb.getStatusesForTenant(createResult.tenantId);
      expect(statuses.length).toBeGreaterThan(0);
      const statusNames = statuses.map(s => s.status_name);
      expect(statusNames).toContain('Open');
      expect(statusNames).toContain('Closed');
    });

    it('should skip setup steps that already exist', async () => {
      // Create tenant and set up data once
      const createInput: CreateTenantActivityInput = {
        tenantName: 'Existing Setup Company',
        companyName: 'Existing Setup Co'
      };
      const createResult = await createTenant(createInput);

      const setupInput: SetupTenantDataActivityInput = {
        tenantId: createResult.tenantId,
        adminUserId: 'admin-user-456',
        companyId: createResult.companyId,
        billingPlan: 'Basic'
      };

      // First setup
      const result1 = await setupTenantData(setupInput);
      expect(result1.success).toBe(true);

      // Second setup should skip existing items
      const result2 = await setupTenantData(setupInput);
      expect(result2.success).toBe(true);
      
      // Should have fewer setup steps the second time
      expect(result2.setupSteps.length).toBeLessThan(result1.setupSteps.length);
    });
  });

  describe('rollbackTenant', () => {
    it('should completely remove tenant and all associated data', async () => {
      // Create a complete tenant setup
      const createInput: CreateTenantActivityInput = {
        tenantName: 'Rollback Test Company',
        companyName: 'Rollback Test Co'
      };
      const createResult = await createTenant(createInput);

      const setupInput: SetupTenantDataActivityInput = {
        tenantId: createResult.tenantId,
        adminUserId: 'admin-user-789',
        companyId: createResult.companyId,
        billingPlan: 'Pro'
      };
      await setupTenantData(setupInput);

      // Verify data exists
      let tenant = await testDb.getTenant(createResult.tenantId);
      expect(tenant).toBeDefined();

      // Perform rollback
      await rollbackTenant(createResult.tenantId);

      // Verify tenant and all data is removed
      tenant = await testDb.getTenant(createResult.tenantId);
      expect(tenant).toBeUndefined();

      const roles = await testDb.getRolesForTenant(createResult.tenantId);
      expect(roles).toHaveLength(0);

      const statuses = await testDb.getStatusesForTenant(createResult.tenantId);
      expect(statuses).toHaveLength(0);

      const companies = await testDb.getCompaniesForTenant(createResult.tenantId);
      expect(companies).toHaveLength(0);
    });

    it('should handle rollback of non-existent tenant gracefully', async () => {
      const fakeId = 'fake-tenant-id-123';
      
      // Should not throw error
      await expect(rollbackTenant(fakeId)).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle database connection failures', async () => {
      // This test would require mocking database failures
      // For now, we'll skip this as it requires more complex setup
    });

    it('should validate input parameters', async () => {
      const invalidInput = {
        tenantName: '', // Empty tenant name
      } as CreateTenantActivityInput;

      await expect(createTenant(invalidInput)).rejects.toThrow();
    });
  });
});