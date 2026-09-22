/**
 * @alga-psa/db - Connection Management
 *
 * Database connection management utilities.
 */

import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

// Create a map to store Knex instances
const knexInstances: Map<string, KnexType> = new Map();
let initialization: Promise<KnexType> | undefined;
let cleanup: Promise<void> | undefined;

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
  // Callers arriving during cleanup must not receive a pool being destroyed.
  if (cleanup) {
    await cleanup;
    return getConnection();
  }
  const existing = knexInstances.get('default');
  if (existing) return existing;
  if (initialization) return initialization;

  const pending = (async () => {
    console.log('Creating new knex instance');
    const config = await getDbConfig();
    const instance = Knex(config);
    knexInstances.set('default', instance);
    return instance;
  })();
  initialization = pending;
  try { return await pending; }
  finally { if (initialization === pending) initialization = undefined; }
}

/** Cleanup also owns pools whose secret lookup has not finished yet. */
export async function cleanupConnections(): Promise<void> {
  if (cleanup) return cleanup;
  const pending = Promise.resolve().then(async () => {
    // Initialization failure belongs to its callers; there is no pool to close.
    await initialization?.catch(() => undefined);
    for (const [id, instance] of knexInstances) {
      // Teardown can fail after partially closing a pool; never hand it out again.
      knexInstances.delete(id);
      await instance.destroy();
    }
  });
  cleanup = pending;
  try { await pending; }
  finally { if (cleanup === pending) cleanup = undefined; }
}
