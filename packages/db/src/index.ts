/**
 * @alga-psa/db
 *
 * Database infrastructure module for Alga PSA.
 * Contains Knex configuration, tenant context management, and database utilities.
 */

// Knex Configuration
export {
  getKnexConfig,
  getFullConfig,
  getKnexConfigWithTenant,
  getPostgresConnection
} from './lib/knexfile';
export type { CustomKnexConfig } from './lib/knexfile';
export { default as knexConfig } from './lib/knexfile';

// Knex Turbopack Shim (patched knex for turbopack compatibility)
export { default as Knex } from './lib/knex-turbopack';

// Admin Connection
export { getAdminConnection, destroyAdminConnection } from './lib/admin';

// Tenant Connection
export {
  getConnection,
  withTransaction,
  createTenantKnex,
  runWithTenant,
  getTenantContext,
  setTenantContext,
  resetTenantConnectionPool
} from './lib/tenant';
export { resolveTenantId, requireTenantId } from './lib/tenantId';

// Audit logging
export { auditLog } from './lib/auditLog';
export * from './lib/workDate';

// DB models (tenant-scoped data access patterns)
export * from './models';

// Service infrastructure
export * from './services/BaseService';
export * from './services/SystemContext';

// Connection Management
export {
  getConnection as getDbConnection,
  cleanupConnections
} from './lib/connection';

// Transaction Helpers
import { Knex as KnexType } from 'knex';
import { getAdminConnection } from './lib/admin';

/**
 * Execute a function within a transaction
 */
export async function withKnexTransaction<T>(
  knex: KnexType,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  return await knex.transaction(callback);
}

/**
 * Execute a function within an admin database transaction
 */
export async function withAdminTransaction<T>(
  callback: (trx: KnexType.Transaction) => Promise<T>,
  existingConnection?: KnexType | KnexType.Transaction
): Promise<T> {
  const transactionId = Math.random().toString(36).substring(7);
  console.log(`[withAdminTransaction:${transactionId}] Starting transaction wrapper`);

  try {
    // If we already have a transaction, use it directly
    if (existingConnection && 'commit' in existingConnection && 'rollback' in existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Using existing transaction`);
      const result = await callback(existingConnection as KnexType.Transaction);
      console.log(`[withAdminTransaction:${transactionId}] Existing transaction callback completed successfully`);
      return result;
    }

    // If we have a connection but not a transaction, create one
    if (existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Creating transaction on existing connection`);
      const result = await existingConnection.transaction(callback);
      console.log(`[withAdminTransaction:${transactionId}] New transaction on existing connection completed successfully`);
      return result;
    }

    // Otherwise, get admin connection and create transaction
    console.log(`[withAdminTransaction:${transactionId}] Getting admin connection for new transaction`);
    const adminDb = await getAdminConnection();

    const result = await adminDb.transaction(callback);
    return result;
  } catch (error) {
    console.error(`[withAdminTransaction:${transactionId}] Transaction failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// Re-export Knex types (for consumers that need type-only imports)
export type { Knex as KnexInstance } from 'knex';
