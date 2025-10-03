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
  const dbName = process.env.DB_NAME_SERVER || 'sebastian_test';
  verifyTestDatabase(dbName);

  const baseConnection = await buildBaseConnectionConfig();
  await ensureTestDatabaseExists(dbName, baseConnection);

  return knex({
    client: 'pg',
    connection: {
      ...baseConnection,
      database: dbName
    },
    asyncStackTraces: true,
    pool: {
      min: 2,
      max: 20
    },
    migrations: {
      directory: path.join(serverRoot, 'migrations')
    },
    seeds: {
      directory: path.join(serverRoot, 'seeds', 'dev')
    }
  });
}

async function buildBaseConnectionConfig(): Promise<Knex.StaticConnectionConfig> {
  const directHost = process.env.DB_DIRECT_HOST || process.env.DB_HOST || 'localhost';
  const directPort = Number(process.env.DB_DIRECT_PORT || 5432);

  return {
    host: directHost,
    port: directPort,
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'test_password')
  };
}

async function ensureTestDatabaseExists(
  databaseName: string,
  baseConnection: Knex.StaticConnectionConfig
): Promise<void> {
  const adminDb = knex({
    client: 'pg',
    connection: {
      ...baseConnection,
      database: 'postgres'
    },
    pool: {
      min: 1,
      max: 2
    }
  });

  try {
    const { rows } = await adminDb.raw('SELECT 1 FROM pg_database WHERE datname = ?', [databaseName]);
    if (!rows?.length) {
      const safeDbName = databaseName.replace(/"/g, '""');
      await adminDb.raw(`CREATE DATABASE "${safeDbName}"`);
    }
  } catch (error) {
    if (!/already exists/i.test(String(error))) {
      throw error;
    }
  } finally {
    await adminDb.destroy().catch(() => undefined);
  }
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
