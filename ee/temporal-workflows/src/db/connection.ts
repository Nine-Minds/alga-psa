import { Pool, PoolClient } from 'pg';

// Database configuration for connecting to the main application database
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// Get database configuration from environment variables (Alga format)
function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'pgbouncer',
    port: parseInt(process.env.DB_PORT || '6432'),
    database: process.env.DB_NAME_SERVER || 'server',
    user: process.env.DB_USER_SERVER || 'postgres',
    password: process.env.DB_PASSWORD_SERVER || 'postpass123',
  };
}

// Main application database pool
let mainDbPool: Pool | null = null;

export function getMainDatabase(): Pool {
  if (!mainDbPool) {
    const config = getDatabaseConfig();
    mainDbPool = new Pool(config);
  }
  return mainDbPool;
}

// Admin database pool (for administrative operations)
let adminDbPool: Pool | null = null;

export function getAdminDatabase(): Pool {
  if (!adminDbPool) {
    const config = getDatabaseConfig();
    // Use admin credentials if available (from Alga .env)
    const adminConfig = {
      ...config,
      user: process.env.DB_USER_ADMIN || config.user,
      password: process.env.DB_PASSWORD_ADMIN || config.password,
    };
    adminDbPool = new Pool(adminConfig);
  }
  return adminDbPool;
}

// Helper function to execute queries with proper error handling
export async function executeQuery<T = any>(
  pool: Pool,
  query: string,
  params: any[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Helper function to execute queries within a transaction
export async function executeTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Cleanup function for tests
export async function closeDatabaseConnections(): Promise<void> {
  const promises = [];
  if (mainDbPool) {
    promises.push(mainDbPool.end());
    mainDbPool = null;
  }
  if (adminDbPool) {
    promises.push(adminDbPool.end());
    adminDbPool = null;
  }
  await Promise.all(promises);
}

// Test database connection
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const pool = getMainDatabase();
    const result = await executeQuery(pool, 'SELECT 1 as test');
    return result.length > 0 && result[0].test === 1;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}