import Knex, { Knex as KnexType } from './knex-turbopack';
import { getKnexConfig } from './knexfile';
import logger from '@alga-psa/shared/core/logger';

type PoolConfig = KnexType.PoolConfig & {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
};

type GlobalKnexCache = {
  __algaTenantKnex?: KnexType | null;
};

const globalKnexCache = globalThis as typeof globalThis & GlobalKnexCache;

let sharedKnexInstance: KnexType | null = null;

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  // In dev with HMR, this module can be re-evaluated and leak pools unless the
  // instance is cached on globalThis.
  if (sharedKnexInstance) return sharedKnexInstance;
  if (globalKnexCache.__algaTenantKnex) {
    sharedKnexInstance = globalKnexCache.__algaTenantKnex;
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
    // Keep defaults from knexfile (dev: max 20) to avoid over-connecting local Postgres.
    // In dev, HMR re-evaluation can still create multiple pools if not cached globally.
    // These values can be overridden via knexfile env if needed.
    min: (baseConfig.pool as PoolConfig | undefined)?.min ?? 0,
    max: (baseConfig.pool as PoolConfig | undefined)?.max ?? 20,
    idleTimeoutMillis: (baseConfig.pool as PoolConfig | undefined)?.idleTimeoutMillis ?? 30000,
    reapIntervalMillis: (baseConfig.pool as PoolConfig | undefined)?.reapIntervalMillis ?? 1000,
    createTimeoutMillis: (baseConfig.pool as PoolConfig | undefined)?.createTimeoutMillis ?? 3000,
    acquireTimeoutMillis: (baseConfig.pool as KnexType.PoolConfig | undefined)?.acquireTimeoutMillis ?? 5000,
    destroyTimeoutMillis: (baseConfig.pool as PoolConfig | undefined)?.destroyTimeoutMillis ?? 5000,
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
  globalKnexCache.__algaTenantKnex = sharedKnexInstance;

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
  globalKnexCache.__algaTenantKnex = null;
}

export async function resetTenantConnectionPool(): Promise<void> {
  await destroySharedPool();
}
