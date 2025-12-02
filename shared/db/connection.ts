import Knex, { Knex as KnexType } from 'knex';
import { getSecretProviderInstance } from '@alga-psa/shared/core';

// Create a map to store Knex instances
const knexInstances: Map<string, KnexType> = new Map();

/**
 * Get database configuration
 */
async function getDbConfig(): Promise<KnexType.Config> {
  // Get password from secret provider with fallback to environment variable
  const secretProvider = await getSecretProviderInstance();
  const password = await secretProvider.getAppSecret('DB_PASSWORD_SERVER') || process.env.DB_PASSWORD_SERVER;

  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_SERVER || 'app_user',
      password: password
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 3000, // REDUCED from 30s to 3s - fail fast instead of hanging
      acquireTimeoutMillis: 5000, // Max 5s to acquire connection from pool
      destroyTimeoutMillis: 5000
    }
  };
}

/**
 * Get a database connection
 */
export async function getConnection(): Promise<KnexType> {
  const instanceKey = 'default';
  
  // Check if we already have an instance
  let knexInstance = knexInstances.get(instanceKey);
  
  if (!knexInstance) {
    console.log('Creating new knex instance');
    const config = await getDbConfig();
    knexInstance = Knex(config);
    knexInstances.set(instanceKey, knexInstance);
  }

  return knexInstance;
}

/**
 * Cleanup all database connections
 */
export async function cleanupConnections(): Promise<void> {
  for (const [id, instance] of knexInstances) {
    await instance.destroy();
  }
  knexInstances.clear();
}

// Cleanup connections on process exit
// process.on('exit', async () => {
//   await cleanupConnections();
// });

// Cleanup connections on unhandled rejections and exceptions
// process.on('unhandledRejection', async (reason, promise) => {
//   console.error('Unhandled Rejection at:', promise, 'reason:', reason);
//   await cleanupConnections();
// });

// process.on('uncaughtException', async (error) => {
//   console.error('Uncaught Exception:', error);
//   await cleanupConnections();
// });
