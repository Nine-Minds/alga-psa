import Knex, { Knex as KnexType } from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../utils/getSecret';

// Singleton admin connection instance
let adminConnectionInstance: KnexType | null = null;

export async function getAdminConnection() {
    // Return existing connection if available
    if (adminConnectionInstance) {
        return adminConnectionInstance;
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
        pool: {
            min: 1,
            max: 10,
            idleTimeoutMillis: 30000
        }
    };
    console.log('Creating admin database connection');

    adminConnectionInstance = Knex(config);
    return adminConnectionInstance;
}

// Clean up function for graceful shutdown
export async function closeAdminConnection() {
    if (adminConnectionInstance) {
        await adminConnectionInstance.destroy();
        adminConnectionInstance = null;
        console.log('Admin database connection closed');
    }
}

/**
 * Execute a function within an admin database transaction
 * This helper ensures admin operations are wrapped in transactions
 */
export async function withAdminTransaction<T>(
  callback: (trx: KnexType.Transaction) => Promise<T>,
  existingConnection?: KnexType | KnexType.Transaction
): Promise<T> {
  // If we already have a transaction, use it directly
  if (existingConnection && 'commit' in existingConnection && 'rollback' in existingConnection) {
    return await callback(existingConnection as KnexType.Transaction);
  }
  
  // If we have a connection but not a transaction, create one
  if (existingConnection) {
    return await existingConnection.transaction(callback);
  }
  
  // Otherwise, get admin connection and create transaction
  const adminDb = await getAdminConnection();
  // Don't destroy the singleton connection - just use it for the transaction
  return await adminDb.transaction(callback);
}
