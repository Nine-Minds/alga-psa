import knex, { Knex } from 'knex';
import { verifyTestDatabase } from './dbConfig';
import { getSecret } from '../src/lib/utils/getSecret.js';
/**
 * Options for database reset
 */
export interface DbResetOptions {
  /**
   * Tables to clean up after reset (will be deleted in order)
   * Useful for tables that aren't dropped by schema reset
   */
  cleanupTables?: string[];
  
  /**
   * Whether to run seeds after migrations
   * @default true
   */
  runSeeds?: boolean;

  /**
   * Custom SQL commands to run after schema reset but before migrations
   * Useful for setting up test-specific database state
   */
  preSetupCommands?: string[];

  /**
   * Custom SQL commands to run after migrations and seeds
   * Useful for additional test setup
   */
  postSetupCommands?: string[];
}

/**
 * Resets the database to a clean state
 * @param db Knex database instance
 * @param options Reset options
 */
export async function resetDatabase(
  db: Knex,
  options: DbResetOptions = {}
): Promise<void> {
  const {
    cleanupTables = [],
    runSeeds = true,
    preSetupCommands = [],
    postSetupCommands = []
  } = options;

  try {
    // Get current database name and verify it's safe to reset
    const { rows: [{ current_database }] } = await db.raw('SELECT current_database()');
    
    // Import verification function from dbConfig
    verifyTestDatabase(current_database);
    
    // Close existing connections more aggressively
    await db.raw(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity 
      WHERE datname = ?
      AND pid <> pg_backend_pid()
      AND state <> 'terminated'
    `, [current_database]);

    // Add a small delay to ensure connections are fully terminated
    await new Promise(resolve => setTimeout(resolve, 100));

    // First destroy the main connection
    await db.destroy();

    const config = {
      client: db.client.config.client,
      asyncStackTraces: true,
      connection: {
        ...db.client.config.connection,
        database: 'postgres',
        password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'test_password'),
      }
    };

    // Create admin connection
    const adminDb = knex(config);

    try {
      // Drop and recreate database from postgres connection
      await adminDb.raw(`DROP DATABASE IF EXISTS ${current_database}`);
      await adminDb.raw(`CREATE DATABASE ${current_database}`);
    } finally {
      // Clean up admin connection
      await adminDb.destroy();
    }

    // Reinitialize the main connection
    await db.initialize();

    // Run any pre-setup commands
    for (const command of preSetupCommands) {
      await db.raw(command);
    }

    // Run migrations
    await db.migrate.latest();

    // Run seeds if enabled
    if (runSeeds) {
      await db.seed.run();
    }

    // Run any post-setup commands
    for (const command of postSetupCommands) {
      await db.raw(command);
    }

    // Clean up specified tables
    // for (const table of cleanupTables) {
    //   await db(table).del();
    // }
  } catch (error) {
    console.error('Error resetting database:', error);
    throw error;
  }
}

/**
 * Cleans up specific tables in reverse order
 * Useful for cleaning up related tables with foreign key constraints
 * @param db Knex database instance
 * @param tables Tables to clean up (will be processed in reverse order)
 * @param options Options for cleanup
 */
export async function cleanupTables(
  db: Knex,
  tables: string[],
  options: {
    /**
     * Whether to ignore errors during cleanup
     * @default false
     */
    ignoreErrors?: boolean;
  } = {}
): Promise<void> {
  const { ignoreErrors = false } = options;

  // Process tables in reverse order to handle foreign key dependencies
  for (const table of [...tables].reverse()) {
    try {
      await db(table).del();
    } catch (error) {
      if (!ignoreErrors) {
        throw error;
      }
      console.warn(`Warning: Failed to clean up table ${table}:`, error);
    }
  }
}

/**
 * Creates a transaction-safe database reset function
 * Useful for tests that need to reset the database within a transaction
 * @param db Knex database instance
 * @returns Function that resets the database within the current transaction
 */
export function createTransactionSafeReset(db: Knex) {
  return async function resetDatabaseInTransaction(options: DbResetOptions = {}) {
    // Save current transaction level
    const { rows: [{ level }] } = await db.raw('SELECT current_setting(\'transaction_isolation\') as level');

    try {
      // Set transaction level to SERIALIZABLE for safety
      await db.raw('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await resetDatabase(db, options);
    } finally {
      // Restore original transaction level
      await db.raw(`SET TRANSACTION ISOLATION LEVEL ${level}`);
    }
  };
}

/**
 * Helper to create a common cleanup function for beforeEach/afterEach hooks
 * @param db Knex database instance
 * @param tables Tables to clean up
 * @returns Function suitable for test cleanup hooks
 */
export function createCleanupHook(db: Knex, tables: string[]) {
  return async () => {
    await cleanupTables(db, tables, { ignoreErrors: true });
  };
}
