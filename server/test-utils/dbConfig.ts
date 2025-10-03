import { Knex, knex } from 'knex';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSecret } from '../src/lib/utils/getSecret';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const PRODUCTION_DB_NAMES = ['sebastian_prod', 'production', 'prod'];

/**
 * Verifies that the database name is safe for testing
 * @param dbName Database name to check
 * @throws Error if database name matches known production names
 */
export function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error('Attempting to use production database for testing');
  }
}

/**
 * Creates a database connection for testing purposes
 * @returns Knex instance configured for testing
 */
export async function createTestDbConnection(): Promise<Knex> {
  const dbName = 'sebastian_test';
  verifyTestDatabase(dbName);

  // Always use port 5432 for tests to connect directly to PostgreSQL
  // This bypasses pgbouncer which may be on port 6432 in the .env file
  const testPort = 5432;

  const password = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'test_password');

  // First, connect to postgres database to check if test database exists
  const adminConfig: Knex.Config = {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: testPort,
      user: process.env.DB_USER_ADMIN || 'postgres',
      password,
      database: 'postgres',
    },
  };

  const adminDb = knex(adminConfig);

  try {
    // Check if test database exists
    const { rows } = await adminDb.raw(
      `SELECT 1 FROM pg_database WHERE datname = ?`,
      [dbName]
    );

    // Create database if it doesn't exist
    if (rows.length === 0) {
      console.log(`Creating test database: ${dbName}`);
      await adminDb.raw(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await adminDb.destroy();
  }

  // Now connect to the test database
  const config: Knex.Config = {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: testPort,
      user: process.env.DB_USER_ADMIN || 'postgres',
      password,
      database: dbName,
    },
    asyncStackTraces: true,
    pool: {
      min: 2,
      max: 20,
    },
    migrations: {
      directory: path.join(serverRoot, 'migrations'),
    },
    seeds: {
      directory: path.join(serverRoot, 'seeds', 'dev'),
    },
  };

  console.log(config);

  return knex(config);
}

/**
 * Creates a database connection with tenant context for testing
 * @param tenant Tenant ID to set in session
 * @returns Knex instance configured with tenant context
 */
export async function createTestDbConnectionWithTenant(tenant: string): Promise<Knex> {
  const db = await createTestDbConnection();

  // With CitusDB, tenant isolation is handled automatically at the shard level
  // No need to set app.current_tenant session variable
  // The tenant should be included in all WHERE clauses as per CitusDB requirements
  
  return db;
}

/**
 * Validates UUID format of tenant ID
 * @param tenantId Tenant ID to validate
 * @returns boolean indicating if ID is valid
 */
export function isValidTenantId(tenantId: string): boolean {
  if (!tenantId) return true;
  if (tenantId === 'default') return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId);
}
