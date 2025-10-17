import { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestEnvironment } from '../../../../test-utils/testDataFactory';
import { createTestApiKey, ApiTestClient } from './apiTestHelpers';
import { cleanupTestContacts } from './contactTestDataFactory';
import { setupTestUserWithPermissions } from './simpleRoleSetup';
import { v4 as uuidv4 } from 'uuid';

/**
 * E2E test environment containing all necessary test data and utilities
 */
export interface E2ETestEnvironment {
  db: Knex;
  tenant: string;
  clientId: string;
  addressId: string;
  userId: string;
  apiKey: string;
  apiClient: ApiTestClient;
  cleanup: () => Promise<void>;
}


/**
 * Setup a complete E2E test environment
 * @param options Setup options
 * @returns E2E test environment
 */
export async function setupE2ETestEnvironment(options: {
  baseUrl?: string;
  clientName?: string;
  userName?: string;
} = {}): Promise<E2ETestEnvironment> {
  const resolvedDbHost = process.env.E2E_DB_HOST
    || process.env.PGBOUNCER_HOST
    || process.env.DB_HOST
    || '127.0.0.1';
  const resolvedDbPort = process.env.E2E_DB_PORT
    || process.env.PGBOUNCER_PORT
    || process.env.DB_PORT
    || (resolvedDbHost === '127.0.0.1' ? '5432' : '6432');

  process.env.DB_HOST = resolvedDbHost;
  process.env.DB_PORT = resolvedDbPort;
  process.env.DB_DIRECT_HOST = process.env.E2E_DB_DIRECT_HOST || process.env.DB_DIRECT_HOST || resolvedDbHost;
  process.env.DB_DIRECT_PORT = process.env.E2E_DB_DIRECT_PORT || process.env.DB_DIRECT_PORT || resolvedDbPort;
  process.env.DB_NAME_SERVER = process.env.E2E_DB_NAME || process.env.DB_NAME_SERVER || 'server';

  const db = await createTestDbConnection();

  await normalizeServiceBillingConstraints(db);

  try {
    // Create test environment with tenant, client, address and user
    const { tenantId, clientId, locationId, userId } = await createTestEnvironment(db, {
      clientName: options.clientName,
      userName: options.userName
    });

    // Setup permissions for the test user
    await setupTestUserWithPermissions(db, userId, tenantId);

    // Create default statuses for projects and tickets
    await createDefaultStatuses(db, tenantId, userId);

    // Create API key for the test user
    const apiKeyRecord = await createTestApiKey(db, userId, tenantId);

    // Create API client with the API key and tenant ID
    const apiClient = new ApiTestClient({
      baseUrl: options.baseUrl || process.env.TEST_API_BASE_URL || 'http://127.0.0.1:3000',
      apiKey: apiKeyRecord.api_key,
      tenantId: tenantId
    });

    // Create cleanup function
    const cleanup = async () => {
      try {
        // Clean up test data in reverse order of creation
        // Delete tickets first as they reference contacts
        await db('tickets')
          .where('tenant', tenantId)
          .delete();
          
        await cleanupTestContacts(db, tenantId);
        
        // Clean up role permissions first
        await db('role_permissions')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up user roles
        await db('user_roles')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up API keys
        await db('api_keys')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up time entries first
        await db('time_entries')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up time sheets before time periods
        await db('time_sheets')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up time periods and types
        await db('time_periods')
          .where('tenant', tenantId)
          .delete();
          
          
        // Clean up service catalog
        await db('service_catalog')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up service types
        await db('service_types')
          .where('tenant', tenantId)
          .delete()
          .catch(() => {}); // Ignore if table doesn't exist
          
        // Clean up tickets first (they reference many other tables)
        await db('tickets')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up boards (they reference tenants)
        await db('boards')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up priorities (they reference users via created_by)
        await db('priorities')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up tag_mappings first (they reference users via created_by)
        await db('tag_mappings')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up tag_definitions (they reference users via created_by)
        await db('tag_definitions')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up statuses (they reference users via created_by)
        await db('statuses')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up team members first (they reference teams and users)
        await db('team_members')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up teams (they reference users via manager_id)
        await db('teams')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up user preferences (they reference users)
        await db('user_preferences')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up users
        await db('users')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up permissions
        await db('permissions')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up roles
        await db('roles')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up client locations
        await db('client_locations')
          .where('tenant', tenantId)
          .delete();

        // Clean up clients
        await db('clients')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up next_number entries first
        await db('next_number')
          .where('tenant', tenantId)
          .delete();
          
        // Clean up tenant
        await db('tenants')
          .where('tenant', tenantId)
          .delete();
      } catch (error) {
        console.error('Error during cleanup:', error);
        throw error;
      } finally {
        // Always destroy the database connection
        await db.destroy();
      }
    };

    return {
      db,
      tenant: tenantId,
      clientId,
      addressId: locationId,
      userId,
      apiKey: apiKeyRecord.api_key,
      apiClient,
      cleanup,
    };
  } catch (error) {
    // If setup fails, clean up the database connection
    await db.destroy();
    throw error;
  }
}

async function normalizeServiceBillingConstraints(db: Knex): Promise<void> {
  await db.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS service_types_billing_method_check');
  await db.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS billing_method_check');
  await db.raw("ALTER TABLE service_types ADD CONSTRAINT service_types_billing_method_check CHECK (billing_method IN ('fixed','per_unit','hourly','usage'))");

  await db.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS service_catalog_billing_method_check');
  await db.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS billing_method_check');
  await db.raw("ALTER TABLE service_catalog ADD CONSTRAINT service_catalog_billing_method_check CHECK (billing_method IN ('fixed','per_unit','hourly','usage'))");
}

