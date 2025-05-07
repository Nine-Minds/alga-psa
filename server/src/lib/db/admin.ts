import Knex from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../utils/getSecret';
import { Knex as KnexType } from 'knex';


export async function getAdminConnection(): Promise<KnexType> {
    // If in build phase, return a mock Knex object to prevent DB connection attempts
    if (process.env.IS_BUILD_PHASE === 'true') {
        console.warn('Build phase detected: Returning mock Knex object for getAdminConnection.');
        // Return a basic mock matching the one in db.tsx
        return {
            transaction: async (callback: (trx: KnexType.Transaction) => Promise<any>) => {
                console.warn('Mock Knex transaction called during build phase (admin).');
                return Promise.resolve(); 
            },
            raw: () => ({}), 
            destroy: async () => {},
            select: () => ({ from: () => ({ where: async () => [] }) }), 
        } as unknown as KnexType; // Use type assertion carefully
    }

    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
    const knexfileConfig: any = typeof knexfile === 'function' ? knexfile : knexfile.default || knexfile;
    const baseEnvConfig = knexfileConfig?.[environment] || knexfileConfig?.development;
    if (!baseEnvConfig || typeof baseEnvConfig !== 'object') {
        throw new Error(`Knex configuration is not a valid object for environment: ${environment}`);
    }
    const dbPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN');

    // Get required connection details from environment variables
    const dbHost = process.env.DB_HOST;
    const dbPort = process.env.DB_PORT;
    const dbUser = process.env.DB_USER_ADMIN;
    const dbName = process.env.DB_NAME_SERVER;

    // Validate required environment variables
    if (!dbHost || !dbPort || !dbUser || !dbName) {
        const missing = [
            !dbHost && 'DB_HOST',
            !dbPort && 'DB_PORT',
            !dbUser && 'DB_USER_ADMIN',
            !dbName && 'DB_NAME_SERVER'
        ].filter(Boolean).join(', ');
        throw new Error(`Missing required database connection environment variables: ${missing}`);
    }

    const config: KnexType.Config = {
        client: baseEnvConfig.client,
        pool: baseEnvConfig.pool,
        migrations: baseEnvConfig.migrations,
        seeds: baseEnvConfig.seeds,
        connection: {
            host: dbHost,
            port: Number(dbPort),
            user: dbUser,
            password: dbPassword,
            database: dbName
        }
    };


    console.log('Creating admin database connection');

    const Knex = (await import('knex')).default;
    return Knex(config);
}
