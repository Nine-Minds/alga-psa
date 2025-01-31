import Knex, { Knex as KnexType } from 'knex';
import { getKnexConfig } from './knexfile';

const knexInstances: { [key: string]: KnexType } = {};

interface PoolConfig extends KnexType.PoolConfig {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
}

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  // For non-tenant connections, create a new instance each time
  if (!tenantId) {
    const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
    const config = await getKnexConfig(environment);
    return Knex(config);
  }

  // For tenant connections, use cached instance if available
  if (knexInstances[tenantId]) {
    return knexInstances[tenantId];
  }

  // Create new tenant connection
  const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
  const config = await getKnexConfig(environment);
  const poolConfig: PoolConfig = config.pool as PoolConfig || {};

  const tenantConfig = {
    ...config,
    pool: {
      ...config.pool,
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        const originalAfterCreate = poolConfig.afterCreate;
        
        const setTenant = () => {
          conn.query(`SET app.current_tenant = '${tenantId}'`, (err: Error | null) => {
            done(err, conn);
          });
        };

        if (originalAfterCreate) {
          originalAfterCreate(conn, (err: Error | null) => {
            if (err) {
              done(err, conn);                
            } else {
              setTenant();
            }
          });
        } else {
          setTenant();
        }
      },
    },
  };

  // Cache the new instance
  knexInstances[tenantId] = Knex(tenantConfig);
  return knexInstances[tenantId];
}

export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  const knex = await getConnection(tenantId);
  return knex.transaction(callback);
}

export async function destroyConnection(tenantId?: string): Promise<void> {
  if (tenantId && knexInstances[tenantId]) {
    await knexInstances[tenantId].destroy();
    delete knexInstances[tenantId];
  } else if (!tenantId) {
    await Promise.all(Object.values(knexInstances).map((instance): Promise<void> => instance.destroy()));
    Object.keys(knexInstances).forEach(key => delete knexInstances[key]);
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
