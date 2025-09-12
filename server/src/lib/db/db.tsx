import Knex, { Knex as KnexType } from './knex-turbopack';
import { getKnexConfig } from './knexfile';
import { AsyncLocalStorage } from 'async_hooks';
import logger from '@alga-psa/shared/core/logger';

interface PoolConfig extends KnexType.PoolConfig {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
}


function isValidTenantId(tenantId: string | null | undefined): boolean {
  if (!tenantId) return true; // null/undefined is allowed
  if (tenantId === 'default') return true;
  return /^[0-9a-f-]+$/i.test(tenantId);
}

// No longer needed with CitusDB - tenant isolation is handled at the shard level
async function setTenantContext(conn: any, tenantId?: string | null): Promise<void> {
  // CitusDB provides tenant-level restrictions automatically
  // No need to set app.current_tenant session variable
  return Promise.resolve();
}
// --- Simplified Connection Architecture for CitusDB ---

// Single shared Knex instance - CitusDB handles tenant isolation at shard level
let sharedKnexInstance: KnexType | null = null;

/**
 * Gets a shared Knex instance optimized for CitusDB transaction-level pooling.
 * Since CitusDB handles tenant isolation automatically, we can use a single shared pool.
 */
export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  // Tenant ID is kept for compatibility but not used for connection pooling

  // Check if we already have a shared instance
  if (sharedKnexInstance) {
    return sharedKnexInstance;
  }

  // Create a single shared instance optimized for transaction-level pooling
  const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
  const baseConfig = await getKnexConfig(environment);

  const sharedConfig: KnexType.Config = {
    ...baseConfig,
    pool: {
      ...baseConfig.pool,
      // Optimize for transaction-level pooling
      min: 0, // Allow connections to be freed when not in use
      max: 50, // Higher max since we're sharing across all tenants
      idleTimeoutMillis: 30000, // Allow longer idle times for transaction pooling
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        conn.on('error', (err: Error) => {
          logger.error('DB Connection Error:', err);
        });
        done(null, conn);
      }
    }
  };

  sharedKnexInstance = Knex(sharedConfig);
  return sharedKnexInstance;
}

// --- End Simplified Architecture ---

// Keep setTenantContext for explicit use when needed outside runWithTenant
// (though runWithTenant should be preferred)
export { setTenantContext };

// --- End Refactored Code ---

// Original getConnection function is replaced by getSharedKnex
// export async function getConnection(tenantId?: string | null): Promise<KnexType> { ... }

export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  // Get the shared Knex instance
  const knex = await getConnection(tenantId);
  // With CitusDB, tenant isolation is handled automatically at the shard level
  // All queries must include tenant in WHERE clauses for CitusDB compatibility
  return knex.transaction(callback);
}

// --- Simplified Cleanup for Shared Pool ---
async function destroySharedPool() {
  if (sharedKnexInstance) {
    await sharedKnexInstance.destroy();
    sharedKnexInstance = null;
  }
}

process.on('SIGTERM', async () => {
  await destroySharedPool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await destroySharedPool();
  process.exit(0);
});
// --- End Simplified Architecture ---
