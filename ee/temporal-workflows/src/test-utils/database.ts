import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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

function unscopedTestTable(
  trx: Knex.Transaction,
  table: string,
  reason: string
) {
  return tenantDb(trx, '__test_tenant_discovery__').unscoped(table, reason);
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
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          if (createdUsers.length > 0) {
            await db.table('user_preferences').whereIn('user_id', createdUsers).del();
          }
        }
        
        // Remove user roles (references both users and roles)
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('user_roles').del();
        }
        
        // Clear account manager references in clients before deleting users
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('clients').update({ account_manager_id: null });
        }
        
        // Remove users (may be referenced as created_by in statuses)
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          if (createdUsers.length > 0) {
            await db.table('users').whereIn('user_id', createdUsers).del();
          }
        }
        
        // Remove tenant clients
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('tenant_companies').del();
        }
        
        // Remove clients
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('clients').del();
        }
        
        // Remove contract lines and associations
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('client_contract_lines').del();
          await db.table('contract_lines').del();
        }
        
        // Remove statuses (may reference users as created_by)
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('statuses').del();
        }
        
        // Remove roles (after user_roles are removed)
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('roles').del();
        }
        
        // Remove tenants last
        for (const tenantId of createdTenants) {
          const db = tenantDb(trx, tenantId);
          await db.table('tenants').del();
        }
      });
    },

    async getTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('tenants').first();
      });
    },

    async getUser(userId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await unscopedTestTable(
          trx,
          'users',
          'test utility getUser resolves a user id before caller supplies tenant context'
        )
          .where({ user_id: userId })
          .first();
      });
    },

    async getUserById(userId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('users')
          .where({ user_id: userId })
          .first();
      });
    },

    async getUserRoles(userId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        const db = tenantDb(trx, tenantId);
        const query = db.table('user_roles as ur');
        db.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
        return await query
          .where({ 'ur.user_id': userId })
          .select('r.*', 'ur.*');
      });
    },

    async getRoleById(roleId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('roles')
          .where({ role_id: roleId })
          .first();
      });
    },

    async getClientById(clientId: string, tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('clients')
          .where({ client_id: clientId })
          .first();
      });
    },

    async getTenantsMatching(name: string) {
        return await withAdminTransaction(async (trx: Knex.Transaction) => {
          return await unscopedTestTable(
            trx,
            'tenants',
            'test utility searches tenant rows by name before selecting a tenant context'
          )
            .where('client_name', 'like', `%${name}%`)
            .select('*');
      });
    },

    async getClientsForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('clients')
          .select('*');
      });
    },

    async getRolesForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('roles')
          .select('*');
      });
    },

    async getStatusesForTenant(tenantId: string) {
      return await withAdminTransaction(async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenantId).table('statuses')
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
        await tenantDb(trx, input.tenantId).table('tenants').insert({
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
        await tenantDb(trx, input.tenantId).table('clients').insert({
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
        await tenantDb(trx, input.tenantId).table('roles').insert({
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
