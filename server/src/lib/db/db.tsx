import Knex, { Knex as KnexType } from 'knex';
import knexfile from './knexfile';


const knexInstances: { [key: string]: KnexType } = {};

interface PoolConfig extends KnexType.PoolConfig {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
}

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  if (!tenantId || !knexInstances[tenantId]) {
    const environment = process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development');
    const environmentConfig = knexfile[environment as keyof typeof knexfile];

    if (!environmentConfig) {
      throw new Error(`Invalid environment: ${environment}`);
    }

    const poolConfig: PoolConfig = environmentConfig.pool as PoolConfig || {};

    const tenantConfig = {
      ...environmentConfig,
      pool: {
        ...environmentConfig.pool,
        afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
          const originalAfterCreate = poolConfig.afterCreate;
          
          const setTenant = () => {
            if (tenantId) {              
              conn.query(`SET app.current_tenant = '${tenantId}'`, (err: Error | null) => {
                done(err, conn);
              });
            }
            else {
              done(null, conn);
            }
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

    if (!tenantId) {
      return Knex(tenantConfig);
    }

    knexInstances[tenantId] = Knex(tenantConfig);
  }

  return knexInstances[tenantId];
}

export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  const knex = getConnection(tenantId);
  return (await knex).transaction(callback);
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
