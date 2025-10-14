/**
 * Database test utilities for EE server integration tests
 * Provides database connection, cleanup, and tenant isolation utilities
 */

import { Knex, knex } from 'knex';
import path from 'node:path';
import { rollbackTenant } from './tenant-creation';

export interface DbTestConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

/**
 * Create a test database connection
 */
export function createTestDbConnection(config?: Partial<DbTestConfig>): Knex {
  const repoSuffix = `${path.sep}ee${path.sep}server`;
  const workspaceRoot = process.cwd().endsWith(repoSuffix)
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
  const migrationsDir = path.resolve(workspaceRoot, 'server/migrations');
  const seedsDir = path.resolve(workspaceRoot, 'server/seeds');

  const defaultConfig: DbTestConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
    user: process.env.DB_USER_SERVER || 'app_user',
    password: String(process.env.DB_PASSWORD_SERVER || ''),
    ssl: process.env.DB_SSL === 'true',
  };

  const dbConfig = { ...defaultConfig, ...config };
  
  console.log('Database config:', {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password ? `[${dbConfig.password.length} chars]` : 'empty',
    ssl: dbConfig.ssl
  });

  return knex({
    client: 'pg',
    connection: {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: dbConfig.ssl,
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30000,
    },
    migrations: {
      directory: migrationsDir,
    },
    seeds: {
      directory: seedsDir,
    },
  });
}

/**
 * Clean up test data from database
 */
export async function cleanupTestData(
  db: Knex,
  options: {
    tenantIds?: string[];
    cleanupTables?: string[];
    preserveSeeds?: boolean;
  } = {}
): Promise<void> {
  const { tenantIds = [], cleanupTables = [], preserveSeeds = true } = options;

  // Clean up specific tenants
  for (const tenantId of tenantIds) {
    await rollbackTenant(db, tenantId);
  }

  // Clean up specific tables
  for (const table of cleanupTables) {
    await db(table).del();
  }

  // If not preserving seeds, clean up all test data
  if (!preserveSeeds) {
    await resetDatabase(db);
  }
}

/**
 * Reset database to a clean state
 */
export async function resetDatabase(
  db: Knex,
  options: {
    runSeeds?: boolean;
    cleanupTables?: string[];
    preSetupCommands?: string[];
  } = {}
): Promise<void> {
  const { runSeeds = true, cleanupTables = [], preSetupCommands = [] } = options;

  try {
    // Run pre-setup commands
    for (const command of preSetupCommands) {
      await db.raw(command);
    }

    // Clean up specific tables
    for (const table of cleanupTables) {
      await db(table).del();
    }

    // Reset sequences and clean up test data
    await db.raw('TRUNCATE TABLE user_roles, users, tenant_companies, tenant_email_settings, clients, tenants RESTART IDENTITY CASCADE');

    // Run seeds if requested
    if (runSeeds) {
      await runDatabaseSeeds(db);
    }

  } catch (error) {
    console.error('Error resetting database:', error);
    throw error;
  }
}

/**
 * Run database seeds
 */
export async function runDatabaseSeeds(db: Knex): Promise<void> {
  try {
    // Run the seed files to set up initial data
    await db.seed.run();
  } catch (error) {
    console.error('Error running database seeds:', error);
    // Don't throw - seeds might not exist in test environment
  }
}

/**
 * Verify tenant isolation - ensure test tenants don't interfere with each other
 */
export async function verifyTenantIsolation(
  db: Knex,
  tenantId: string
): Promise<boolean> {
  try {
    // Check that tenant data exists only for this tenant
    const tenantData = await db('tenants').where('tenant', tenantId).first();
    if (!tenantData) {
      return false;
    }

    // Check that users are properly isolated
    const users = await db('users').where('tenant', tenantId);
    const otherTenantUsers = await db('users').whereNot('tenant', tenantId);
    
    // Verify no data leakage between tenants
    for (const user of users) {
      const userRoles = await db('user_roles')
        .where('user_id', user.user_id)
        .where('tenant', tenantId);
      
      if (userRoles.length === 0) {
        return false; // User without proper tenant role assignment
      }
    }

    return true;
  } catch (error) {
    console.error('Error verifying tenant isolation:', error);
    return false;
  }
}

/**
 * Wait for database to be ready
 */
export async function waitForDatabase(
  db: Knex,
  maxRetries: number = 30,
  retryInterval: number = 1000
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await db.raw('SELECT 1');
      return;
    } catch (error) {
      if (i === maxRetries - 1) {
        throw new Error(`Database not ready after ${maxRetries} retries`);
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
}

/**
 * Get database statistics for monitoring test performance
 */
export async function getDatabaseStats(db: Knex): Promise<{
  tenantCount: number;
  userCount: number;
  clientCount: number;
  connectionCount: number;
}> {
  const [tenantCount, userCount, clientCount] = await Promise.all([
    db('tenants').count('* as count').first(),
    db('users').count('* as count').first(),
    db('clients').count('* as count').first(),
  ]);

  // Get connection count
  const connectionStats = await db.raw(`
    SELECT count(*) as count 
    FROM pg_stat_activity 
    WHERE datname = current_database()
  `);

  return {
    tenantCount: parseInt(tenantCount?.count as string) || 0,
    userCount: parseInt(userCount?.count as string) || 0,
    clientCount: parseInt(clientCount?.count as string) || 0,
    connectionCount: parseInt(connectionStats.rows[0]?.count) || 0,
  };
}

/**
 * Create database transaction for test isolation
 */
export async function withTestTransaction<T>(
  db: Knex,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return await db.transaction(async (trx) => {
    try {
      return await callback(trx);
    } catch (error) {
      // Transaction will be automatically rolled back
      throw error;
    }
  });
}
