import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

import { verifyTestDatabase } from '../../../test-utils/dbConfig';

const originalMigration = '20261013120000_purge_tenant_email_settings_local_heap.cjs';
const forwardMigration = '20261104120000_purge_tenant_email_settings_local_heap.cjs';
// Match the integration test database default used by dbConfig. CI's shard
// runner sets the connection details but intentionally relies on this default.
const testDatabaseName = process.env.TEST_DB_NAME || 'test_database';

let db: Knex;
let migrationDirectory: string;

type MigrationHistoryRow = { id: number; name: string };

function migrationTableName(): string {
  return `knex_email_heap_${randomUUID().replaceAll('-', '')}`;
}

function runMigrationSet(tableName: string) {
  return db.migrate.latest({
    directory: migrationDirectory,
    loadExtensions: ['.cjs'],
    tableName,
  });
}

async function completedMigrations(tableName: string): Promise<string[]> {
  const rows: Array<Pick<MigrationHistoryRow, 'name'>> = await db<MigrationHistoryRow>(tableName)
    .select('name')
    .orderBy('id');
  return rows.map(({ name }) => name);
}

async function removeMigrationHistory(tableName: string): Promise<void> {
  await db.schema.dropTableIfExists(`${tableName}_lock`);
  await db.schema.dropTableIfExists(tableName);
}

describe('tenant email heap purge migration history compatibility', () => {
  beforeAll(() => {
    verifyTestDatabase(testDatabaseName);
    if (!process.env.DB_PASSWORD_ADMIN) {
      throw new Error('Set DB_PASSWORD_ADMIN for the dedicated TEST_DB_NAME database before running this integration test.');
    }
    db = knex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: process.env.DB_PASSWORD_ADMIN,
        database: testDatabaseName,
      },
    });

    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-email-migrations-'));
    const sourceDirectory = path.resolve(process.cwd(), 'migrations');
    fs.symlinkSync(path.join(sourceDirectory, originalMigration), path.join(migrationDirectory, originalMigration));
    fs.symlinkSync(path.join(sourceDirectory, forwardMigration), path.join(migrationDirectory, forwardMigration));
  });

  afterAll(async () => {
    await db?.destroy();
    if (migrationDirectory) fs.rmSync(migrationDirectory, { recursive: true, force: true });
  });

  it('upgrades a database whose Knex history already records the original filename', async () => {
    const tableName = migrationTableName();
    try {
      await db.schema.createTable(tableName, (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
        table.integer('batch').notNullable();
        table.timestamp('migration_time').notNullable().defaultTo(db.fn.now());
      });
      await db(tableName).insert({ name: originalMigration, batch: 1 });

      await expect(runMigrationSet(tableName)).resolves.toBeDefined();

      expect(await completedMigrations(tableName)).toEqual([originalMigration, forwardMigration]);
    } finally {
      await removeMigrationHistory(tableName);
    }
  });

  it('applies both migration identities on a fresh database', async () => {
    const tableName = migrationTableName();
    try {
      await expect(runMigrationSet(tableName)).resolves.toBeDefined();

      expect(await completedMigrations(tableName)).toEqual([originalMigration, forwardMigration]);
    } finally {
      await removeMigrationHistory(tableName);
    }
  });
});
