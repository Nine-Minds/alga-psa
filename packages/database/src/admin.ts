/**
 * Admin database connection management.
 *
 * This module provides privileged database access for administrative operations
 * like migrations, schema changes, and tenant provisioning.
 */

import Knex, { Knex as KnexType } from 'knex';

let adminConnection: KnexType | null = null;

/**
 * Get admin database configuration from environment
 */
function getAdminConfig(): KnexType.Config {
  // Admin connections use a separate user with elevated privileges
  const dbPassword = process.env.DB_PASSWORD_ADMIN;

  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: dbPassword,
      database: process.env.DB_NAME_SERVER || 'server',
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '1', 10),
      max: parseInt(process.env.DB_POOL_MAX || '5', 10),
      acquireTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '10000', 10),
      createTimeoutMillis: parseInt(process.env.DB_POOL_CREATE_TIMEOUT || '10000', 10),
    },
  };
}

/**
 * Get or create an admin database connection.
 *
 * The admin connection is cached and reused. If the connection
 * becomes invalid, it will be automatically recreated.
 *
 * @returns A Knex instance with admin privileges
 */
export async function getAdminConnection(): Promise<KnexType> {
  // Return existing connection if available and valid
  if (adminConnection) {
    try {
      await adminConnection.raw('SELECT 1');
      return adminConnection;
    } catch {
      // Connection is invalid, will be recreated below
      adminConnection = null;
    }
  }

  const config = getAdminConfig();
  adminConnection = Knex(config);

  // Verify the connection works
  try {
    await adminConnection.raw('SELECT 1');
  } catch (error) {
    throw error;
  }

  return adminConnection;
}

/**
 * Destroy the admin database connection.
 * Use this during graceful shutdown.
 */
export async function destroyAdminConnection(): Promise<void> {
  if (adminConnection) {
    await adminConnection.destroy();
    adminConnection = null;
  }
}

/**
 * Execute a callback within an admin database transaction.
 *
 * This helper ensures admin operations are properly wrapped in transactions
 * for atomicity and rollback capability.
 *
 * @param callback - Function to execute within the transaction
 * @param existingConnection - Optional existing connection or transaction to reuse
 * @returns The result of the callback
 */
export async function withAdminTransaction<T>(
  callback: (trx: KnexType.Transaction) => Promise<T>,
  existingConnection?: KnexType | KnexType.Transaction
): Promise<T> {
  try {
    // If we already have a transaction, use it directly
    if (
      existingConnection &&
      'commit' in existingConnection &&
      'rollback' in existingConnection
    ) {
      return await callback(existingConnection as KnexType.Transaction);
    }

    // If we have a connection but not a transaction, create one
    if (existingConnection) {
      return await existingConnection.transaction(callback);
    }

    // Otherwise, get admin connection and create transaction
    const adminDb = await getAdminConnection();
    return await adminDb.transaction(callback);
  } catch (error) {
    console.error('[database/admin] Transaction failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
