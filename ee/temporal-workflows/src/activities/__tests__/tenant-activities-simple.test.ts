import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, type TestDatabase } from '../../test-utils/database';
import { withAdminTransaction } from '@shared/db';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

// Simple database operations that mirror the activity logic without Temporal context
async function createTenantInDB(input: { tenantName: string; companyName?: string }) {
  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    const tenantId = uuidv4();
    
    // Create tenant record
    await trx('tenants').insert({
      tenant: tenantId,
      company_name: input.tenantName,
      created_at: new Date(),
      updated_at: new Date(),
    });

    let companyId: string | undefined;

    // Create default company if company name is provided
    if (input.companyName) {
      companyId = uuidv4();
      
      await trx('companies').insert({
        company_id: companyId,
        tenant: tenantId,
        company_name: input.companyName,
        is_inactive: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Create tenant-company association
      await trx('tenant_companies').insert({
        tenant: tenantId,
        company_id: companyId,
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    return { tenantId, companyId };
  });
}

async function setupTenantDataInDB(input: {
  tenantId: string;
  adminUserId?: string;
  companyId?: string;
  billingPlan?: string;
}) {
  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    const setupSteps: string[] = [];

    // Set up default roles
    const defaultRoles = [
      { name: 'Admin', description: 'Administrator with full access' },
      { name: 'User', description: 'Standard user with limited access' },
      { name: 'Client', description: 'Client user with restricted access' }
    ];

    for (const role of defaultRoles) {
      await trx('roles').insert({
        role_id: uuidv4(),
        tenant: input.tenantId,
        role_name: role.name,
        description: role.description,
        created_at: new Date(),
      });
      setupSteps.push(`Created ${role.name} role`);
    }

    // Set up default statuses
    const defaultStatuses = [
      { name: 'Open', color: '#3B82F6', is_closed: false },
      { name: 'In Progress', color: '#F59E0B', is_closed: false },
      { name: 'Resolved', color: '#10B981', is_closed: true },
      { name: 'Closed', color: '#6B7280', is_closed: true }
    ];

    for (const status of defaultStatuses) {
      await trx('statuses').insert({
        status_id: uuidv4(),
        tenant: input.tenantId,
        status_name: status.name,
        status_color: status.color,
        is_closed: status.is_closed,
        created_at: new Date(),
      });
    }
    setupSteps.push('Created default statuses');

    return { success: true, setupSteps };
  });
}

describe('Tenant Activities Database Logic', () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe('createTenantInDB', () => {
    it('should create a tenant with basic information', async () => {
      const input = {
        tenantName: 'Test Company Inc',
        companyName: 'Test Company'
      };

      const result = await createTenantInDB(input);

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
      const input = {
        tenantName: 'Solo Tenant'
      };

      const result = await createTenantInDB(input);

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
      const input1 = {
        tenantName: 'Duplicate Test'
      };
      const input2 = {
        tenantName: 'Duplicate Test'
      };

      // Create first tenant
      const result1 = await createTenantInDB(input1);
      expect(result1.tenantId).toBeDefined();

      // Create second tenant with same name (should succeed with different ID)
      const result2 = await createTenantInDB(input2);
      expect(result2.tenantId).toBeDefined();
      expect(result1.tenantId).not.toBe(result2.tenantId);
    });
  });

  describe('setupTenantDataInDB', () => {
    it('should set up complete tenant data', async () => {
      // First create a tenant
      const createResult = await createTenantInDB({
        tenantName: 'Setup Test Company',
        companyName: 'Setup Test Co'
      });

      const setupInput = {
        tenantId: createResult.tenantId,
        adminUserId: 'admin-user-123',
        companyId: createResult.companyId,
        billingPlan: 'Enterprise'
      };

      const result = await setupTenantDataInDB(setupInput);

      expect(result.success).toBe(true);
      expect(result.setupSteps).toContain('Created Admin role');
      expect(result.setupSteps).toContain('Created User role');
      expect(result.setupSteps).toContain('Created Client role');
      expect(result.setupSteps).toContain('Created default statuses');

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
  });

  describe('error handling', () => {
    it('should validate input parameters', async () => {
      const invalidInput = {
        tenantName: '', // Empty tenant name
      };

      await expect(createTenantInDB(invalidInput)).rejects.toThrow();
    });
  });
});