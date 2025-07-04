import { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestEnvironment } from '../../../../test-utils/testDataFactory';
import { createTestApiKey, ApiTestClient } from './apiTestHelpers';
import { cleanupTestContacts } from './contactTestDataFactory';
import { setupTestUserWithPermissions } from './simpleRoleSetup';

/**
 * E2E test environment containing all necessary test data and utilities
 */
export interface E2ETestEnvironment {
  db: Knex;
  tenant: string;
  companyId: string;
  locationId: string;
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
  companyName?: string;
  userName?: string;
} = {}): Promise<E2ETestEnvironment> {
  const db = await createTestDbConnection();
  
  try {
    // Create test environment with tenant, company, location and user
    const { tenantId, companyId, locationId, userId } = await createTestEnvironment(db, {
      companyName: options.companyName,
      userName: options.userName
    });

    // Setup permissions for the test user
    await setupTestUserWithPermissions(db, userId, tenantId);

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
        await cleanupTestContacts(db, tenantId);
        
        // Clean up API keys
        await db('api_keys')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up users
        await db('users')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up company locations
        await db('company_locations')
          .where('tenant', tenantId)
          .delete();
        
        // Clean up companies
        await db('companies')
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
      companyId,
      locationId,
      userId,
      apiKey: apiKeyRecord.api_key,
      apiClient,
      cleanup
    };
  } catch (error) {
    // If setup fails, clean up the database connection
    await db.destroy();
    throw error;
  }
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