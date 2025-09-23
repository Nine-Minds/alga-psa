import knex, { Knex } from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../core/getSecret';

let adminConnection: Knex | null = null;
export async function getAdminConnection(): Promise<Knex> {
    const connectionId = Math.random().toString(36).substring(7);
    // console.log(`[getAdminConnection:${connectionId}] Called - adminConnection exists:`, !!adminConnection);

    // Return existing connection if available and not destroyed
    if (adminConnection) {
        try {
            // console.log(`[getAdminConnection:${connectionId}] Testing existing connection`);
            // Test if connection is still valid
            await adminConnection.raw('SELECT 1');
            // console.log(`[getAdminConnection:${connectionId}] Existing connection is valid, returning it`);
            return adminConnection;
        } catch (error) {
            // console.log(`[getAdminConnection:${connectionId}] Admin connection test failed, recreating connection:`, error instanceof Error ? error.message : String(error));
            adminConnection = null;
        }
    }


    const environment = process.env.NODE_ENV || 'development';
    const dbPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');
    const config = {
        ...knexfile[environment],
        connection: {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER_ADMIN,
            password: dbPassword,
            database: process.env.DB_NAME_SERVER
        },
        // Add connection pool configuration for long-running services
        pool: {
            min: parseInt(process.env.DB_POOL_MIN || '1'),
            max: parseInt(process.env.DB_POOL_MAX || '5'),
            acquireTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '10000'),
            createTimeoutMillis: parseInt(process.env.DB_POOL_CREATE_TIMEOUT || '10000'),
        }
    };
    // console.log(`[getAdminConnection:${connectionId}] Creating new admin database connection`);
    // console.log(`[getAdminConnection:${connectionId}] Admin connection config:`, {
    //     host: config.connection.host,
    //     port: config.connection.port,
    //     database: config.connection.database,
    //     user: config.connection.user,
    //     environment,
    //     poolConfig: {
    //         min: config.pool.min,
    //         max: config.pool.max,
    //         acquireTimeout: config.pool.acquireTimeoutMillis,
    //         createTimeout: config.pool.createTimeoutMillis
    //     }
    // });

    adminConnection = knex(config);
    // console.log(`[getAdminConnection:${connectionId}] Created new Knex instance, testing connection...`);

    try {
        await adminConnection.raw('SELECT 1');
        // console.log(`[getAdminConnection:${connectionId}] New connection test successful`);
    } catch (error) {
        // console.error(`[getAdminConnection:${connectionId}] New connection test failed:`, error instanceof Error ? error.message : String(error));
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
