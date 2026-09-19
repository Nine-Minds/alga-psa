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
 * database this helper created.
 */
export async function createDisposableDatabase(prefix: string): Promise<DisposableDatabase> {
  const admin = createKnex({
    client: 'pg',
    connection: adminConnection('postgres'),
    pool: { min: 1, max: 2 },
  });

  const databaseName = `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await admin.raw('CREATE DATABASE ??', [databaseName]);

  const db = createKnex({
    client: 'pg',
    connection: adminConnection(databaseName),
    pool: { min: 1, max: 4 },
  });

  const drop = async () => {
    await db.destroy();
    await admin.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    await admin.destroy();
  };

  return { db, databaseName, drop };
}
