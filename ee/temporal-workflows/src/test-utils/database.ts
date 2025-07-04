import { getAdminConnection, withAdminTransaction } from '@shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export interface TestDatabase {
  tenantId: string;
  cleanup: () => Promise<void>;
  getTenant: (tenantId: string) => Promise<any>;
  getUser: (userId: string) => Promise<any>;
  getUserRoles: (userId: string) => Promise<any[]>;
  getTenantsMatching: (name: string) => Promise<any[]>;
  getCompaniesForTenant: (tenantId: string) => Promise<any[]>;
  getRolesForTenant: (tenantId: string) => Promise<any[]>;
  getStatusesForTenant: (tenantId: string) => Promise<any[]>;
  blockUserTable: () => Promise<void>;
  unblockUserTable: () => Promise<void>;
}

/**
 * Set up isolated test database environment
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const testTenantId = uuidv4();
  const createdTenants: string[] = [];
  const createdUsers: string[] = [];
  let userTableBlocked = false;

  const testDb: TestDatabase = {
    tenantId: testTenantId,

    async cleanup() {
      await withAdminTransaction(async (trx: Knex.Transaction) => {
        // Clean up in reverse dependency order
        
        // Remove user roles
        for (const userId of createdUsers) {
          await trx('user_roles').where({ user_id: userId }).del();
        }
        
        // Remove users
        for (const userId of createdUsers) {
          await trx('users').where({ user_id: userId }).del();
        }
        
        // Remove tenant companies
        for (const tenantId of createdTenants) {
          await trx('tenant_companies').where({ tenant: tenantId }).del();
        }
        
        // Remove companies
        for (const tenantId of createdTenants) {
          await trx('companies').where({ tenant: tenantId }).del();
        }
        
        // Remove billing plans and associations
        for (const tenantId of createdTenants) {
          await trx('company_billing_plans').where({ tenant: tenantId }).del();
          await trx('billing_plans').where({ tenant: tenantId }).del();
        }
        
        // Remove roles
        for (const tenantId of createdTenants) {
          await trx('roles').where({ tenant: tenantId }).del();
        }
        
        // Remove statuses
        for (const tenantId of createdTenants) {
          await trx('statuses').where({ tenant: tenantId }).del();
        }
        
        // Remove tenants
        for (const tenantId of createdTenants) {
          await trx('tenants').where({ tenant: tenantId }).del();
        }
      });
    },

    async getTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('tenants').where({ tenant: tenantId }).first();
      });
    },

    async getUser(userId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('users').where({ user_id: userId }).first();
      });
    },

    async getUserRoles(userId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('user_roles as ur')
          .join('roles as r', 'ur.role_id', 'r.role_id')
          .where({ 'ur.user_id': userId })
          .select('r.*');
      });
    },

    async getTenantsMatching(name: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('tenants')
          .where('company_name', 'like', `%${name}%`)
          .select('*');
      });
    },

    async getCompaniesForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('companies')
          .where({ tenant: tenantId })
          .select('*');
      });
    },

    async getRolesForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('roles')
          .where({ tenant: tenantId })
          .select('*');
      });
    },

    async getStatusesForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('statuses')
          .where({ tenant: tenantId })
          .select('*');
      });
    },

    async blockUserTable() {
      userTableBlocked = true;
      // In a real implementation, this might temporarily rename the table
      // or add a constraint that causes failures
      // For now, we'll track this state and simulate failures in activities
    },

    async unblockUserTable() {
      userTableBlocked = false;
    }
  };

  // Hook into activity calls to track created resources
  const originalActivity = (global as any).__TEST_ACTIVITY_HOOK;
  (global as any).__TEST_ACTIVITY_HOOK = (activityName: string, result: any) => {
    if (activityName === 'createTenant' && result?.tenantId) {
      createdTenants.push(result.tenantId);
    }
    if (activityName === 'createAdminUser' && result?.userId) {
      createdUsers.push(result.userId);
    }
    
    // Simulate user table blocking
    if (activityName === 'createAdminUser' && userTableBlocked) {
      throw new Error('User table is blocked for testing');
    }
    
    if (originalActivity) {
      originalActivity(activityName, result);
    }
  };

  return testDb;
}

/**
 * Create test data factory for consistent test inputs
 */
export function createTestTenantInput(overrides: any = {}) {
  const timestamp = Date.now();
  return {
    tenantName: `test-tenant-${timestamp}`,
    adminUser: {
      firstName: 'Test',
      lastName: 'Admin',
      email: `test-admin-${timestamp}@example.com`
    },
    companyName: `test-company-${timestamp}`,
    ...overrides
  };
}

/**
 * Utility to wait for database operations to complete
 */
export async function waitForDbOperation(operation: () => Promise<boolean>, timeoutMs = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await operation()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

/**
 * Verify database state matches expectations
 */
export async function verifyDatabaseState(
  testDb: TestDatabase,
  expectations: {
    tenantExists?: boolean;
    userExists?: boolean;
    userHasAdminRole?: boolean;
    tenantId?: string;
    userId?: string;
  }
) {
  const results: any = {};
  
  if (expectations.tenantId) {
    const tenant = await testDb.getTenant(expectations.tenantId);
    results.tenantExists = !!tenant;
    results.tenant = tenant;
  }
  
  if (expectations.userId) {
    const user = await testDb.getUser(expectations.userId);
    results.userExists = !!user;
    results.user = user;
    
    if (user) {
      const roles = await testDb.getUserRoles(expectations.userId);
      results.userHasAdminRole = roles.some(r => r.role_name === 'Admin');
      results.userRoles = roles;
    }
  }
  
  return results;
}