/**
 * Setup function for use in beforeEach hooks
 * @param testContext Object to store test environment (usually 'this' in tests)
 * @param options Setup options
 */
export async function beforeEachE2ETest(
  testContext: any,
  options: Parameters<typeof setupE2ETestEnvironment>[0] = {}
): Promise<void> {
  testContext.env = await setupE2ETestEnvironment(options);
}

/**
 * Cleanup function for use in afterEach hooks
 * @param testContext Object containing test environment
 */
export async function afterEachE2ETest(testContext: any): Promise<void> {
  if (testContext.env && typeof testContext.env.cleanup === 'function') {
    await testContext.env.cleanup();
    testContext.env = null;
  }
}

/**
 * Helper to run a test with automatic setup and cleanup
 * @param testFn Test function
 * @param options Setup options
 */
export async function withE2ETestEnvironment<T>(
  testFn: (env: E2ETestEnvironment) => Promise<T>,
  options: Parameters<typeof setupE2ETestEnvironment>[0] = {}
): Promise<T> {
  const env = await setupE2ETestEnvironment(options);
  
  try {
    return await testFn(env);
  } finally {
    await env.cleanup();
  }
}

/**
 * Create a test user with specific permissions
 * @param db Knex database instance
 * @param tenant Tenant ID
 * @param permissions Array of permission strings
 * @returns User ID
 */
export async function createTestUserWithPermissions(
  db: Knex,
  tenant: string,
  permissions: string[]
): Promise<string> {
  // This is a placeholder - implement based on your permission system
  // For now, just create a basic user
  const userId = require('uuid').v4();
  const now = new Date();

  await db('users').insert({
    user_id: userId,
    tenant,
    username: `test.user.${userId}`,
    first_name: 'Test',
    last_name: 'User',
    email: `test.user.${userId}@example.com`,
    hashed_password: 'hashed_password_here',
    created_at: now,
    user_type: 'internal'
  });

  // TODO: Add permission assignment logic here
  
  return userId;
}

/**
 * Wait for API to be ready (useful for CI environments)
 * @param apiClient API client to test with
 * @param maxAttempts Maximum number of attempts
 * @param delayMs Delay between attempts in milliseconds
 */
export async function waitForApiReady(
  apiClient: ApiTestClient,
  maxAttempts: number = 30,
  delayMs: number = 1000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Try to hit a health check endpoint or the root
      const response = await apiClient.get('/api/health');
      if (response.ok) {
        return;
      }
    } catch (error) {
      // API not ready yet
    }
    
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error(`API not ready after ${maxAttempts} attempts`);
}

/**
 * Database transaction wrapper for tests
 * Automatically rolls back changes after test
 */
export async function withDatabaseTransaction<T>(
  db: Knex,
  testFn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (trx) => {
    try {
      const result = await testFn(trx);
      // Always rollback in tests
      await trx.rollback();
      return result;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  });
}

/**
 * Create default statuses for projects and tickets
 */
async function createDefaultStatuses(db: Knex, tenantId: string, userId: string): Promise<void> {
  // Check if statuses already exist for this tenant
  const existingStatuses = await db('statuses').where({ tenant: tenantId }).count('* as count');
  if (parseInt(existingStatuses[0].count) > 0) {
    return; // Statuses already exist
  }

  // Create default statuses for projects and tickets
  const statusTypes = [
    { item_type: 'project', name: 'Planning', order: 1, is_default: true },
    { item_type: 'project', name: 'Active', order: 2 },
    { item_type: 'project', name: 'On Hold', order: 3 },
    { item_type: 'project', name: 'Completed', order: 4 },
    { item_type: 'ticket', name: 'New', order: 1, is_default: true },
    { item_type: 'ticket', name: 'In Progress', order: 2 },
    { item_type: 'ticket', name: 'Resolved', order: 3 },
    { item_type: 'ticket', name: 'Closed', order: 4 }
  ];

  for (const status of statusTypes) {
    await db('statuses').insert({
      status_id: uuidv4(),
      tenant: tenantId,
      name: status.name,
      status_type: status.item_type, // Still required as NOT NULL
      item_type: status.item_type, // Also set this for future compatibility
      order_number: status.order,
      created_by: userId,
      created_at: new Date(),
      is_closed: status.name === 'Completed' || status.name === 'Closed' || status.name === 'Resolved',
      is_default: status.is_default || false
    });
  }
  
  // Create a default board for tickets
  const existingBoards = await db('boards').where({ tenant: tenantId }).count('* as count');
  if (parseInt(existingBoards[0].count) === 0) {
    await db('boards').insert({
      board_id: uuidv4(),
      tenant: tenantId,
      board_name: 'Default',
      is_default: true,
      display_order: 1
    });
  }
  
  // Create default priorities for tickets
  const existingPriorities = await db('priorities').where({ tenant: tenantId }).count('* as count');
  if (parseInt(existingPriorities[0].count) === 0) {
    const priorities = [
      { name: 'Low', order: 1, color: '#10B981' },
      { name: 'Medium', order: 2, color: '#F59E0B' },
      { name: 'High', order: 3, color: '#EF4444' }
    ];
    
    for (const priority of priorities) {
      await db('priorities').insert({
        priority_id: uuidv4(),
        tenant: tenantId,
        priority_name: priority.name,
        order_number: priority.order,
        color: priority.color,
        created_by: userId,
        created_at: new Date()
      });
    }
  }
}
