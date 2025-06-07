import Knex, { Knex as KnexType } from 'knex';
import knexfile from './knexfile';
import { getSecret } from '../utils/getSecret';

export async function getAdminConnection() {
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
        }
    };
    console.log('Creating admin database connection');

    return Knex(config);
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
  try {
    return await adminDb.transaction(callback);
  } finally {
    // Destroy the connection after use to prevent connection leaks
    await adminDb.destroy();
  }
}
