import knex, { Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestDatabase } from './dbConfig';
import { getSecret } from '../src/lib/utils/getSecret';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
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
    const clientConfig = db.client.config;
    const originalConnection = clientConfig.connection;

    if (!originalConnection || typeof originalConnection === 'string') {
      throw new Error('Expected object connection configuration for test database');
    }

    const connectionConfig = { ...originalConnection } as Record<string, any>;
    const targetDatabase = connectionConfig.database as string | undefined;

    if (!targetDatabase) {
      throw new Error('Test database connection must specify a database name');
    }

    if (!connectionConfig.password) {
      const candidatePassword = (clientConfig.connection as Record<string, any> | undefined)?.password;
      connectionConfig.password = candidatePassword ?? adminPassword;
    }

    verifyTestDatabase(targetDatabase);

    const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'test_password');

    const adminDb = knex({
      client: clientConfig.client,
      asyncStackTraces: true,
      connection: {
        ...connectionConfig,
        database: 'postgres',
        password: adminPassword,
      },
      pool: {
        min: 1,
        max: 2,
      },
    });

    const safeDatabaseName = targetDatabase.replace(/"/g, '""');

    try {
      // Tear down any existing connections from the main pool before recycling the database
      await db.destroy().catch(() => undefined);

      // Terminate lingering sessions that might block DROP DATABASE
      await adminDb.raw(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = ?
           AND pid <> pg_backend_pid()
           AND state <> 'terminated'`,
        [targetDatabase]
      );

      await adminDb.raw(`DROP DATABASE IF EXISTS "${safeDatabaseName}"`);
      await adminDb.raw(`CREATE DATABASE "${safeDatabaseName}"`);
    } finally {
      await adminDb.destroy();
    }

    const refreshedDb = knex({
      ...clientConfig,
      asyncStackTraces: true,
      connection: connectionConfig,
      migrations: {
        directory: path.join(serverRoot, 'migrations'),
      },
      seeds: {
        directory: path.join(serverRoot, 'seeds', 'dev'),
      },
    });

    try {
      for (const command of preSetupCommands) {
        await refreshedDb.raw(command);
      }

      await refreshedDb.migrate.latest();

      if (runSeeds) {
        await refreshedDb.seed.run();
      }

      for (const command of postSetupCommands) {
        await refreshedDb.raw(command);
      }
    } finally {
      await refreshedDb.destroy().catch(() => undefined);
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
