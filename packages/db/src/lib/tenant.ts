/**
 * @alga-psa/db - Tenant Database Utilities
 *
 * Provides tenant-aware database connections and transaction helpers.
 */

import Knex, { Knex as KnexType } from './knex-turbopack';
import { getKnexConfig } from './knexfile';
import { logger } from '@alga-psa/core';
import { AsyncLocalStorage } from 'node:async_hooks';

type PoolConfig = KnexType.PoolConfig & {
  afterCreate?: (connection: any, done: (err: Error | null, connection: any) => void) => void;
};

let sharedKnexInstance: KnexType | null = null;
const tenantContext = new AsyncLocalStorage<string>();

export function getTenantContext(): string | undefined {
  return tenantContext.getStore();
}

export async function runWithTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run(tenant, fn);
}

export async function getConnection(tenantId?: string | null): Promise<KnexType> {
  if (sharedKnexInstance) {
    return sharedKnexInstance;
  }

  const environment = process.env.NODE_ENV === 'test' ? 'development' : process.env.NODE_ENV || 'development';
  const baseConfig = await getKnexConfig(environment);
  logger.info('[db/tenant] Database configuration', {
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
    createTimeoutMillis: 3000, // REDUCED from 30s to 3s - fail fast instead of hanging
    acquireTimeoutMillis: 5000, // Max 5s to acquire connection from pool
    destroyTimeoutMillis: 5000,
    afterCreate: (conn, done) => {
      conn.on('error', (err: Error) => {
        logger.error('[db/tenant] DB Connection Error:', err);
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

export async function withTransaction<T>(
  tenantId: string,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T>;
export async function withTransaction<T>(
  knexOrTrx: KnexType | KnexType.Transaction,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T>;
export async function withTransaction<T>(
  tenantIdOrKnexOrTrx: string | KnexType | KnexType.Transaction,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  if (typeof tenantIdOrKnexOrTrx === 'string') {
    const knex = await getConnection(tenantIdOrKnexOrTrx);
    return knex.transaction(callback);
  }

  const maybeTrx = tenantIdOrKnexOrTrx as unknown as {
    commit?: unknown;
    rollback?: unknown;
  };

  if (typeof maybeTrx?.commit === 'function' && typeof maybeTrx?.rollback === 'function') {
    return callback(tenantIdOrKnexOrTrx as KnexType.Transaction);
  }

  return (tenantIdOrKnexOrTrx as KnexType).transaction(callback);
}

export async function createTenantKnex(
  tenantId?: string | null
): Promise<{ knex: KnexType; tenant: string | null }> {
  let tenant = tenantId ?? getTenantContext() ?? null;

  // Dev convenience: when running inside Next.js server actions / RSC without an established
  // AsyncLocalStorage tenant context, fall back to the first tenant in the DB.
  // This keeps local dev usable while production remains strict.
  if (!tenant && process.env.NODE_ENV !== 'production') {
    try {
      const knex = await getConnection(null);
      const row = await knex<{ tenant: string }>('tenants').select('tenant').first();
      tenant = row?.tenant ?? null;
    } catch {
      // ignore (DB might not be migrated yet)
    }
  }

  const knex = await getConnection(tenant);
  return { knex, tenant };
}

/**
 * Backwards-compatibility hook used by some legacy pool code. For the new model,
 * tenant context is managed via AsyncLocalStorage; the pool connection itself is shared.
 */
export async function setTenantContext(_conn: any, tenantId?: string | null): Promise<void> {
  if (tenantId) {
    tenantContext.enterWith(tenantId);
  }
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
