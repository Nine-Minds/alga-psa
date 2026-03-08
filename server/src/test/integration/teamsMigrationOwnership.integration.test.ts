import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const repoRoot = path.resolve(__dirname, '../../../..');
const ceMigrationsDir = path.join(repoRoot, 'server', 'migrations');
const eeMigrationsDir = path.join(repoRoot, 'ee', 'server', 'migrations');
const teamsEeMigrationFiles = [
  '20260307153000_create_teams_integrations.cjs',
  '20260307193000_add_teams_package_metadata.cjs',
];

async function createMergedEeMigrationsDir(): Promise<{ rootDir: string; migrationsDir: string }> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'teams-ee-migrations-'));
  const migrationsDir = path.join(rootDir, 'migrations');
  const nodeModulesDir = path.join(rootDir, 'node_modules');

  await mkdir(migrationsDir, { recursive: true });
  for (const migrationFile of await readdir(ceMigrationsDir)) {
    await symlink(
      path.join(ceMigrationsDir, migrationFile),
      path.join(migrationsDir, migrationFile),
      'file'
    );
  }
  for (const migrationFile of teamsEeMigrationFiles) {
    await symlink(
      path.join(eeMigrationsDir, migrationFile),
      path.join(migrationsDir, migrationFile),
      'file'
    );
  }
  await symlink(path.join(repoRoot, 'node_modules'), nodeModulesDir, 'dir');

  return { rootDir, migrationsDir };
}

describe('Teams migration ownership (integration)', () => {
  let ceDb: Knex;
  let eeDb: Knex;
  let mergedEeMigrationsRootDir: string;

  beforeAll(async () => {
    const merged = await createMergedEeMigrationsDir();
    mergedEeMigrationsRootDir = merged.rootDir;

    ceDb = await createTestDbConnection({
      databaseName: 'test_database_teams_ce_schema',
      runSeeds: false,
    });

    eeDb = await createTestDbConnection({
      databaseName: 'test_database_teams_ee_schema',
      migrationsDir: merged.migrationsDir,
      runSeeds: false,
    });
  });

  afterAll(async () => {
    await ceDb?.destroy().catch(() => undefined);
    await eeDb?.destroy().catch(() => undefined);

    if (mergedEeMigrationsRootDir) {
      await rm(mergedEeMigrationsRootDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('T399/T400/T413/T414/T417/T418/T439: fresh CE schema keeps shared Microsoft profile tables but omits Teams tables and Teams migration history', async () => {
    await expect(ceDb.schema.hasTable('microsoft_profiles')).resolves.toBe(true);
    await expect(ceDb.schema.hasTable('microsoft_profile_consumer_bindings')).resolves.toBe(true);
    await expect(ceDb.schema.hasTable('teams_integrations')).resolves.toBe(false);

    const appliedMigrations = await ceDb('knex_migrations')
      .whereIn('name', teamsEeMigrationFiles)
      .select<{ name: string }[]>('name');

    expect(appliedMigrations).toHaveLength(0);
  });

  it('T399/T400/T413/T414/T417/T418/T440: fresh EE schema overlays the Teams migrations so Teams tables and package metadata columns exist alongside shared Microsoft tables', async () => {
    await expect(eeDb.schema.hasTable('microsoft_profiles')).resolves.toBe(true);
    await expect(eeDb.schema.hasTable('microsoft_profile_consumer_bindings')).resolves.toBe(true);
    await expect(eeDb.schema.hasTable('teams_integrations')).resolves.toBe(true);
    await expect(eeDb.schema.hasColumn('teams_integrations', 'selected_profile_id')).resolves.toBe(true);
    await expect(eeDb.schema.hasColumn('teams_integrations', 'app_id')).resolves.toBe(true);
    await expect(eeDb.schema.hasColumn('teams_integrations', 'bot_id')).resolves.toBe(true);
    await expect(eeDb.schema.hasColumn('teams_integrations', 'package_metadata')).resolves.toBe(true);

    const appliedMigrations = await eeDb('knex_migrations')
      .whereIn('name', teamsEeMigrationFiles)
      .select<{ name: string }[]>('name');

    expect(appliedMigrations.map((row) => row.name)).toEqual(teamsEeMigrationFiles);

    const foreignKeys = await eeDb.raw<{
      rows: Array<{ definition: string }>;
    }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'teams_integrations'::regclass
        AND contype = 'f'
    `);

    expect((foreignKeys.rows ?? []).map((row) => row.definition)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('REFERENCES microsoft_profiles(tenant, profile_id)'),
      ])
    );
  });
});
