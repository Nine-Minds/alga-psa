import { Knex } from 'knex';

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
  knex: Knex,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return await knex.transaction(callback);
}
