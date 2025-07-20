import { Pool, PoolClient } from 'pg';
import { getSecretProviderInstance } from '../../../../shared/core/index.js';

// Database configuration for connecting to the main application database
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// Get database configuration from environment variables (Alga PSA format)
async function getDatabaseConfig(): Promise<DatabaseConfig> {
  // Get password from secret provider with fallback to environment variables
  const secretProvider = getSecretProviderInstance();
  const password = await secretProvider.getAppSecret('DB_PASSWORD_SERVER') || 
                   process.env.ALGA_DB_PASSWORD || 
                   process.env.DB_PASSWORD_SERVER || 
                   '';

  return {
    host: process.env.ALGA_DB_HOST || process.env.DB_HOST || 'pgvector.stackgres-pgvector.svc.cluster.local',
    port: parseInt(process.env.ALGA_DB_PORT || process.env.DB_PORT || '5432'),
    database: process.env.ALGA_DB_NAME || process.env.DB_NAME_SERVER || 'server',
    user: process.env.ALGA_DB_USER || process.env.DB_USER_SERVER || 'app_user',
    password: password,
  };
}

// Main application database pool
let mainDbPool: Pool | null = null;

export async function getMainDatabase(): Promise<Pool> {
  if (!mainDbPool) {
    const config = await getDatabaseConfig();
    mainDbPool = new Pool(config);
  }
  return mainDbPool;
}

// Admin database pool (for administrative operations)
let adminDbPool: Pool | null = null;

export async function getAdminDatabase(): Promise<Pool> {
  if (!adminDbPool) {
    const config = await getDatabaseConfig();
    
    // Get admin password from secret provider with fallbacks
    const secretProvider = getSecretProviderInstance();
    const adminPassword = await secretProvider.getAppSecret('DB_PASSWORD_ADMIN') || 
                         process.env.ALGA_DB_ADMIN_PASSWORD || 
                         process.env.DB_PASSWORD_ADMIN || 
                         config.password;
    
    // Use admin credentials if available (Alga PSA admin)
    const adminConfig = {
      ...config,
      user: process.env.ALGA_DB_ADMIN_USER || process.env.DB_USER_ADMIN || 'postgres',
      password: adminPassword,
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
    const pool = await getMainDatabase();
    const result = await executeQuery(pool, 'SELECT 1 as test');
    return result.length > 0 && result[0].test === 1;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}