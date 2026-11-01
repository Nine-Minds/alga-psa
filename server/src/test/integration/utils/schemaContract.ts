import type { Knex } from 'knex';

/**
 * Run a real query path against the migrated test schema and always roll back.
 * This keeps schema contracts tied to executable application queries instead
 * of a second, hand-maintained list of columns.
 */
export async function withMigratedSchemaContract<T>(
  db: Knex,
  name: string,
  exercise: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const trx = await db.transaction();
  try {
    return await exercise(trx);
  } catch (error: any) {
    if (error?.code === '42703') {
      const column = error.column ?? error.message?.match(/column "([^"]+)"/)?.[1] ?? 'unknown';
      const table = error.table ?? error.message?.match(/relation "([^"]+)"/)?.[1] ?? 'query';
      throw new Error(`Migrated schema contract "${name}" references missing column ${table}.${column}`, { cause: error });
    }
    throw error;
  } finally {
    await trx.rollback().catch(() => undefined);
  }
}
