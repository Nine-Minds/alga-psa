import Knex, { Knex as KnexType } from 'knex';
import { getKnexConfig } from './knexfile';
import { AsyncLocalStorage } from 'async_hooks';

interface PoolConfig extends KnexType.PoolConfig {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
}


function isValidTenantId(tenantId: string | null | undefined): boolean {
  if (!tenantId) return true; // null/undefined is allowed
  if (tenantId === 'default') return true;
  return /^[0-9a-f-]+$/i.test(tenantId);
}

async function setTenantContext(conn: any, tenantId?: string | null): Promise<void> {
  if (!isValidTenantId(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }

  if (tenantId) {
    await new Promise<void>((resolve, reject) => {
      conn.query(`SET app.current_tenant = '${tenantId}'`, [], (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      resolve();
    });
  }
}
// --- Refactored Code for Tenant-Scoped Pooling ---

// Cache for tenant-specific Knex instances
const tenantKnexInstances = new Map<string, KnexType>();

/**
 * Gets or creates a Knex instance specifically for the given tenant ID.
 * Each instance manages its own connection pool.
 */
export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  const effectiveTenantId = tenantId || 'default'; // Use 'default' for null/undefined tenant

  // Check cache first
  if (tenantKnexInstances.has(effectiveTenantId)) {
    // console.log(`Returning cached Knex instance for tenant: ${effectiveTenantId}`);
    return tenantKnexInstances.get(effectiveTenantId)!;
  }

  // If not cached, create a new instance for this tenant
  console.log(`Creating new Knex instance and pool for tenant: ${effectiveTenantId}`);
  const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
  const baseConfig = await getKnexConfig(environment); // Get base config

  const tenantConfig: KnexType.Config = {
    ...baseConfig,
    pool: {
      ...baseConfig.pool,
      // afterCreate hook specific to this tenant's pool
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        console.log(`Connection created in pool for tenant: ${effectiveTenantId}`);
        // Set tenant context for every connection created in THIS pool
        setTenantContext(conn, effectiveTenantId === 'default' ? null : effectiveTenantId)
          .then(() => {
             console.log(`Tenant context set to '${effectiveTenantId}' for new connection.`);
             conn.on('error', (err: Error) => {
               console.error(`DB Connection Error (Tenant: ${effectiveTenantId}):`, err);
               // Optional: Attempt to remove the connection? Knex might handle this.
             });
             done(null, conn);
          })
          .catch((err) => {
            console.error(`Failed to set tenant context for ${effectiveTenantId}:`, err);
            done(err, conn); // Pass error to pool creation
          });
      }
    }
  };

  const newKnexInstance = Knex(tenantConfig);
  tenantKnexInstances.set(effectiveTenantId, newKnexInstance);
  console.log(`Knex instance created and cached for tenant: ${effectiveTenantId}`);
  return newKnexInstance;
}

// --- End Refactored Code ---

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
  // Get the tenant-specific Knex instance
  const knex = await getConnection(tenantId);
  // The afterCreate hook for this instance's pool already sets the context,
  // so we don't need to set it explicitly within the transaction block itself.
  return knex.transaction(callback);
}

// --- Refactored Code ---
// Remove deprecated functions and process handlers, Knex manages the shared pool lifecycle.

// --- Refactored Code ---
// Graceful shutdown handler for ALL tenant pools
async function destroyAllPools() {
  console.log('Destroying all tenant Knex pools...');
  const destroyPromises = Array.from(tenantKnexInstances.values()).map(instance => instance.destroy());
  await Promise.allSettled(destroyPromises);
  console.log('All tenant Knex pools destroyed.');
  tenantKnexInstances.clear();
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received.');
  await destroyAllPools();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received.');
  await destroyAllPools();
  process.exit(0);
});
// --- End Refactored Code ---
