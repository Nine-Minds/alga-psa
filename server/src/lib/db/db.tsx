import Knex, { Knex as KnexType } from 'knex';
import { getKnexConfig } from './knexfile';
import { AsyncLocalStorage } from 'async_hooks';
import { validate as uuidValidate } from 'uuid';

interface PoolConfig extends KnexType.PoolConfig {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
}

// Create a map to store tenant-specific Knex instances
const knexInstances: Map<string, KnexType> = new Map();
const asyncLocalStorage = new AsyncLocalStorage<string>();


function isValidTenantId(tenantId: string | null | undefined): boolean {
  if (!tenantId) return true; // null/undefined is allowed
  if (tenantId === 'default') return true;
  return uuidValidate(tenantId);
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

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  const effectiveTenantId = tenantId || 'default';
  
  // Check if we already have an instance for this tenant
  let knexInstance = knexInstances.get(effectiveTenantId);
  
  if (!knexInstance) {
    console.log('Creating new knex instance for tenant', effectiveTenantId);
    const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
    const config = await getKnexConfig(environment);
    const poolConfig: PoolConfig = config.pool as PoolConfig || {};

    const finalConfig = {
      ...config,
      pool: {
        ...config.pool,
        afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
          const originalAfterCreate = poolConfig.afterCreate;
          
          const setupConnection = async () => {
            try {
              await setTenantContext(conn, tenantId);
              done(null, conn);
            } catch (err) {
              done(err as Error, conn);
            }
          };

          if (originalAfterCreate) {
            originalAfterCreate(conn, (err: Error | null) => {
              if (err) {
                done(err, conn);
              } else {
                setupConnection();
              }
            });
          } else {
            setupConnection();
          }
        },
      },
    };

    knexInstance = Knex(finalConfig);
    knexInstances.set(effectiveTenantId, knexInstance);
  }

  return knexInstance;
}

export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  const knex = await getConnection(tenantId);
  return knex.transaction(callback);
}

export async function destroyConnection(tenantId?: string): Promise<void> {
  if (tenantId) {
    // Destroy specific tenant connection
    const instance = knexInstances.get(tenantId);
    if (instance) {
      await instance.destroy();
      knexInstances.delete(tenantId);
    }
  } else {
    // Destroy all connections
    for (const [id, instance] of knexInstances) {
      await instance.destroy();
    }
    knexInstances.clear();
  }
}

export async function cleanupConnections(): Promise<void> {
  await destroyConnection();
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
