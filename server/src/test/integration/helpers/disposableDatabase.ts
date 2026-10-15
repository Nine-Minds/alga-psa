/* global process */
import { randomUUID } from 'node:crypto';
import { knex as createKnex, type Knex } from 'knex';

const adminConnection = (database: string) => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5438),
  user: process.env.DB_USER_ADMIN ?? 'postgres',
  password: process.env.DB_PASSWORD_ADMIN ?? 'postpass123',
  database,
});

export interface DisposableDatabase {
  db: Knex;
  databaseName: string;
  drop: () => Promise<void>;
}

/**
 * Create a throwaway PostgreSQL database for one suite so it never creates or
 * drops tables in a shared application database. Cleanup drops only the
 * database this helper created. Both creation and cleanup are exception-safe
 * so a failed setup never leaks the admin connection or masks the failure.
 */
export async function createDisposableDatabase(prefix: string): Promise<DisposableDatabase> {
  const admin = createKnex({
    client: 'pg',
    connection: adminConnection('postgres'),
    pool: { min: 1, max: 2 },
  });

  const databaseName = `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  let db: Knex;
  try {
    await admin.raw('CREATE DATABASE ??', [databaseName]);
    db = createKnex({
      client: 'pg',
      connection: adminConnection(databaseName),
      pool: { min: 1, max: 4 },
    });
  } catch (error) {
    await admin.destroy().catch(() => undefined);
    throw error;
  }

  let dropped = false;
  const drop = async () => {
    if (dropped) {
      return;
    }
    dropped = true;
    await db.destroy().catch(() => undefined);
    try {
      await admin.raw(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
        [databaseName],
      );
      await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    } finally {
      await admin.destroy().catch(() => undefined);
    }
  };

  return { db, databaseName, drop };
}
