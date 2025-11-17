import Knex, { Knex as KnexType } from './knex-turbopack';
import { getKnexConfig } from './knexfile';
import logger from '@alga-psa/shared/core/logger';

type PoolConfig = KnexType.PoolConfig & {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
};

let sharedKnexInstance: KnexType | null = null;

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  if (sharedKnexInstance) {
    return sharedKnexInstance;
  }

  const environment = process.env.NODE_ENV === 'test' ? 'development' : process.env.NODE_ENV || 'development';
  const baseConfig = await getKnexConfig(environment);
  logger.info('[shared/db/tenant] Database configuration', {
    client: baseConfig.client,
    connection: {
      host: baseConfig.connection.host,
      port: baseConfig.connection.port,
      database: baseConfig.connection.database,
      user: baseConfig.connection.user,
      password: environment === 'development' ? baseConfig.connection.password : '[REDACTED]',
    },
    pool: baseConfig.pool,
  });

  const poolConfig: PoolConfig = {
    ...(baseConfig.pool as PoolConfig),
    min: 0,
    max: 50,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    afterCreate: (conn, done) => {
      conn.on('error', (err: Error) => {
        logger.error('[shared/db/tenant] DB Connection Error:', err);
      });
      done(null, conn);
    },
  };

  sharedKnexInstance = Knex({
    ...baseConfig,
    pool: poolConfig,
  });

  return sharedKnexInstance;
}

export async function withTransaction<T>(tenantId: string, callback: (trx: KnexType.Transaction) => Promise<T>): Promise<T> {
  const knex = await getConnection(tenantId);
  return knex.transaction(callback);
}

export async function setTenantContext(_conn: any, _tenantId?: string | null): Promise<void> {
  return Promise.resolve();
}

async function destroySharedPool() {
  if (sharedKnexInstance) {
    await sharedKnexInstance.destroy();
    sharedKnexInstance = null;
  }
}

export async function resetTenantConnectionPool(): Promise<void> {
  await destroySharedPool();
}
