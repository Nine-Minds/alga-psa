import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('drop resources.availability migration', () => {
  const migration = readRepoFile('server/migrations/20260728120000_drop_resources_availability.cjs');

  it('is a no-op once the column is gone', () => {
    expect(migration).toContain("hasColumn('resources', 'availability')");
    expect(migration).toContain('Column already dropped; nothing to do.');
  });

  it('captures and logs the rows before touching the table', () => {
    const selectAt = migration.indexOf('SELECT tenant, resource_id, user_id, availability');
    const dropAt = migration.indexOf('ALTER TABLE resources DROP COLUMN availability');
    expect(selectAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(-1);
    expect(selectAt).toBeLessThan(dropAt);
    expect(migration).toContain('JSON.stringify(row)');
  });

  it('keeps no archive table, so nothing new needs a tenant-deletion entry', () => {
    // Production holds one resources row and it is the dev seed's. An archive
    // would be a second table to place on Citus and to remember in
    // TENANT_TABLES_DELETION_ORDER, bought for no data worth keeping.
    expect(migration).not.toContain('resources_availability_archive');
    expect(migration).not.toContain('CREATE TABLE');
  });

  it('drops the column with plain DDL so the default transaction still applies', () => {
    expect(migration).toContain('ALTER TABLE resources DROP COLUMN availability;');
    expect(migration).not.toContain("SELECT create_distributed_table(");
    expect(migration).not.toContain('exports.config');
  });

  it('restores the column on rollback', () => {
    const down = migration.slice(migration.indexOf('exports.down'));
    expect(down).toContain('ALTER TABLE resources ADD COLUMN availability jsonb');
    expect(down).not.toContain('DROP TABLE');
  });
});
