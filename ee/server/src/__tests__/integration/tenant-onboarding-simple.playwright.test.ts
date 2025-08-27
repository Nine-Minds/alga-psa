/**
 * Simple Tenant Onboarding Integration Tests
 * 
 * Basic tests for tenant creation and database operations without requiring
 * the full application server to be running.
 */

import { test, expect } from '@playwright/test';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

test.describe('Tenant Onboarding Database Tests', () => {
  test('should create tenant with admin user successfully', async () => {
    const db = createTestDbConnection();
    
    try {
      // Create test tenant
      const tenantData = await createTestTenant(db);
      
      // Verify tenant was created
      expect(tenantData.tenant.tenantId).toBeDefined();
      expect(tenantData.adminUser.userId).toBeDefined();
      expect(tenantData.adminUser.temporaryPassword).toBeDefined();
      
      // Verify tenant exists in database
      const tenant = await db('tenants')
        .where('tenant', tenantData.tenant.tenantId)
        .first() as { tenant: string; tenant_name: string } | undefined;
      expect(tenant).toBeDefined();
      
      // Verify admin user exists
      const user = await db('users')
        .where('user_id', tenantData.adminUser.userId)
        .first() as { user_id: string; tenant: string; email: string } | undefined;
      expect(user).toBeDefined();
      expect(user?.tenant).toBe(tenantData.tenant.tenantId);
      
      // Verify user role assignment
      const userRole = await db('user_roles')
        .where('user_id', tenantData.adminUser.userId)
        .where('tenant', tenantData.tenant.tenantId)
        .first() as { user_id: string; role_id: string; tenant: string } | undefined;
      expect(userRole).toBeDefined();
      
      // Clean up
      await rollbackTenant(db, tenantData.tenant.tenantId);
      
      // Verify cleanup worked
      const cleanedTenant = await db('tenants')
        .where('tenant', tenantData.tenant.tenantId)
        .first() as { tenant: string } | undefined;
      expect(cleanedTenant).toBeUndefined();
      
    } finally {
      await db.destroy();
    }
  });

  test('should handle password generation correctly', async () => {
    const db = createTestDbConnection();
    
    try {
      // Create multiple test tenants to verify password uniqueness
      const tenant1 = await createTestTenant(db, {
        companyName: 'Test Company 1',
        adminUser: { firstName: 'Admin1', lastName: 'User', email: 'admin1@test.com' }
      });
      
      const tenant2 = await createTestTenant(db, {
        companyName: 'Test Company 2', 
        adminUser: { firstName: 'Admin2', lastName: 'User', email: 'admin2@test.com' }
      });
      
      // Verify passwords are different
      expect(tenant1.adminUser.temporaryPassword).not.toBe(tenant2.adminUser.temporaryPassword);
      
      // Verify password requirements
      const password1 = tenant1.adminUser.temporaryPassword;
      expect(password1.length).toBeGreaterThanOrEqual(12);
      expect(password1).toMatch(/[A-Z]/); // Contains uppercase
      expect(password1).toMatch(/[a-z]/); // Contains lowercase  
      expect(password1).toMatch(/[0-9]/); // Contains number
      expect(password1).toMatch(/[!@#$%^&*]/); // Contains special char
      
      // Clean up
      await rollbackTenant(db, tenant1.tenant.tenantId);
      await rollbackTenant(db, tenant2.tenant.tenantId);
      
    } finally {
      await db.destroy();
    }
  });

  test('should maintain tenant isolation', async () => {
    const db = createTestDbConnection();
    
    try {
      // Create two separate tenants
      const tenant1 = await createTestTenant(db, {
        companyName: 'Tenant 1 Company',
        adminUser: { firstName: 'Admin1', lastName: 'User', email: 'admin1@tenant1.com' }
      });
      
      const tenant2 = await createTestTenant(db, {
        companyName: 'Tenant 2 Company',
        adminUser: { firstName: 'Admin2', lastName: 'User', email: 'admin2@tenant2.com' }
      });
      
      // Verify tenant 1 user can't see tenant 2 data
      const tenant1Users = await db('users')
        .where('tenant', tenant1.tenant.tenantId) as Array<{ user_id: string; tenant: string; email: string }>;
      
      const tenant2Users = await db('users')
        .where('tenant', tenant2.tenant.tenantId) as Array<{ user_id: string; tenant: string; email: string }>;
      
      expect(tenant1Users.length).toBe(1);
      expect(tenant2Users.length).toBe(1);
      expect(tenant1Users[0].user_id).not.toBe(tenant2Users[0].user_id);
      
      // Verify companies are separate
      const tenant1Companies = await db('companies')
        .where('tenant', tenant1.tenant.tenantId) as Array<{ company_id: string; tenant: string; company_name: string }>;
        
      const tenant2Companies = await db('companies')
        .where('tenant', tenant2.tenant.tenantId) as Array<{ company_id: string; tenant: string; company_name: string }>;
      
      expect(tenant1Companies.length).toBe(1);
      expect(tenant2Companies.length).toBe(1);
      expect(tenant1Companies[0].company_id).not.toBe(tenant2Companies[0].company_id);
      
      // Clean up
      await rollbackTenant(db, tenant1.tenant.tenantId);
      await rollbackTenant(db, tenant2.tenant.tenantId);
      
    } finally {
      await db.destroy();
    }
  });
});