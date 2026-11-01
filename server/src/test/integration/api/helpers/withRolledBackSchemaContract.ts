import type { Knex } from 'knex';

function databaseErrorDescription(error: unknown): string {
  const dbError = error as { code?: string; column?: string; table?: string; message?: string; detail?: string };
  return `database error code=${dbError.code ?? 'unknown'} table=${dbError.table ?? 'unknown'} column=${dbError.column ?? 'unknown'}: ${dbError.message ?? String(error)} ${dbError.detail ?? ''}`;
}

/** Run database-backed schema contracts in a savepoint that is always rolled back. */
export async function withRolledBackSchemaContract<T>(
  db: Knex | Knex.Transaction,
  operation: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const trx = await db.transaction();
  try {
    return await operation(trx);
  } catch (error) {
    throw new Error(`Schema contract failed: ${databaseErrorDescription(error)}`, { cause: error });
  } finally {
    await trx.rollback().catch(() => undefined);
  }
}
