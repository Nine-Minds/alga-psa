import { Knex } from 'knex';
import { getAdminConnection } from './admin';

// Export admin connection getter for use in other services
export { getAdminConnection };

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
 * HOT RELOAD TEST: SHARED LIBRARY CHANGE at 19:14 - Testing new tsx syntax!
 */
export async function withAdminTransaction<T>(
  callback: (trx: Knex.Transaction) => Promise<T>,
  existingConnection?: Knex | Knex.Transaction
): Promise<T> {
  const transactionId = Math.random().toString(36).substring(7);
  console.log(`[withAdminTransaction:${transactionId}] Starting transaction wrapper`);

  try {
    // If we already have a transaction, use it directly
    if (existingConnection && 'commit' in existingConnection && 'rollback' in existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Using existing transaction`);
      const result = await callback(existingConnection as Knex.Transaction);
      console.log(`[withAdminTransaction:${transactionId}] Existing transaction callback completed successfully`);
      return result;
    }

    // If we have a connection but not a transaction, create one
    if (existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Creating transaction on existing connection`);
      const result = await existingConnection.transaction(callback);
      console.log(`[withAdminTransaction:${transactionId}] New transaction on existing connection completed successfully`);
      return result;
    }

    // Otherwise, get admin connection and create transaction
    console.log(`[withAdminTransaction:${transactionId}] Getting admin connection for new transaction`);
    const adminDb = await getAdminConnection();
    // console.log(`[withAdminTransaction:${transactionId}] Got admin connection, pool stats:`, {
    //   pool: adminDb.client?.pool ? {
    //     min: adminDb.client.pool.min,
    //     max: adminDb.client.pool.max,
    //     size: adminDb.client.pool.size,
    //     available: adminDb.client.pool.available,
    //     borrowed: adminDb.client.pool.borrowed,
    //     pending: adminDb.client.pool.pending
    //   } : 'No pool info available'
    // });

    // console.log(`[withAdminTransaction:${transactionId}] Creating transaction on admin connection`);
    const result = await adminDb.transaction(callback);
    // console.log(`[withAdminTransaction:${transactionId}] Admin transaction completed successfully`);
    return result;
  } catch (error) {
    console.error(`[withAdminTransaction:${transactionId}] Transaction failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
  // Note: Do NOT destroy the connection here for long-running services
  // The connection pool will manage connections automatically
}
