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

  it('archives into a coordinator-local table, idempotently', () => {
    const archiveAt = migration.indexOf('INSERT INTO resources_availability_archive');
    const dropAt = migration.indexOf('ALTER TABLE resources DROP COLUMN availability');
    expect(archiveAt).toBeGreaterThan(-1);
    expect(archiveAt).toBeLessThan(dropAt);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS resources_availability_archive');
    expect(migration).toContain('PRIMARY KEY (tenant, resource_id)');
    expect(migration).toContain('ON CONFLICT (tenant, resource_id) DO NOTHING');
  });

  it('drops the column with plain DDL so the default transaction still applies', () => {
    expect(migration).toContain('ALTER TABLE resources DROP COLUMN availability;');
    expect(migration).not.toContain("SELECT create_distributed_table(");
    expect(migration).not.toContain('exports.config');
  });

  it('restores the column and its values from the archive on rollback', () => {
    const down = migration.slice(migration.indexOf('exports.down'));
    expect(down).toContain('ALTER TABLE resources ADD COLUMN availability jsonb');
    expect(down).toContain("hasTable('resources_availability_archive')");
    expect(down).toContain('SET availability = a.availability');
    expect(down).toContain('r.tenant = a.tenant');
    expect(down).toContain('r.resource_id = a.resource_id');
    expect(down).not.toContain('DROP TABLE');
  });
});
