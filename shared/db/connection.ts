import Knex, { Knex as KnexType } from 'knex';

// Create a map to store Knex instances
const knexInstances: Map<string, KnexType> = new Map();

/**
 * Get database configuration
 */
function getDbConfig(): KnexType.Config {
  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_SERVER || 'app_user',
      password: process.env.DB_PASSWORD_SERVER
    },
    pool: {
      min: 0,
      max: 20,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
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
    const config = getDbConfig();
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
process.on('exit', async () => {
  await cleanupConnections();
});

// Cleanup connections on unhandled rejections and exceptions
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanupConnections();
  process.exit(1);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await cleanupConnections();
  process.exit(1);
});