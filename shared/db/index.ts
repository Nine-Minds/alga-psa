import { Knex } from 'knex';
import { getAdminConnection } from './admin.js';

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
  knex: Knex,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return await knex.transaction(callback);
}

/**
 * Execute a function within an admin database transaction
 * This helper ensures admin operations are wrapped in transactions
 */
export async function withAdminTransaction<T>(
  callback: (trx: Knex.Transaction) => Promise<T>,
  existingConnection?: Knex | Knex.Transaction
): Promise<T> {
  // If we already have a transaction, use it directly
  if (existingConnection && 'commit' in existingConnection && 'rollback' in existingConnection) {
    return await callback(existingConnection as Knex.Transaction);
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
