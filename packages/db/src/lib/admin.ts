/**
 * @alga-psa/db - Admin Database Utilities
 *
 * Provides admin database connections for privileged operations.
 */

import knex, { Knex } from 'knex';
import knexfile from './knexfile';
import { getSecret, logger } from '@alga-psa/core';

let adminConnection: Knex | null = null;

export async function getAdminConnection(): Promise<Knex> {
    const connectionId = Math.random().toString(36).substring(7);

    // Return existing connection if available and not destroyed
    if (adminConnection) {
        try {
            // Test if connection is still valid
            await adminConnection.raw('SELECT 1');
            return adminConnection;
        } catch (error) {
            adminConnection = null;
        }
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

    adminConnection = knex(config);

    try {
        await adminConnection.raw('SELECT 1');
    } catch (error) {
        throw error;
    }

    return adminConnection;
}

export async function destroyAdminConnection(): Promise<void> {
    if (adminConnection) {
        await adminConnection.destroy();
        adminConnection = null;
    }
}
