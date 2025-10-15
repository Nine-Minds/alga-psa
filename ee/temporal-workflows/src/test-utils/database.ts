import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

// Local database connection for testing
async function getTestDbConnection(): Promise<Knex> {
  const knex = require('knex');
  
  // Use environment variables for test database connection
  // If no database is configured, use in-memory SQLite for testing
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    // Use SQLite in-memory for testing when no database is configured
    return knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
  }
  
  const dbConfig = {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || undefined, // Use undefined instead of empty string
      database: process.env.DB_NAME || 'test_database',
    },
    pool: {
      min: 1,
      max: 5,
    },
  };
  
  return knex(dbConfig);
}

// Execute operation with database transaction
async function withAdminTransaction<T>(operation: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const db = await getTestDbConnection();
  try {
    return await db.transaction(operation);
  } finally {
    await db.destroy();
  }
}

export interface TestDatabase {
  tenantId: string;
  cleanup: () => Promise<void>;
  trackUser: (userId: string) => void;
  getTenant: (tenantId: string) => Promise<any>;
  getUser: (userId: string) => Promise<any>;
  getUserById: (userId: string, tenantId: string) => Promise<any>;
  getUserRoles: (userId: string, tenantId: string) => Promise<any[]>;
  getRoleById: (roleId: string, tenantId: string) => Promise<any>;
  getClientById: (clientId: string, tenantId: string) => Promise<any>;
  getTenantsMatching: (name: string) => Promise<any[]>;
  getClientsForTenant: (tenantId: string) => Promise<any[]>;
  getRolesForTenant: (tenantId: string) => Promise<any[]>;
  getStatusesForTenant: (tenantId: string) => Promise<any[]>;
  createTenant: (input: { tenantId: string; tenantName: string; email: string }) => Promise<void>;
  createClient: (input: { clientId: string; tenantId: string; clientName: string }) => Promise<void>;
  createRole: (input: { roleId: string; tenantId: string; roleName: string; description: string }) => Promise<void>;
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

  const trackUser = (userId: string) => {
    if (!createdUsers.includes(userId)) {
      createdUsers.push(userId);
    }
  };

  const testDb: TestDatabase = {
    tenantId: testTenantId,

    trackUser,

    async cleanup() {
      await withAdminTransaction(async (trx: Knex.Transaction) => {
        // Clean up in reverse dependency order
        
        // Clean up in correct dependency order to avoid foreign key violations
        
        // Remove user preferences first
        for (const userId of createdUsers) {
          await trx('user_preferences').where({ user_id: userId }).del();
        }
        
        // Remove user roles (references both users and roles)
        for (const tenantId of createdTenants) {
          await trx('user_roles').where({ tenant: tenantId }).del();
        }
        
        // Clear account manager references in clients before deleting users
        for (const tenantId of createdTenants) {
          await trx('clients')
            .where({ tenant: tenantId })
            .update({ account_manager_id: null });
        }
        
        // Remove users (may be referenced as created_by in statuses)
        for (const userId of createdUsers) {
          await trx('users').where({ user_id: userId }).del();
        }
        
        // Remove tenant clients
        for (const tenantId of createdTenants) {
          await trx('tenant_companies').where({ tenant: tenantId }).del();
        }
        
        // Remove clients
        for (const tenantId of createdTenants) {
          await trx('clients').where({ tenant: tenantId }).del();
        }
        
        // Remove contract lines and associations
        for (const tenantId of createdTenants) {
          await trx('client_contract_lines').where({ tenant: tenantId }).del();
          await trx('contract_lines').where({ tenant: tenantId }).del();
        }
        
        // Remove statuses (may reference users as created_by)
        for (const tenantId of createdTenants) {
          await trx('statuses').where({ tenant: tenantId }).del();
        }
        
        // Remove roles (after user_roles are removed)
        for (const tenantId of createdTenants) {
          await trx('roles').where({ tenant: tenantId }).del();
        }
        
        // Remove tenants last
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

    async getUserById(userId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('users')
          .where({ user_id: userId, tenant: tenantId })
          .first();
      });
    },

    async getUserRoles(userId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('user_roles as ur')
          .join('roles as r', function() {
            this.on('ur.role_id', 'r.role_id')
                .andOn('ur.tenant', 'r.tenant');
          })
          .where({ 'ur.user_id': userId, 'ur.tenant': tenantId })
          .select('r.*', 'ur.*');
      });
    },

    async getRoleById(roleId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('roles')
          .where({ role_id: roleId, tenant: tenantId })
          .first();
      });
    },

    async getClientById(clientId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('clients')
          .where({ client_id: clientId, tenant: tenantId })
          .first();
      });
    },

    async getTenantsMatching(name: string) {
        return await withAdminTransaction(async (trx: Knex.Transaction) => {
          return await trx('tenants')
            .where('client_name', 'like', `%${name}%`)
            .select('*');
      });
    },

    async getClientsForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await trx('clients')
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
    },

    async createTenant(input: { tenantId: string; tenantName: string; email: string }) {
      await withAdminTransaction(async (trx: Knex.Transaction) => {
        await trx('tenants').insert({
          tenant: input.tenantId,
          client_name: input.tenantName,
          email: input.email,
          created_at: new Date(),
          updated_at: new Date(),
        });
        createdTenants.push(input.tenantId);
      });
    },

    async createClient(input: { clientId: string; tenantId: string; clientName: string }) {
      await withAdminTransaction(async (trx: Knex.Transaction) => {
        await trx('clients').insert({
          client_id: input.clientId,
          tenant: input.tenantId,
          client_name: input.clientName,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date(),
        });
      });
    },

    async createRole(input: { roleId: string; tenantId: string; roleName: string; description: string }) {
      await withAdminTransaction(async (trx: Knex.Transaction) => {
        await trx('roles').insert({
          role_id: input.roleId,
          tenant: input.tenantId,
          role_name: input.roleName,
          description: input.description,
          created_at: new Date(),
        });
      });
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
    clientName: `test-client-${timestamp}`,
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
    
    if (user && expectations.tenantId) {
      const roles = await testDb.getUserRoles(expectations.userId, expectations.tenantId);
      results.userHasAdminRole = roles.some(r => r.role_name === 'Admin');
      results.userRoles = roles;
    }
  }
  
  return results;
}
