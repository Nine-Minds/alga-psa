/**
 * @alga-psa/db - Admin Database Utilities
 *
 * Provides admin database connections for privileged operations.
 */

import knex from 'knex';
import type { Knex } from 'knex';
import knexfile from './knexfile';
import logger from '@alga-psa/core/logger';
import { getSecret } from '@alga-psa/core/secrets';
import { isReadOnlyError, retryOnReadOnly } from './readOnlyRetry';

let adminConnection: Knex | null = null;
let lifecycle: Promise<void> = Promise.resolve();
let pendingGet: Promise<Knex> | null = null;
let pendingRefresh: Promise<Knex> | null = null;

// Order pool mutations with probes and initialization. A rejected operation must
// not poison the queue; concurrent callers share the same acquisition operation.
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(operation);
    lifecycle = result.then(() => undefined, () => undefined);
    return result;
}

async function clearAdminConnection(): Promise<void> {
    const previous = adminConnection;
    adminConnection = null;
    if (previous) await previous.destroy();
}

export function getAdminConnection(): Promise<Knex> {
    if (pendingGet) return pendingGet;
    const result = enqueue(acquireAdminConnection);
    pendingGet = result;
    const clear = () => { if (pendingGet === result) pendingGet = null; };
    void result.then(clear, clear);
    return result;
}

/**
 * Probe that confirms the cached pool can still perform writes. Guards against
 * StackGres/Patroni failovers and PgBouncer transaction-pooled backends that
 * were once on the primary and are now attached to a standby — `SELECT 1`
 * succeeds on a read-only replica and would otherwise mask the problem.
 */
async function cachedPoolIsWritable(conn: Knex): Promise<boolean> {
    const probe = await conn.raw(
        "SELECT pg_is_in_recovery() AS ro, current_setting('transaction_read_only') AS tro"
    );
    const row = probe.rows?.[0];
    return row?.ro === false && row?.tro === 'off';
}

async function acquireAdminConnection(): Promise<Knex> {
    const connectionId = Math.random().toString(36).substring(7);

    // Return existing connection if available and still write-capable
    if (adminConnection) {
        try {
            if (await cachedPoolIsWritable(adminConnection)) {
                return adminConnection;
            }
            logger.warn('[db/admin] Cached admin pool lost write capability; recreating', {
                connectionId,
            });
        } catch (error) {
            // Probe failed outright — fall through to recreate
        }
        try {
            await clearAdminConnection();
        } catch {
            /* ignore destroy errors; we're replacing the pool anyway */
        }
        adminConnection = null;
    }


    const environment = process.env.NODE_ENV || 'development';
    const dbPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');
    const base = (knexfile as any)[environment] ?? {};
    const baseConn = (base as any).connection ?? {};

    // Prefer direct Postgres connection vars for admin operations (avoid read-only/replica pools).
    const resolvedHost = process.env.DB_HOST_ADMIN || process.env.DB_HOST || baseConn.host;
    const resolvedPort = Number(process.env.DB_PORT_ADMIN ?? process.env.DB_PORT ?? baseConn.port);
    const resolvedUser = process.env.DB_USER_ADMIN || baseConn.user || 'postgres';
    const resolvedDatabase = process.env.DB_NAME_SERVER || baseConn.database || 'server';

    if (!process.env.DB_NAME_SERVER) {
        logger.warn('[db/admin] DB_NAME_SERVER is not set; falling back to default database', {
            environment,
            database: resolvedDatabase,
        });
    }

    const config = {
        ...base,
        connection: {
            host: resolvedHost,
            port: Number.isFinite(resolvedPort) ? resolvedPort : 5432,
            user: resolvedUser,
            password: dbPassword,
            database: resolvedDatabase,
        },
        // Add connection pool configuration for long-running services
        pool: {
            min: parseInt(process.env.DB_POOL_MIN || '1'),
            max: parseInt(process.env.DB_POOL_MAX || '5'),
            acquireTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '10000'),
            createTimeoutMillis: parseInt(process.env.DB_POOL_CREATE_TIMEOUT || '10000'),
        }
    };

    const candidate = knex(config);
    try {
        await candidate.raw('SELECT 1');
    } catch (error) {
        try { await candidate.destroy(); } catch { /* preserve initialization error */ }
        throw error;
    }
    adminConnection = candidate;
    return candidate;
}

export function destroyAdminConnection(): Promise<void> {
    // Calls made after cleanup must not join an acquisition queued before it.
    pendingGet = null;
    pendingRefresh = null;
    return enqueue(clearAdminConnection);
}

/**
 * Force-recreate the admin pool. Callers should use this after catching a
 * "read-only transaction" / "writing to worker nodes" error so the next call
 * to getAdminConnection() returns a freshly-reconnected pool.
 */
export function refreshAdminConnection(): Promise<Knex> {
    if (pendingRefresh) return pendingRefresh;
    pendingGet = null;
    const result = enqueue(async () => {
        try { await clearAdminConnection(); } catch { /* detached pool may fail to close */ }
        return acquireAdminConnection();
    });
    pendingRefresh = result;
    const clear = () => { if (pendingRefresh === result) pendingRefresh = null; };
    void result.then(clear, clear);
    return result;
}

/**
 * Run a callback inside an admin-scoped transaction with one automatic
 * retry on read-only errors. Mirrors withTenantTransactionRetryReadOnly()
 * for the admin pool — see ./readOnlyRetry.ts for the rationale.
 */
export async function withAdminTransactionRetryReadOnly<T>(
    callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
    try {
        const conn = await getAdminConnection();
        return await conn.transaction(callback);
    } catch (err) {
        if (!isReadOnlyError(err)) throw err;
        logger.warn(
            '[db/admin] admin pool returned a read-only connection (likely post-failover stale pool); refreshing pool and retrying once',
            { error: err instanceof Error ? err.message : String(err) }
        );
        const conn = await refreshAdminConnection();
        return await conn.transaction(callback);
    }
}

/**
 * Run an operation against the admin pool with one automatic retry on
 * read-only errors. Mirror of retryOnTenantReadOnly() for the admin
 * pool — useful for callers that don't fit a single-transaction shape
 * (e.g. an activity that issues many separate queries with a loop in
 * the middle).
 */
export async function retryOnAdminReadOnly<T>(
    op: () => Promise<T>,
    context?: { logLabel?: string }
): Promise<T> {
    return retryOnReadOnly(op, refreshAdminConnection, {
        logLabel: context?.logLabel ?? 'db/admin',
        logger,
    });
}
