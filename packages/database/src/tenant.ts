/**
 * Tenant-aware database connection management.
 *
 * This module provides connection pooling with multi-tenant support.
 * In Alga PSA, tenants share a database but are isolated via row-level security
 * or application-level filtering.
 */

import Knex, { Knex as KnexType } from 'knex';
import type { PoolConfig } from './types/index.js';

let sharedKnexInstance: KnexType | null = null;

/**
 * Get database configuration from environment
 */
async function getDbConfig(): Promise<KnexType.Config> {
  // In the full implementation, this would use the secret provider
  // For now, we read directly from environment
  const password = process.env.DB_PASSWORD_SERVER;

  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_SERVER || 'app_user',
      password,
    },
    pool: {
      min: 0,
      max: 50,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
    },
  };
}

/**
 * Get a database connection, optionally for a specific tenant.
 *
 * @param tenantId - Optional tenant identifier (currently unused but reserved for future RLS)
 * @returns A Knex instance connected to the database
 */
export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  if (sharedKnexInstance) {
    return sharedKnexInstance;
  }

  const baseConfig = await getDbConfig();

  const poolConfig: PoolConfig = {
    ...(baseConfig.pool as PoolConfig),
    min: 0,
    max: 50,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    afterCreate: (conn: unknown, done: (err: Error | null, connection: unknown) => void) => {
      // Handle connection errors
      if (conn && typeof conn === 'object' && 'on' in conn) {
        (conn as { on: (event: string, handler: (err: Error) => void) => void }).on(
          'error',
          (err: Error) => {
            console.error('[database/tenant] DB Connection Error:', err);
          }
        );
      }
      done(null, conn);
    },
  };

  sharedKnexInstance = Knex({
    ...baseConfig,
    pool: poolConfig,
  });

  return sharedKnexInstance;
}

/**
 * Execute a callback within a database transaction.
 *
 * @param tenantId - Tenant identifier for the transaction context
 * @param callback - Function to execute within the transaction
 * @returns The result of the callback
 */
export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  const knex = await getConnection(tenantId);
  return knex.transaction(callback);
}

/**
 * Set tenant context on a connection (placeholder for RLS implementation).
 *
 * @param conn - Database connection
 * @param tenantId - Tenant identifier
 */
export async function setTenantContext(
  _conn: unknown,
  _tenantId?: string | null
): Promise<void> {
  // Placeholder for future row-level security implementation
  return Promise.resolve();
}

/**
 * Destroy the shared connection pool and reset state.
 * Use this during testing or graceful shutdown.
 */
async function destroySharedPool(): Promise<void> {
  if (sharedKnexInstance) {
    await sharedKnexInstance.destroy();
    sharedKnexInstance = null;
  }
}

/**
 * Reset the tenant connection pool.
 * This destroys all connections and allows fresh connections to be created.
 */
export async function resetTenantConnectionPool(): Promise<void> {
  await destroySharedPool();
}
